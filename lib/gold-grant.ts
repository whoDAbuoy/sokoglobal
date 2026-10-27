import { z } from 'zod';

/**
 * Complimentary Gold Supplier grants (pure). Mirrors super_grant_gold() / super_revoke_gold()
 * (migration 034), which re-check everything; this gives the form readable errors first.
 */
export const GRANT_MONTH_OPTIONS = [1, 3, 6, 12, 24] as const;

const email = z.string().trim().toLowerCase().pipe(z.email('Enter the supplier’s email address'));
const reason = z.string().trim().min(5, 'Give a reason (at least 5 characters)').max(500, 'Keep the reason under 500 characters');

export const grantGoldInput = z.object({
  email,
  months: z.coerce.number().int().refine((m) => (GRANT_MONTH_OPTIONS as readonly number[]).includes(m), 'Choose 1, 3, 6, 12 or 24 months'),
  reason,
});
export const revokeGoldInput = z.object({ email, reason });

export type GrantGoldInput = z.input<typeof grantGoldInput>;
export type RevokeGoldInput = z.input<typeof revokeGoldInput>;
export type FieldErrors = Partial<Record<'email' | 'months' | 'reason', string>>;

/** First error per field, for the form. */
export function fieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if ((key === 'email' || key === 'months' || key === 'reason') && !out[key]) out[key] = issue.message;
  }
  return out;
}

export const formatPeriodEnd = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
