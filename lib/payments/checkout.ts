import 'server-only';
import type { User } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { initializeTransaction, paystackConfig, verifyTransaction } from '@/lib/payments/paystack';
import type { Profile } from '@/lib/types';
import { dispatchNotificationsAfterResponse } from '@/lib/notifications/dispatch';

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
  | { kind: 'pool'; poolId: string; poolTitle: string }
  | { kind: 'group'; groupId: string; itemCount: number };

/** What the browser needs to open Paystack's secure card form (or fall back to its hosted page). */
export interface CardCheckout {
  reference: string;
  accessCode: string;
  authorizationUrl: string;
  amountMinor: number;
  currency: string;
}

/** Where the buyer lands after paying; `status=processing` shows "confirming your payment" while we verify. */
export function returnPath(target: CheckoutTarget): string {
  return target.kind === 'order' ? `/dashboard/orders/${target.orderId}`
    : target.kind === 'pool' ? `/dashboard?pool=${target.poolId}#pools`
    : `/dashboard/checkout/${target.groupId}`;
}

/**
 * Start a Bank Card (Visa / Mastercard) payment through Paystack for an order,
 * a cart checkout or a Trend Pool pledge.
 *
 * Amount and reference come from Postgres (begin_card_payment → begin_payment_attempt),
 * never from the client; the charge amount is frozen on the card_payments row.
 * Each call is a new attempt with a unique reference (ord.<id>, ord.<id>-2 …).
 */
export async function createCheckout(target: CheckoutTarget, user: User, profile: Profile, opts: { billingName?: string } = {}): Promise<CardCheckout> {
  if (!user.email) throw new Error('Your account needs an email address to pay by card');
  const cfg = paystackConfig();
  const db = createAdminClient();
  const refId = target.kind === 'order' ? target.orderId : target.kind === 'pool' ? target.poolId : target.groupId;

  const { data, error } = await db.rpc('begin_card_payment', {
    p_kind: target.kind, p_ref_id: refId, p_buyer_id: user.id, p_currency: cfg.currency, p_usd_rate: cfg.usdRate,
  });
  if (error) throw new Error(error.message);
  const attempt = data as { reference: string; amount_minor: number; currency: string };

  const path = returnPath(target);
  const [pathname, hash] = path.split('#');
  const callbackUrl = `${siteUrl()}${pathname}${pathname.includes('?') ? '&' : '?'}status=processing${hash ? `#${hash}` : ''}`;
  const billingName = (opts.billingName ?? profile.full_name).trim().slice(0, 120);
  try {
    const init = await initializeTransaction({
      email: user.email,
      amountMinor: Number(attempt.amount_minor),
      currency: attempt.currency,
      reference: attempt.reference,
      callbackUrl,
      metadata: {
        kind: target.kind, ref_id: refId, buyer_id: user.id,
        description: target.kind === 'order' ? `Trial Batch: ${target.productTitle}`.slice(0, 120)
          : target.kind === 'pool' ? `Trend Pool pledge: ${target.poolTitle}`.slice(0, 120)
          : `${target.itemCount} Trial Batch order(s), escrow per order`,
        custom_fields: [
          { display_name: 'Billing name', variable_name: 'billing_name', value: billingName },
          { display_name: 'Company', variable_name: 'company', value: profile.company_name },
        ],
      },
    });
    return { reference: init.reference, accessCode: init.accessCode, authorizationUrl: init.authorizationUrl,
      amountMinor: Number(attempt.amount_minor), currency: attempt.currency };
  } catch (err) {
    await db.rpc('fail_card_payment', { p_reference: attempt.reference, p_reason: `initialize failed: ${err instanceof Error ? err.message : String(err)}` });
    throw err;
  }
}

export type PurchaseTarget =
  | { kind: 'subscription' }
  | { kind: 'rfq_addon'; rfqId: string; rfqTitle: string; addons: readonly ('featured' | 'white_glove')[] };

/**
 * Start a card payment for a platform purchase: a Gold Supplier month or RFQ
 * add-ons (migration 026). The price comes from platform_settings inside
 * begin_card_purchase(); the charge settles through the same webhook / confirm
 * route as orders (apply_card_payment).
 */
export async function createPurchaseCheckout(target: PurchaseTarget, user: User, profile: Profile, opts: { billingName?: string } = {}): Promise<CardCheckout> {
  if (!user.email) throw new Error('Your account needs an email address to pay by card');
  const cfg = paystackConfig();
  const db = createAdminClient();
  const { data, error } = await db.rpc('begin_card_purchase', {
    p_kind: target.kind, p_user: user.id,
    p_rfq_id: target.kind === 'rfq_addon' ? target.rfqId : null,
    p_addons: target.kind === 'rfq_addon' ? [...target.addons] : null,
    p_currency: cfg.currency, p_usd_rate: cfg.usdRate,
  });
  if (error) throw new Error(error.message);
  const attempt = data as { reference: string; amount_minor: number; currency: string };

  const path = target.kind === 'subscription' ? '/supplier/subscription' : '/dashboard/rfqs';
  const billingName = (opts.billingName ?? profile.full_name).trim().slice(0, 120);
  try {
    const init = await initializeTransaction({
      email: user.email,
      amountMinor: Number(attempt.amount_minor),
      currency: attempt.currency,
      reference: attempt.reference,
      callbackUrl: `${siteUrl()}${path}?status=processing`,
      metadata: {
        kind: target.kind, ref_id: target.kind === 'rfq_addon' ? target.rfqId : user.id, buyer_id: user.id,
        description: target.kind === 'subscription' ? 'Gold Supplier: 1 month'
          : `RFQ add-ons (${target.addons.join(' + ')}): ${target.rfqTitle}`.slice(0, 120),
        custom_fields: [
          { display_name: 'Billing name', variable_name: 'billing_name', value: billingName },
          { display_name: 'Company', variable_name: 'company', value: profile.company_name },
        ],
      },
    });
    return { reference: init.reference, accessCode: init.accessCode, authorizationUrl: init.authorizationUrl,
      amountMinor: Number(attempt.amount_minor), currency: attempt.currency };
  } catch (err) {
    await db.rpc('fail_card_payment', { p_reference: attempt.reference, p_reason: `initialize failed: ${err instanceof Error ? err.message : String(err)}` });
    throw err;
  }
}

/**
 * Verify a Paystack reference and settle it in Postgres. Used by the webhook
 * and by the buyer's "I just paid" confirmation, so whichever arrives first
 * funds the escrow (apply_card_payment is idempotent).
 * Returns the outcome, or 'pending' if Paystack hasn't finished the charge.
 */
export async function settleCardReference(reference: string): Promise<string> {
  const db = createAdminClient();
  const charge = await verifyTransaction(reference);   // throws → caller retries / Paystack re-sends
  if (charge.reference !== reference) return 'verification_mismatch';
  if (charge.status === 'success') {
    const { data, error } = await db.rpc('apply_card_payment', {
      p_reference: reference, p_provider_ref: charge.id, p_amount_minor: charge.amountMinor, p_currency: charge.currency,
    });
    if (error) throw new Error(`apply_card_payment: ${error.message}`);
    dispatchNotificationsAfterResponse();   // payment-received emails / SMS queued by the order trigger
    const outcome = String(data);
    if (['amount_mismatch', 'currency_mismatch', 'duplicate_payment', 'unknown_reference'].includes(outcome)) {
      console.error('[card] payment needs manual review', { outcome, reference, transaction: charge.id });
    }
    return outcome;
  }
  if (['failed', 'abandoned', 'reversed'].includes(charge.status)) {
    await db.rpc('fail_card_payment', { p_reference: reference, p_reason: `Paystack status: ${charge.status}` });
    return `charge_${charge.status}`;
  }
  return 'pending';
}
