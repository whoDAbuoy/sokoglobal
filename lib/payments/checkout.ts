import 'server-only';
import type { User } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { createPaymentLink } from '@/lib/payments/flutterwave';
import type { Profile } from '@/lib/types';

/**
 * Absolute base URL for redirects. Taken from configuration, never from the
 * request's Host header (which a caller controls → open redirect / phishing).
 */
export function siteUrl(): string {
  const url = process.env.NEXT_PUBLIC_SITE_URL;
  if (!url) throw new Error('NEXT_PUBLIC_SITE_URL is not configured');
  return url.replace(/\/$/, '');
}

type CheckoutTarget =
  | { kind: 'order'; orderId: string; productTitle: string }
  | { kind: 'pool'; poolId: string; poolTitle: string };

/**
 * Create a Flutterwave hosted-checkout link for an order or a Trend Pool pledge.
 *
 * Amount, currency and tx_ref come from Postgres (begin_payment_attempt), not
 * from the client. Each call is a new attempt with a unique tx_ref, as
 * Flutterwave requires: ord_<id>, then ord_<id>-2, -3 … on retries.
 */
export async function createCheckout(target: CheckoutTarget, user: User, profile: Profile): Promise<string> {
  if (!user.email) throw new Error('Your account needs an email address to pay');

  const db = createAdminClient();
  const refId = target.kind === 'order' ? target.orderId : target.poolId;
  const { data, error } = await db.rpc('begin_payment_attempt', { p_kind: target.kind, p_ref_id: refId, p_buyer_id: user.id });
  if (error) throw new Error(error.message);
  const attempt = (Array.isArray(data) ? data[0] : data) as { o_tx_ref: string; o_amount_cents: number; o_currency: string };

  const base = siteUrl();
  return createPaymentLink({
    txRef: attempt.o_tx_ref,
    amountCents: attempt.o_amount_cents,
    currency: attempt.o_currency,
    redirectUrl: target.kind === 'order'
      ? `${base}/dashboard/orders/${target.orderId}`
      : `${base}/dashboard?pool=${target.poolId}#pools`,
    customer: { email: user.email, name: profile.full_name },
    meta: {
      kind: target.kind,
      ref_id: refId,
      buyer_id: user.id,
      company: profile.company_name,
      country: profile.country_code,
    },
    title: 'SokoGlobal Escrow',
    description: target.kind === 'order'
      ? `Trial Batch: ${target.productTitle}`.slice(0, 120)
      : `Trend Pool pledge: ${target.poolTitle}`.slice(0, 120),
  });
}
