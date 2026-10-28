/**
 * Password rules shared by sign-up (components/Auth.tsx), the profile Security tab and the reset form:
 * at least 10 characters plus mixed case and/or a digit and a symbol ("Good" or better), at most 72.
 */
export function passwordStrength(pw: string): { score: 0 | 1 | 2 | 3; label: 'Too short' | 'Weak' | 'Good' | 'Strong' } {
  let score = 0;
  if (pw.length >= 10) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
  // Under 10 characters is never acceptable, however mixed: the meter must not say "Good" for "Ab1!xy".
  if (pw.length < 10) return { score: 0, label: 'Too short' };
  return { score: score as 0 | 1 | 2 | 3, label: (['Too short', 'Weak', 'Good', 'Strong'] as const)[score] };
}

export type PasswordChangeErrors = Partial<Record<'current' | 'next' | 'confirm', string>>;

/** What is wrong with a new password, or null (sign-up, change and reset all use this). */
export function newPasswordError(pw: string): string | null {
  if (pw.length < 10) return 'Use at least 10 characters.';
  if (passwordStrength(pw).score < 2) return 'Add upper & lower case letters, or a number and a symbol.';
  if (pw.length > 72) return 'Use at most 72 characters.';
  return null;
}

/** Rules for the new password + its confirmation (shared by the change and the reset forms). */
function newPasswordErrors(next: string, confirm: string, current?: string): PasswordChangeErrors {
  const errors: PasswordChangeErrors = {};
  const problem = newPasswordError(next);
  if (problem) errors.next = problem;
  else if (current && next === current) errors.next = 'Choose a password different from your current one.';
  if (!confirm) errors.confirm = 'Confirm your new password.';
  else if (confirm !== next) errors.confirm = 'Passwords don’t match.';
  return errors;
}

export function validatePasswordChange(current: string, next: string, confirm: string): PasswordChangeErrors {
  const errors = newPasswordErrors(next, confirm, current);
  return current ? errors : { current: 'Enter your current password.', ...errors };
}

/** The "set a new password" step after a reset link: no current password (the emailed link stands in for it). */
export const validatePasswordReset = (next: string, confirm: string): PasswordChangeErrors => newPasswordErrors(next, confirm);

/** How long after following a reset link the session may set a new password without the current one. */
export const RECOVERY_WINDOW_SECONDS = 60 * 60;

/**
 * Whether a session was signed in through a password-reset link within the window: Supabase Auth stamps
 * {method: 'recovery', timestamp} into the access token's `amr` claim. Any other session (password, OAuth,
 * an old recovery) must use Settings → Security, which asks for the current password.
 */
export function isRecentRecovery(amr: unknown, nowSeconds: number, windowSeconds = RECOVERY_WINDOW_SECONDS): boolean {
  if (!Array.isArray(amr)) return false;
  return amr.some((e) => {
    if (!e || typeof e !== 'object') return false;
    const { method, timestamp } = e as { method?: unknown; timestamp?: unknown };
    return method === 'recovery' && typeof timestamp === 'number' && timestamp <= nowSeconds + 60 && nowSeconds - timestamp <= windowSeconds;
  });
}
