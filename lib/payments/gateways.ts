import 'server-only';
import type { User } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { settleCardReference, siteUrl } from '@/lib/payments/checkout';
import { createToken, dpoConfig, dpoPaymentUrl, isDpoConfigured, verifyToken } from '@/lib/payments/dpo';
import { captureOrder, createOrder, isPaypalConfigured } from '@/lib/payments/paypal';
import { AirtelError, airtelConfig, isAirtelConfigured, requestPayment, transactionStatus, wholeUnits } from '@/lib/payments/airtel';
import { dispatchNotificationsAfterResponse } from '@/lib/notifications/dispatch';
import type { Profile } from '@/lib/types';

/**
 * DPO Pay, PayPal and Airtel Money (migration 028). Each attempt is a card_payments row
 * (provider = the gateway) whose amount Postgres froze in begin_gateway_payment(); the result
 * is always confirmed with the gateway's own API before apply_card_payment() funds escrow —
 * whichever arrives first (buyer's return, webhook, page poll, retry cron) settles it once.
 */
export type Gateway = 'dpo' | 'paypal' | 'airtel_money';
export const GATEWAYS: Gateway[] = ['dpo', 'paypal', 'airtel_money'];
export const isGateway = (v: unknown): v is Gateway => typeof v === 'string' && (GATEWAYS as string[]).includes(v);
export const GATEWAY_LABEL: Record<Gateway, string> = { dpo: 'DPO Pay', paypal: 'PayPal', airtel_money: 'Airtel Money' };

export const gatewayConfigured = (g: Gateway) => (g === 'dpo' ? isDpoConfigured() : g === 'paypal' ? isPaypalConfigured() : isAirtelConfigured());

export type GatewayTarget = { kind: 'order'; id: string; title: string } | { kind: 'group'; id: string; itemCount: number };

type Db = ReturnType<typeof createAdminClient>;
export interface GatewayRow {
  id: string; reference: string; provider: string; kind: string; order_id: string | null; checkout_group_id: string | null; buyer_id: string;
  usd_cents: number; amount_minor: number; currency: string; status: string; gateway_token: string | null; review_reason: string | null; created_at: string;
}
const ROW = 'id, reference, provider, kind, order_id, checkout_group_id, buyer_id, usd_cents, amount_minor, currency, status, gateway_token, review_reason, created_at';

const returnPath = (t: GatewayTarget) => (t.kind === 'order' ? `/dashboard/orders/${t.id}` : `/dashboard/checkout/${t.id}`);
const describe = (t: GatewayTarget) => (t.kind === 'order' ? `SokoGlobal escrow: ${t.title}` : `SokoGlobal escrow: ${t.itemCount} Trial Batch order(s)`);

export type GatewayStart =
  | { kind: 'redirect'; url: string }
  | { kind: 'prompt'; paymentId: string; amount: number; currency: string };

/** Start a DPO / PayPal checkout (→ redirect URL) or an Airtel Money prompt for what is due on an order or cart. */
export async function startGatewayPayment(input: { gateway: Gateway; target: GatewayTarget; user: User; profile: Profile; phone?: string | null }): Promise<GatewayStart> {
  const { gateway, target, user, profile } = input;
  const db = createAdminClient();
  const rate = gateway === 'dpo' ? dpoConfig() : gateway === 'airtel_money' ? airtelConfig() : { currency: 'USD', usdRate: 1 };
  const { data, error } = await db.rpc('begin_gateway_payment', {
    p_provider: gateway, p_kind: target.kind, p_ref_id: target.id, p_buyer_id: user.id,
    p_currency: rate.currency, p_usd_rate: rate.usdRate, p_phone: input.phone ?? null,
  });
  if (error) throw new GatewayInputError(error.message);
  const row = data as GatewayRow;
  const path = returnPath(target);
  const site = siteUrl();

  try {
    if (gateway === 'dpo') {
      const { token } = await createToken({
        amountMinor: Number(row.amount_minor), currency: row.currency, reference: row.reference, description: describe(target),
        redirectUrl: `${site}${path}?status=processing&gw=dpo`, backUrl: `${site}${path}?status=cancelled&gw=dpo`,
        customerEmail: user.email ?? undefined, customerName: profile.full_name,
      });
      await db.from('card_payments').update({ gateway_token: token }).eq('id', row.id);
      return { kind: 'redirect', url: dpoPaymentUrl(token) };
    }
    if (gateway === 'paypal') {
      const { orderId, approveUrl } = await createOrder({
        usdCents: row.usd_cents, reference: row.reference, description: describe(target),
        returnUrl: `${site}${path}?status=processing&gw=paypal`, cancelUrl: `${site}${path}?status=cancelled&gw=paypal`,
      });
      await db.from('card_payments').update({ gateway_token: orderId }).eq('id', row.id);
      return { kind: 'redirect', url: approveUrl };
    }
    await requestPayment({ transactionId: row.gateway_token!, phone: input.phone!, amount: wholeUnits(Number(row.amount_minor)), reference: row.reference });
    return { kind: 'prompt', paymentId: row.id, amount: wholeUnits(Number(row.amount_minor)), currency: row.currency };
  } catch (err) {
    // Nothing was charged: close the attempt so it never blocks or confuses reconciliation.
    await db.rpc('fail_card_payment', { p_reference: row.reference, p_reason: `${gateway} start failed: ${err instanceof Error ? err.message : String(err)}` });
    if (err instanceof AirtelError && err.httpStatus === 409) throw new GatewayInputError(err.message);
    throw err;
  }
}

/** A refusal the buyer can act on (shown as is), as opposed to a gateway outage. */
export class GatewayInputError extends Error {}

const apply = async (db: Db, reference: string, providerRef: string, amountMinor: number, currency: string) => {
  const { data, error } = await db.rpc('apply_card_payment', { p_reference: reference, p_provider_ref: providerRef, p_amount_minor: amountMinor, p_currency: currency });
  if (error) throw new Error(`apply_card_payment: ${error.message}`);
  dispatchNotificationsAfterResponse();
  const outcome = String(data);
  if (['amount_mismatch', 'currency_mismatch', 'duplicate_payment', 'unknown_reference'].includes(outcome)) {
    console.error('[gateway] payment needs manual review', { outcome, reference });
  }
  return outcome;
};
const fail = async (db: Db, reference: string, reason: string) => {
  await db.rpc('fail_card_payment', { p_reference: reference, p_reason: reason.slice(0, 500) });
  return 'payment_failed';
};

/**
 * Confirm one attempt with its gateway and settle it. Returns the apply_card_payment outcome,
 * 'payment_failed', 'already_processed', or 'pending' when the gateway has no final answer yet.
 */
export async function settleGatewayRow(db: Db, row: GatewayRow): Promise<string> {
  if (row.status !== 'initiated') return 'already_processed';
  if (row.provider === 'paystack') return settleCardReference(row.reference);
  if (!row.gateway_token) return 'pending';

  if (row.provider === 'dpo') {
    const v = await verifyToken(row.gateway_token);
    if (v.state === 'pending') return 'pending';
    if (v.state === 'failed') return fail(db, row.reference, `DPO Pay ${v.result}: ${v.explanation}`);
    if (v.companyRef && v.companyRef !== row.reference) return apply(db, row.reference, row.gateway_token, 0, v.currency ?? row.currency);   // → review
    // Missing amount/currency → recorded as a mismatch for review rather than trusted.
    return apply(db, row.reference, v.approval ? `${row.gateway_token}:${v.approval}` : row.gateway_token, v.amountMinor ?? 0, v.currency ?? 'XXX');
  }
  if (row.provider === 'paypal') {
    const c = await captureOrder(row.gateway_token);
    if (c.captureStatus === 'COMPLETED') {
      if (c.customId && c.customId !== row.reference) return apply(db, row.reference, c.captureId ?? c.orderId, 0, c.currency ?? 'USD');
      return apply(db, row.reference, c.captureId ?? c.orderId, c.amountMinor ?? 0, c.currency ?? 'XXX');
    }
    if (c.status === 'VOIDED' || c.captureStatus === 'DECLINED' || c.captureStatus === 'FAILED') return fail(db, row.reference, `PayPal ${c.status} ${c.captureStatus ?? ''}`.trim());
    return 'pending';   // CREATED / PAYER_ACTION_REQUIRED (not approved yet) or capture PENDING (e.g. eCheck)
  }
  if (row.provider === 'airtel_money') {
    const s = await transactionStatus(row.gateway_token);
    if (s.state === 'pending') return 'pending';
    if (s.state === 'failed') return fail(db, row.reference, `Airtel Money ${s.status}: ${s.message ?? ''}`.trim());
    // Airtel's status API returns no amount; the prompt carried exactly the frozen amount.
    return apply(db, row.reference, s.airtelMoneyId ?? row.gateway_token, Number(row.amount_minor), row.currency);
  }
  return 'pending';
}

export async function gatewayRowByToken(db: Db, gateway: Gateway, token: string): Promise<GatewayRow | null> {
  const { data } = await db.from('card_payments').select(ROW).eq('provider', gateway).eq('gateway_token', token).maybeSingle();
  return data as GatewayRow | null;
}

export async function gatewayRowByReference(db: Db, reference: string): Promise<GatewayRow | null> {
  const { data } = await db.from('card_payments').select(ROW).eq('reference', reference).maybeSingle();
  return data as GatewayRow | null;
}

/** Latest Airtel Money attempt for an order / cart, confirmed with Airtel if still open (polled by the page). */
export async function latestAirtelPayment(target: { kind: 'order' | 'group'; id: string }) {
  const db = createAdminClient();
  const read = async () => {
    const { data } = await db.from('card_payments').select(ROW).eq('provider', 'airtel_money')
      .eq(target.kind === 'order' ? 'order_id' : 'checkout_group_id', target.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
    return data as GatewayRow | null;
  };
  let row = await read();
  const open = row?.status === 'initiated' && Date.now() - Date.parse(row.created_at) > 8_000 ? row : null;
  if (open) {
    try {
      if ((await settleGatewayRow(db, open)) !== 'pending') row = await read();
    } catch (err) {
      console.warn('[airtel] status check failed — will retry', { id: open.id, err: err instanceof Error ? err.message : err });
    }
  }
  if (!row) return null;
  const status = row.status === 'initiated' ? 'pending' : row.status;
  return {
    status, amount: wholeUnits(Number(row.amount_minor)), currency: row.currency,
    message: status === 'failed' ? 'The Airtel Money payment did not go through. You can try again.'
      : status === 'review' ? 'We received your Airtel Money payment and our team is reviewing it. No need to pay again.' : null,
  };
}

/**
 * Retry cron: confirm DPO / PayPal / Airtel attempts that never heard back (buyer closed the tab,
 * webhook lost). Attempts still open after 48 h with no payment are closed as abandoned.
 */
export async function syncOpenGatewayPayments(db: Db, hasTime: () => boolean, now = new Date()) {
  const report = { checked: 0, settled: 0, abandoned: 0, errors: 0 };
  const configured = GATEWAYS.filter(gatewayConfigured);
  if (!configured.length) return report;
  const { data } = await db.from('card_payments').select(ROW).eq('status', 'initiated').in('provider', configured)
    .not('gateway_token', 'is', null).lt('created_at', new Date(now.getTime() - 2 * 60_000).toISOString())
    .order('created_at', { ascending: true }).limit(25);
  for (const row of (data ?? []) as GatewayRow[]) {
    if (!hasTime()) break;
    report.checked += 1;
    try {
      const outcome = await settleGatewayRow(db, row);
      if (outcome !== 'pending') report.settled += 1;
      else if (now.getTime() - Date.parse(row.created_at) > 48 * 3_600_000) {
        await fail(db, row.reference, 'Abandoned: no payment after 48 hours');
        report.abandoned += 1;
      }
    } catch (err) {
      report.errors += 1;
      console.error('[gateway] sync failed', { reference: row.reference, err: err instanceof Error ? err.message : err });
    }
  }
  return report;
}
