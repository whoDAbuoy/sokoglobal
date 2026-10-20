import type { UserRole } from './types';

/**
 * Who may start a checkout. Only importer accounts can buy; the API routes and
 * Postgres (create_trial_order / join_trend_pool) enforce the same rule, so this
 * only decides what the UI offers instead of letting the request fail.
 */
export type CheckoutGate =
  | { kind: 'loading' }
  | { kind: 'ok' }
  | { kind: 'signed_out' }
  | { kind: 'wrong_role'; role: UserRole };

export function checkoutGate(state: { loading: boolean; signedIn: boolean; role: UserRole | null | undefined }): CheckoutGate {
  if (state.loading) return { kind: 'loading' };
  if (!state.signedIn) return { kind: 'signed_out' };
  if (!state.role) return { kind: 'loading' };          // profile row still loading
  if (state.role !== 'importer') return { kind: 'wrong_role', role: state.role };
  return { kind: 'ok' };
}

/** Map a checkout API failure status to a gate, so a stale UI recovers the same way. */
export function gateFromStatus(status: number, role: UserRole | null | undefined): CheckoutGate | null {
  if (status === 401) return { kind: 'signed_out' };
  if (status === 403) return { kind: 'wrong_role', role: role && role !== 'importer' ? role : 'supplier' };
  return null;
}

/** Login URL that brings the buyer back to where they were. Only same-site paths are allowed. */
export function importerLoginUrl(returnTo: string): string {
  const safe = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/dashboard';
  return `/login?redirectTo=${encodeURIComponent(safe)}`;
}

export const ROLE_LABEL: Record<UserRole, string> = {
  importer: 'an importer',
  supplier: 'a supplier',
  admin: 'an admin',
  super_admin: 'a super admin',
};
