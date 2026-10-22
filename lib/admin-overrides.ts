/**
 * Super admin financial / order overrides — pure planning and validation
 * (no Supabase, no providers). Contract: super_* functions in migration 014.
 */
import type { EscrowStatus } from './types';

/** Escrow states where money is still held (refunds and force-release allowed). */
export const HELD_STATUSES: EscrowStatus[] = ['funded', 'in_transit', 'customs_cleared', 'delivered_pending_verification', 'disputed'];
export const isHeld = (s: EscrowStatus | string) => (HELD_STATUSES as string[]).includes(s);
/** Refunds may also return a milestone deposit (migration 021); release still needs the full amount. */
export const isRefundable = (s: EscrowStatus | string) => s === 'deposit_paid' || isHeld(s);

export function validateReason(reason: string): { ok: true; reason: string } | { ok: false; error: string } {
  const r = reason.trim().replace(/\s+/g, ' ');
  if (r.length < 5) return { ok: false, error: 'Give a reason (5+ characters). It is written to the audit log.' };
  if (r.length > 1000) return { ok: false, error: 'Keep the reason under 1,000 characters.' };
  return { ok: true, reason: r };
}

/** "1,234.5" → 123450. Rejects negatives, more than 2 decimals and anything over $10M. */
export function parseUsdToCents(v: string): number | null {
  const s = v.replace(/[,\s$]/g, '');
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(s)) return null;
  const cents = Math.round(Number(s) * 100);
  return Number.isSafeInteger(cents) && cents <= 1_000_000_000 ? cents : null;
}

export interface CardCharge { provider_ref: string | null; currency: string; usd_rate: number; amount_minor: number; usd_cents?: number }
export interface MpesaCharge { id: string; mpesa_receipt: string | null }

export type RefundPlan =
  | { ok: true; full: boolean; amountCents: number; provider: 'paystack'; transaction: string; amountMinor: number;
      /** Further charges to refund in full (a milestone order paid as deposit + balance). */
      more?: { transaction: string; amountMinor: number; usdCents: number }[] }
  | { ok: true; full: boolean; amountCents: number; provider: 'mpesa'; receipt: string | null }
  | { ok: false; error: string };

/**
 * How to refund an order: card charges go back through Paystack (partial refunds
 * in the charge currency, rounded down and capped at what was charged); M-Pesa
 * payments are recorded as manual_required for the finance team to send.
 */
export function planRefund(input: {
  order: { total_cents: number; escrow_status: EscrowStatus | string; payment_structure?: string | null; deposit_amount?: number | null; final_paid_at?: string | null };
  mode: 'full' | 'partial';
  amountCents?: number | null;
  card?: CardCharge | null;
  mpesa?: MpesaCharge | null;
  /** Every successful charge on a stand-alone order (milestone orders can have two). */
  orderCards?: CardCharge[];
  orderMpesa?: MpesaCharge[];
}): RefundPlan {
  const { order } = input;
  if (!isRefundable(order.escrow_status)) return { ok: false, error: `Refunds are only possible while funds are held in escrow (order is ${String(order.escrow_status).replace(/_/g, ' ')}).` };
  const milestone = order.payment_structure === 'milestone_30_70';
  // Only what was actually collected can go back: a milestone order may hold just its deposit.
  const collected = milestone && !order.final_paid_at && order.deposit_amount != null ? order.deposit_amount : order.total_cents;
  const full = input.mode === 'full';
  const amountCents = full ? collected : input.amountCents ?? 0;
  if (!Number.isInteger(amountCents) || amountCents <= 0) return { ok: false, error: 'Enter the amount to refund.' };
  if (!full && amountCents >= collected) return { ok: false, error: 'A partial refund must be less than what was collected for this order. Use a full refund instead.' };

  if (full && milestone && order.final_paid_at) {
    const cards = (input.orderCards ?? []).filter((c): c is CardCharge & { provider_ref: string } => !!c.provider_ref);
    const mpesa = input.orderMpesa ?? [];
    if (cards.length && mpesa.length) {
      return { ok: false, error: 'This order was paid partly by card and partly by M-Pesa. Refund the card charge as a partial refund and send the M-Pesa part manually.' };
    }
    if (cards.length > 1) {
      const [first, ...rest] = cards;
      return { ok: true, full, amountCents, provider: 'paystack', transaction: first.provider_ref, amountMinor: first.amount_minor,
        more: rest.map((c) => ({ transaction: c.provider_ref, amountMinor: c.amount_minor, usdCents: c.usd_cents ?? 0 })) };
    }
  }

  const c = input.card;
  if (c?.provider_ref) {
    const converted = c.currency.toUpperCase() === 'USD' ? amountCents : Math.floor(amountCents * c.usd_rate + 1e-9);
    const amountMinor = Math.min(converted, c.amount_minor);
    if (amountMinor <= 0) return { ok: false, error: 'Refund amount is too small for the charge currency.' };
    return { ok: true, full, amountCents, provider: 'paystack', transaction: c.provider_ref, amountMinor };
  }
  if (input.mpesa) return { ok: true, full, amountCents, provider: 'mpesa', receipt: input.mpesa.mpesa_receipt };
  return { ok: false, error: 'No successful card or M-Pesa payment was found for this order.' };
}

export type LandedCostCheck = { ok: true; goods: number; freight: number; customs: number; total: number } | { ok: false; error: string };

/** Mirrors super_override_landed_cost(): only unpaid, stand-alone orders; non-negative parts; goods > 0. */
export function validateLandedCost(order: { escrow_status: string; checkout_group_id: string | null }, parts: { goods: string; freight: string; customs: string }): LandedCostCheck {
  if (order.escrow_status !== 'pending_payment') return { ok: false, error: 'Landed cost can only change before payment.' };
  if (order.checkout_group_id) return { ok: false, error: 'This order is part of a cart checkout; cancel and re-create the cart instead.' };
  const goods = parseUsdToCents(parts.goods), freight = parseUsdToCents(parts.freight), customs = parseUsdToCents(parts.customs);
  if (goods === null || freight === null || customs === null) return { ok: false, error: 'Enter dollar amounts like 1250.00.' };
  if (goods <= 0) return { ok: false, error: 'Goods value must be more than $0.' };
  return { ok: true, goods, freight, customs, total: goods + freight + customs };
}

export const TRACKING_RE = /^[A-Za-z0-9][A-Za-z0-9 ._/-]{2,79}$/;

/** Catalogue status overrides accepted by super_set_product_state() (migration 015). */
export const PRODUCT_STATES = ['draft', 'under_review', 'published', 'delisted', 'featured', 'unfeatured'] as const;
export type ProductStateOverride = (typeof PRODUCT_STATES)[number];
export const PRODUCT_STATE_LABEL: Record<ProductStateOverride, string> = {
  draft: 'Back to draft', under_review: 'Under review', published: 'Published', delisted: 'Delisted (hidden)', featured: 'Feature', unfeatured: 'Remove feature',
};
