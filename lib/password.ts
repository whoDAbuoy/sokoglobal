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

export function validatePasswordChange(current: string, next: string, confirm: string): PasswordChangeErrors {
  const errors: PasswordChangeErrors = {};
  if (!current) errors.current = 'Enter your current password.';
  if (next.length < 10) errors.next = 'Use at least 10 characters.';
  else if (passwordStrength(next).score < 2) errors.next = 'Add upper & lower case letters, or a number and a symbol.';
  else if (next.length > 72) errors.next = 'Use at most 72 characters.';
  else if (current && next === current) errors.next = 'Choose a password different from your current one.';
  if (!confirm) errors.confirm = 'Confirm your new password.';
  else if (confirm !== next) errors.confirm = 'Passwords don’t match.';
  return errors;
}
