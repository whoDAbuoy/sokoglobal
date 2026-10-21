'use server';

import { createHash } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { createClient as createStatelessClient } from '@supabase/supabase-js';
import { getSessionProfile } from '@/lib/supabase/server';
import { friendlyError } from '@/lib/format';
import { validatePasswordChange, type PasswordChangeErrors } from '@/lib/password';
import { rateLimit } from '@/lib/security/rate-limit';
import {
  avatarObjectPath, checkAvatarFile, isNotificationPref, normalizeDesignation, normalizePhone, type NotificationPref,
} from '@/lib/settings';

export type SettingsResult = { ok: boolean; message: string };
const AVATAR_BUCKET = 'avatars';

/**
 * Every action runs as the signed-in user: RLS ("profiles: update own"), the column
 * grants and checks in migration 016, and the avatars bucket policies (own folder
 * only) apply. Nothing here uses the service role.
 */
async function session() {
  const ctx = await getSessionProfile();
  return ctx.user && ctx.profile ? { ...ctx, user: ctx.user, profile: ctx.profile } : null;
}

const refresh = () => { revalidatePath('/dashboard/settings'); revalidatePath('/', 'layout'); };

/** Job title + phone (name and business name keep the reviewed change-request flow). */
export async function saveProfileDetails(_prev: SettingsResult | null, form: FormData): Promise<SettingsResult> {
  const ctx = await session();
  if (!ctx) return { ok: false, message: 'Sign in first.' };
  const designation = normalizeDesignation(String(form.get('designation') ?? ''));
  if (!designation.ok) return { ok: false, message: designation.error };
  const phone = normalizePhone(String(form.get('phone_number') ?? ''), ctx.profile.country_code);
  if (!phone.ok) return { ok: false, message: phone.error };

  const patch: Record<string, unknown> = { designation: designation.value, phone_number: phone.phone };
  if (!phone.phone) patch.sms_alerts = false;   // SMS alerts need a number (profiles_sms_needs_phone)
  const { error } = await ctx.supabase.from('profiles').update(patch).eq('id', ctx.user.id);
  if (error) return { ok: false, message: friendlyError(error.message) };
  refresh();
  return { ok: true, message: 'Profile saved.' };
}

/**
 * Avatar upload: the browser crops/resizes to a 512 px JPEG first; here the bytes are
 * re-checked (magic number, non-empty), content-hashed into avatars/<uid>/<sha256>.jpg, written
 * with the user's own storage policy, linked on the profile, and older files removed.
 */
export async function uploadAvatar(form: FormData): Promise<SettingsResult & { url?: string }> {
  const ctx = await session();
  if (!ctx) return { ok: false, message: 'Sign in first.' };
  const file = form.get('avatar');
  if (!(file instanceof File)) return { ok: false, message: 'Choose an image.' };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = checkAvatarFile({ size: bytes.length, type: file.type }, bytes.subarray(0, 16));
  if (!check.ok) return { ok: false, message: check.error };

  const hash = createHash('sha256').update(bytes).digest('hex');
  const path = avatarObjectPath(ctx.user.id, hash, check.type);
  const storage = ctx.supabase.storage.from(AVATAR_BUCKET);
  const { error: upErr } = await storage.upload(path, bytes, { contentType: check.type, upsert: true, cacheControl: '31536000' });
  if (upErr) return { ok: false, message: /bucket/i.test(upErr.message) ? 'Avatar storage is not set up yet (migration 016).' : friendlyError(upErr.message) };

  const url = storage.getPublicUrl(path).data.publicUrl;
  const { error } = await ctx.supabase.from('profiles').update({ avatar_url: url }).eq('id', ctx.user.id);
  if (error) {
    await storage.remove([path]);
    return { ok: false, message: friendlyError(error.message) };
  }
  // Content-addressed names make every new avatar a new URL (no stale caches); tidy the old ones.
  const { data: existing } = await storage.list(ctx.user.id, { limit: 100 });
  const stale = (existing ?? []).map((o) => `${ctx.user.id}/${o.name}`).filter((p) => p !== path);
  if (stale.length) await storage.remove(stale);
  refresh();
  return { ok: true, message: 'Profile photo updated.', url };
}

export async function removeAvatar(): Promise<SettingsResult> {
  const ctx = await session();
  if (!ctx) return { ok: false, message: 'Sign in first.' };
  const { error } = await ctx.supabase.from('profiles').update({ avatar_url: null }).eq('id', ctx.user.id);
  if (error) return { ok: false, message: friendlyError(error.message) };
  const storage = ctx.supabase.storage.from(AVATAR_BUCKET);
  const { data: existing } = await storage.list(ctx.user.id, { limit: 100 });
  if (existing?.length) await storage.remove(existing.map((o) => `${ctx.user.id}/${o.name}`));
  refresh();
  return { ok: true, message: 'Profile photo removed.' };
}

/** One notification switch, saved as soon as it is flipped. */
export async function setNotificationPref(key: NotificationPref, value: boolean): Promise<SettingsResult> {
  const ctx = await session();
  if (!ctx) return { ok: false, message: 'Sign in first.' };
  if (!isNotificationPref(key) || typeof value !== 'boolean') return { ok: false, message: 'Invalid setting.' };
  const { error } = await ctx.supabase.from('profiles').update({ [key]: value }).eq('id', ctx.user.id);
  if (error) {
    return { ok: false, message: /sms_needs_phone/.test(error.message) ? 'Add a phone number on the Profile tab first.' : friendlyError(error.message) };
  }
  revalidatePath('/dashboard/settings');
  return { ok: true, message: 'Saved.' };
}

/**
 * Password change. The current password is checked on the server with a throwaway,
 * cookie-less client (so the browser session — and its 2FA verification — is untouched),
 * then the new password is set on the user's own session.
 */
export async function changePassword(current: string, next: string, confirm: string): Promise<SettingsResult & { errors?: PasswordChangeErrors }> {
  const ctx = await session();
  if (!ctx?.user.email) return { ok: false, message: 'Sign in first.' };
  const errors = validatePasswordChange(current, next, confirm);
  if (Object.keys(errors).length) return { ok: false, message: 'Fix the highlighted fields.', errors };
  const limited = await rateLimit('twofactor', `pw:${ctx.user.id}`);
  if (!limited.success) return { ok: false, message: 'Too many attempts. Wait a minute and try again.' };

  const probe = createStatelessClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: probeSession, error: authError } = await probe.auth.signInWithPassword({ email: ctx.user.email, password: current });
  if (authError || probeSession.user?.id !== ctx.user.id) return { ok: false, message: 'Current password is incorrect.', errors: { current: 'Current password is incorrect.' } };
  await probe.auth.signOut({ scope: 'local' }).catch(() => undefined);   // ends only the probe session

  const { error } = await ctx.supabase.auth.updateUser({ password: next });
  if (error) return { ok: false, message: friendlyError(error.message) };
  return { ok: true, message: 'Password updated. Use it next time you sign in.' };
}
