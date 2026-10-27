/**
 * Password rules shared by the profile Security tab. Mirrors sign-up
 * (components/Auth.tsx): at least 10 characters plus mixed case and/or a
 * digit and a symbol ("Good" or better).
 */
export function passwordStrength(pw: string): { score: 0 | 1 | 2 | 3; label: 'Too short' | 'Weak' | 'Good' | 'Strong' } {
  let score = 0;
  if (pw.length >= 10) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
  return { score: score as 0 | 1 | 2 | 3, label: (['Too short', 'Weak', 'Good', 'Strong'] as const)[score] };
}

export type PasswordChangeErrors = Partial<Record<'current' | 'next' | 'confirm', string>>;

/** Rules for the new password + its confirmation (shared by the change and the reset forms). */
function newPasswordErrors(next: string, confirm: string, current?: string): PasswordChangeErrors {
  const errors: PasswordChangeErrors = {};
  if (next.length < 10) errors.next = 'Use at least 10 characters.';
  else if (passwordStrength(next).score < 2) errors.next = 'Add upper & lower case letters, or a number and a symbol.';
  else if (next.length > 72) errors.next = 'Use at most 72 characters.';
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
