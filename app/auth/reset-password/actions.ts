'use server';

import { createClient } from '@/lib/supabase/server';
import { friendlyError } from '@/lib/format';
import { isRecentRecovery, validatePasswordReset, type PasswordChangeErrors } from '@/lib/password';
import { rateLimit } from '@/lib/security/rate-limit';

export type ResetResult = { ok: boolean; message: string; errors?: PasswordChangeErrors };

/**
 * Sets a new password for a session that arrived through a reset link (Auth → /auth/callback). The access
 * token must carry a recent `recovery` entry in its amr claim: any other session has to go through
 * Settings → Security, which asks for the current password. Runs as the user (no service role).
 */
export async function resetPassword(next: string, confirm: string): Promise<ResetResult> {
  const errors = validatePasswordReset(next, confirm);
  if (Object.keys(errors).length) return { ok: false, message: 'Fix the highlighted fields.', errors };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: claims } = await supabase.auth.getClaims();
  if (!user || claims?.claims?.sub !== user.id || !isRecentRecovery(claims.claims.amr, Math.floor(Date.now() / 1000))) {
    return { ok: false, message: 'This reset link has expired. Request a new one from the sign-in page.' };
  }
  const limited = await rateLimit('twofactor', `pw:${user.id}`);
  if (!limited.success) return { ok: false, message: 'Too many attempts. Wait a minute and try again.' };

  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) {
    if (/different from the old|same.*password/i.test(error.message)) {
      return { ok: false, message: 'Choose a password different from your old one.', errors: { next: 'Choose a password different from your old one.' } };
    }
    return { ok: false, message: friendlyError(error.message) };
  }
  return { ok: true, message: 'Password updated.' };
}
