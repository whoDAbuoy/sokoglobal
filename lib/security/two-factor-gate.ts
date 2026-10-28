/**
 * Where a signed-in user whose session has not passed 2FA may go (pure, Edge-safe:
 * used by middleware). Contract: my_security_state() in migration 016.
 */
import { sameSitePath } from '../safe-path';

export type TwoFactorGate = 'allow' | 'challenge' | 'api';

const PROTECTED = ['/dashboard', '/supplier', '/admin'];

export function twoFactorGate(input: { path: string; isServerAction?: boolean; enabled: boolean; ok: boolean }): TwoFactorGate {
  if (!input.enabled || input.ok) return 'allow';
  const p = input.path;
  if (p === '/api/auth/2fa' || p.startsWith('/api/auth/2fa/')) return 'allow';     // the challenge itself
  if (p.startsWith('/api/') || input.isServerAction) return 'api';
  if (PROTECTED.some((x) => p === x || p.startsWith(`${x}/`))) return 'challenge';
  return 'allow';                                                                    // public pages, /login, /auth/2fa
}

/** Same-site path to return to after the 2FA challenge (never the challenge itself). */
export function safeReturnPath(v: string | null | undefined, fallback = '/'): string {
  const path = sameSitePath(v);
  return path && !path.startsWith('/auth/2fa') ? path : fallback;
}

/**
 * Money-moving overrides (force release, refunds, payouts, landed cost) need 2FA switched on
 * and verified for this session (Postgres enforces the same on financial_overrides).
 */
export function financialOverrideBlock(state: { enabled: boolean; ok: boolean }): string | null {
  if (!state.enabled) return 'Turn on two-factor authentication in Settings → Security before using financial overrides.';
  if (!state.ok) return 'Verify your two-factor code to continue.';
  return null;
}
