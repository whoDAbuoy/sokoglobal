'use server';

import { revalidatePath } from 'next/cache';
import { getSessionProfile } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { friendlyError } from '@/lib/format';
import { rateLimit } from '@/lib/security/rate-limit';
import { AUTH_BAN_DURATION } from '@/lib/user-admin';
import { closedEmail, closureBlockers, isCloseConfirmation } from '@/lib/account';
import { LEGAL_VERSION } from '@/lib/legal';

export type AccountResult = { ok: boolean; message: string; blockers?: string[] };

/** Records acceptance of the current Terms, Escrow Agreement and Privacy Policy (accept_terms, migration 040). */
export async function acceptCurrentTerms(): Promise<AccountResult> {
  const { supabase, user } = await getSessionProfile();
  if (!user) return { ok: false, message: 'Sign in first.' };
  const { error } = await supabase.rpc('accept_terms', { p_version: LEGAL_VERSION });
  if (error) return { ok: false, message: friendlyError(error.message) };
  revalidatePath('/', 'layout');
  return { ok: true, message: 'Thanks. Your acceptance is recorded.' };
}

/** What still blocks closing the account (empty = it can close now). */
export async function accountClosureStatus(): Promise<AccountResult> {
  const { supabase, user } = await getSessionProfile();
  if (!user) return { ok: false, message: 'Sign in first.' };
  const { data, error } = await supabase.rpc('my_account_closure_blockers');
  if (error) return { ok: false, message: friendlyError(error.message) };
  const blockers = closureBlockers(data);
  return { ok: blockers.length === 0, message: blockers.length ? 'Finish these first.' : 'Your account can be closed.', blockers };
}

/**
 * Closes the caller's own account. close_my_account() (as the user) re-checks the blockers, anonymises the
 * profile, archives listings and bans it. Then, with the service role: an account with no history is deleted
 * from Supabase Auth outright; otherwise its auth email is replaced (so the address can sign up again) and
 * sign-in is blocked. Order, payment, payout and KYC records stay for the periods in the Privacy Policy.
 */
export async function closeAccount(confirmation: string): Promise<AccountResult> {
  const { supabase, user } = await getSessionProfile();
  if (!user) return { ok: false, message: 'Sign in first.' };
  if (!isCloseConfirmation(confirmation)) return { ok: false, message: 'Type CLOSE to confirm.' };
  const limited = await rateLimit('twofactor', `close:${user.id}`);
  if (!limited.success) return { ok: false, message: 'Too many attempts. Wait a minute and try again.' };

  const { data: blockersRaw } = await supabase.rpc('my_account_closure_blockers');
  const blockers = closureBlockers(blockersRaw);
  if (blockers.length) return { ok: false, message: 'Finish these first.', blockers };

  // Profile photos are personal data with no retention need: remove them while the session still owns the folder.
  const { data: avatars } = await supabase.storage.from('avatars').list(user.id, { limit: 100 });
  if (avatars?.length) await supabase.storage.from('avatars').remove(avatars.map((f) => `${user.id}/${f.name}`));

  const { data, error } = await supabase.rpc('close_my_account');
  if (error) return { ok: false, message: friendlyError(error.message) };
  const hasHistory = (data as { has_history?: boolean } | null)?.has_history !== false;

  let note = '';
  try {
    const admin = createAdminClient();
    const { error: authError } = hasHistory
      ? await admin.auth.admin.updateUserById(user.id, {
          email: closedEmail(user.id), email_confirm: true, ban_duration: AUTH_BAN_DURATION,
          user_metadata: { full_name: null, company_name: null, bio: null, closed: true },
        })
      : await admin.auth.admin.deleteUser(user.id);
    if (authError) note = ' Sign-in removal is pending; our team will finish it.';
  } catch {
    note = ' Sign-in removal is pending; our team will finish it.';
  }
  await supabase.auth.signOut().catch(() => undefined);
  revalidatePath('/', 'layout');
  return { ok: true, message: `Your account is closed.${note}` };
}
