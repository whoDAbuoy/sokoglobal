'use server';

import { revalidatePath } from 'next/cache';
import { getSessionProfile } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { friendlyError } from '@/lib/format';
import { UUID_RE } from '@/lib/uploads';
import { AUTH_BAN_DURATION, deletionBlockMessage } from '@/lib/user-admin';

/** `applied` = the main change went through even if a follow-up step (Supabase Auth) reported a problem. */
export type ActionResult = { ok: boolean; message: string; applied?: boolean };

/**
 * Server Actions are public POST endpoints — re-check the admin role on every
 * call. The SQL functions re-check current_role_is('admin') as well, and the
 * service-role client is only used after both checks pass.
 */
async function requireAdmin() {
  const ctx = await getSessionProfile();
  if (!ctx.user || ctx.profile?.role !== 'admin') return null;
  return ctx;
}

/** Ban or unban: flag the profile (blocks orders/messages in SQL) and ban the Supabase Auth user (blocks sign-in). */
export async function setUserBan(userId: string, banned: boolean, reason: string): Promise<ActionResult> {
  const ctx = await requireAdmin();
  if (!ctx) return { ok: false, message: 'Admin access required.' };
  if (!UUID_RE.test(userId)) return { ok: false, message: 'Invalid user.' };
  if (banned && reason.trim().length < 5) return { ok: false, message: 'Add a reason (5+ characters) for the ban.' };

  const { error } = await ctx.supabase.rpc('admin_set_user_ban', { p_user_id: userId, p_banned: banned, p_reason: reason.slice(0, 500) });
  if (error) return { ok: false, message: friendlyError(error.message) };

  let authNote = '';
  try {
    const { error: authError } = await createAdminClient().auth.admin.updateUserById(userId, { ban_duration: banned ? AUTH_BAN_DURATION : 'none' });
    if (authError) authNote = ` Sign-in ${banned ? 'block' : 'restore'} failed in Supabase Auth: ${authError.message}`;
  } catch (e) {
    authNote = ` Supabase Auth was not updated (${e instanceof Error ? e.message : 'service key missing'}); the middleware still signs the user out.`;
  }
  revalidatePath('/admin/users');
  return { ok: !authNote, applied: true, message: (banned ? 'User banned — signed out and blocked from ordering.' : 'User unbanned.') + authNote };
}

/** Hard delete through the Auth Admin API — only for accounts with no escrow, product or payout history. */
export async function deleteUser(userId: string, confirmation: string): Promise<ActionResult> {
  const ctx = await requireAdmin();
  if (!ctx) return { ok: false, message: 'Admin access required.' };
  if (!UUID_RE.test(userId)) return { ok: false, message: 'Invalid user.' };
  if (confirmation.trim().toUpperCase() !== 'DELETE') return { ok: false, message: 'Type DELETE to confirm.' };

  const { data: blockers, error } = await ctx.supabase.rpc('admin_user_deletion_blockers', { p_user_id: userId });
  if (error) return { ok: false, message: friendlyError(error.message) };
  const blocked = deletionBlockMessage(blockers as Record<string, number>);
  if (blocked) return { ok: false, message: blocked };

  // Snapshot for the audit log before the profile row cascades away.
  const { data: snapshot } = await ctx.supabase.from('profiles').select('full_name, company_name, role, country_code').eq('id', userId).maybeSingle();

  let admin;
  try { admin = createAdminClient(); } catch { return { ok: false, message: 'SUPABASE_SERVICE_ROLE_KEY is not configured on the server.' }; }
  const { data: authUser } = await admin.auth.admin.getUserById(userId);
  const { error: delError } = await admin.auth.admin.deleteUser(userId);
  if (delError) return { ok: false, message: `Could not delete: ${delError.message}` };

  await admin.from('admin_user_log').insert({
    admin_id: ctx.user.id, target_user_id: userId, action: 'delete_user',
    detail: { ...(snapshot ?? {}), email: authUser?.user?.email ?? null },
  });
  revalidatePath('/admin/users');
  return { ok: true, message: 'Account deleted.' };
}

/** Approve (copies to the live profile) or reject a pending profile change. */
export async function reviewProfileChange(requestId: string, approve: boolean, note: string): Promise<ActionResult> {
  const ctx = await requireAdmin();
  if (!ctx) return { ok: false, message: 'Admin access required.' };
  if (!UUID_RE.test(requestId)) return { ok: false, message: 'Invalid request.' };
  const { error } = await ctx.supabase.rpc('admin_review_profile_change', { p_request_id: requestId, p_approve: approve, p_note: note.slice(0, 1000) });
  if (error) return { ok: false, message: friendlyError(error.message) };
  revalidatePath('/admin/users');
  return { ok: true, message: approve ? 'Approved — the profile is updated.' : 'Rejected — the user can see your note.' };
}
