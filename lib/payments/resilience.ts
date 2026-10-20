/**
 * Pure logic for payment resilience (no I/O): webhook retry backoff and the
 * escrow reconciliation rules. The I/O lives in webhook-retry.ts and
 * escrow-reconcile.ts. Contract: supabase/migrations/013_payment_resilience.sql.
 */
import type { EscrowStatus } from '../types';

// ── Webhook dead-letter queue ───────────────────────────────────────────────

/** Attempts by the retry worker before an event is dead-lettered for a human. */
export const MAX_WEBHOOK_ATTEMPTS = 8;
/** Leave freshly received events to the provider's own retries first. */
export const WEBHOOK_GRACE_MS = 10 * 60_000;

/** Exponential backoff: 5 min, 10, 20, 40, 80, 160, then capped at 6 h. */
export function retryDelayMs(attempt: number): number {
  const base = 5 * 60_000 * 2 ** Math.max(0, attempt - 1);
  return Math.min(base, 6 * 60 * 60_000);
}

export type RetryDecision = { action: 'done'; outcome: string } | { action: 'retry'; error: string } | { action: 'dead_letter'; error: string };

/** What to do after a retry attempt (attempt is 1-based, already counted). */
export function decideRetry(attempt: number, result: { outcome: string } | { pending: true } | { error: string }): RetryDecision {
  if ('outcome' in result) return { action: 'done', outcome: result.outcome };
  const error = 'error' in result ? result.error : 'still pending at the provider';
  return attempt >= MAX_WEBHOOK_ATTEMPTS ? { action: 'dead_letter', error } : { action: 'retry', error };
}

// ── Escrow reconciliation ───────────────────────────────────────────────────

export interface ReconOrder {
  id: string; escrow_status: EscrowStatus; total_cents: number; funded_at: string | null;
  payment_provider: string | null; checkout_group_id: string | null;
}
export interface ReconCardPayment {
  reference: string; kind: 'order' | 'group' | 'pool'; order_id: string | null; checkout_group_id: string | null;
  status: 'initiated' | 'succeeded' | 'failed' | 'review'; usd_cents: number; amount_minor: number; currency: string; created_at: string;
}
export interface ReconMpesaPayment {
  id: string; order_id: string | null; checkout_group_id: string | null;
  status: 'initiating' | 'pending' | 'succeeded' | 'failed' | 'cancelled' | 'review';
  usd_cents: number; mpesa_receipt: string | null; created_at: string;
}
export type GatewayCharge = { status: string; amountMinor: number; currency: string } | { error: string };

export interface ReconIssue {
  severity: 'critical' | 'warning'; kind: string; provider: string | null; reference: string | null; order_id: string | null;
  message: string; expected?: Record<string, unknown>; actual?: Record<string, unknown>; fingerprint: string;
}

const HELD: EscrowStatus[] = ['funded', 'in_transit', 'customs_cleared', 'delivered_pending_verification', 'disputed'];
const STALE_MPESA_MS = 60 * 60_000;

const issue = (i: Omit<ReconIssue, 'fingerprint'>): ReconIssue => ({ ...i, fingerprint: `${i.kind}:${i.reference ?? i.order_id ?? 'global'}` });

/** Cross-check local escrow records against gateway answers and against each other. */
export function reconcileEscrow(input: {
  orders: readonly ReconOrder[];
  card: readonly ReconCardPayment[];
  mpesa: readonly ReconMpesaPayment[];
  gateway: ReadonlyMap<string, GatewayCharge>;
  now: Date;
}) {
  const issues: ReconIssue[] = [];
  const now = input.now.getTime();

  // 1. Card payments vs Paystack
  for (const p of input.card) {
    const gw = input.gateway.get(p.reference);
    if (p.status === 'review') {
      issues.push(issue({ severity: 'warning', kind: 'payment_in_review', provider: 'paystack', reference: p.reference, order_id: p.order_id,
        message: 'Card payment is flagged for manual review (amount, currency or duplicate).' }));
    }
    if (!gw) continue;
    if ('error' in gw) {
      issues.push(issue({ severity: 'warning', kind: 'gateway_unreachable', provider: 'paystack', reference: p.reference, order_id: p.order_id,
        message: `Could not verify with Paystack: ${gw.error}` }));
      continue;
    }
    const success = gw.status === 'success';
    if (p.status === 'succeeded' && !success) {
      issues.push(issue({ severity: 'critical', kind: 'gateway_not_successful', provider: 'paystack', reference: p.reference, order_id: p.order_id,
        message: `Escrow was funded but Paystack reports "${gw.status}".`, expected: { status: 'success' }, actual: { status: gw.status } }));
    } else if (p.status === 'succeeded' && (gw.amountMinor !== p.amount_minor || gw.currency !== p.currency.toUpperCase())) {
      issues.push(issue({ severity: 'critical', kind: 'amount_mismatch', provider: 'paystack', reference: p.reference, order_id: p.order_id,
        message: 'Paystack collected a different amount or currency than the escrow record.',
        expected: { amount_minor: p.amount_minor, currency: p.currency }, actual: { amount_minor: gw.amountMinor, currency: gw.currency } }));
    } else if ((p.status === 'initiated' || p.status === 'failed') && success) {
      issues.push(issue({ severity: 'critical', kind: 'unapplied_charge', provider: 'paystack', reference: p.reference, order_id: p.order_id,
        message: 'Paystack collected this charge but escrow was never funded (lost webhook?). The retry worker or a manual confirm should apply it.',
        actual: { amount_minor: gw.amountMinor, currency: gw.currency } }));
    }
  }

  // 2. M-Pesa records
  for (const m of input.mpesa) {
    if (m.status === 'succeeded' && !m.mpesa_receipt) {
      issues.push(issue({ severity: 'warning', kind: 'missing_receipt', provider: 'mpesa', reference: m.id, order_id: m.order_id,
        message: 'M-Pesa payment succeeded without a receipt number on record.' }));
    }
    if (m.status === 'pending' && now - Date.parse(m.created_at) > STALE_MPESA_MS) {
      issues.push(issue({ severity: 'warning', kind: 'stale_pending', provider: 'mpesa', reference: m.id, order_id: m.order_id,
        message: 'STK prompt still pending after an hour — Daraja never confirmed it.' }));
    }
    if (m.status === 'review') {
      issues.push(issue({ severity: 'warning', kind: 'payment_in_review', provider: 'mpesa', reference: m.id, order_id: m.order_id,
        message: 'M-Pesa payment is flagged for manual review.' }));
    }
  }

  // 3. Ledger: every funded order has a successful payment, and no successful payment is left unapplied.
  const paidOrder = new Map<string, number>();   // order id → usd cents paid directly
  const paidGroup = new Map<string, number>();   // checkout group → usd cents paid
  for (const p of input.card) if (p.status === 'succeeded') {
    if (p.order_id) paidOrder.set(p.order_id, (paidOrder.get(p.order_id) ?? 0) + p.usd_cents);
    if (p.checkout_group_id) paidGroup.set(p.checkout_group_id, (paidGroup.get(p.checkout_group_id) ?? 0) + p.usd_cents);
  }
  for (const m of input.mpesa) if (m.status === 'succeeded') {
    if (m.order_id) paidOrder.set(m.order_id, (paidOrder.get(m.order_id) ?? 0) + m.usd_cents);
    if (m.checkout_group_id) paidGroup.set(m.checkout_group_id, (paidGroup.get(m.checkout_group_id) ?? 0) + m.usd_cents);
  }

  for (const o of input.orders) {
    const provider = (o.payment_provider ?? '').toLowerCase();
    const covered = paidOrder.has(o.id) || (!!o.checkout_group_id && paidGroup.has(o.checkout_group_id));
    if (o.funded_at && (provider === 'paystack' || provider === 'mpesa') && !covered) {
      issues.push(issue({ severity: 'critical', kind: 'funded_without_payment', provider, reference: null, order_id: o.id,
        message: `Order is marked funded via ${provider} but no successful ${provider} payment is on record.` }));
    }
    if (o.escrow_status === 'pending_payment' && covered) {
      issues.push(issue({ severity: 'critical', kind: 'payment_not_applied', provider: provider || null, reference: null, order_id: o.id,
        message: 'A successful payment exists but the order is still awaiting payment.' }));
    }
    const direct = paidOrder.get(o.id);
    if (direct !== undefined && o.funded_at && direct !== o.total_cents) {
      issues.push(issue({ severity: 'critical', kind: 'escrow_amount_mismatch', provider: provider || null, reference: null, order_id: o.id,
        message: 'Amount paid does not match the order total held in escrow.', expected: { usd_cents: o.total_cents }, actual: { usd_cents: direct } }));
    }
  }

  // Group (cart) payments: the group's paid amount must equal the sum of its orders.
  const groupTotals = new Map<string, number>();
  for (const o of input.orders) if (o.checkout_group_id && o.funded_at) {
    groupTotals.set(o.checkout_group_id, (groupTotals.get(o.checkout_group_id) ?? 0) + o.total_cents);
  }
  for (const [group, paid] of paidGroup) {
    const total = groupTotals.get(group);
    if (total !== undefined && total !== paid) {
      issues.push(issue({ severity: 'critical', kind: 'escrow_amount_mismatch', provider: null, reference: group, order_id: null,
        message: 'Cart payment does not match the sum of its funded orders.', expected: { usd_cents: total }, actual: { usd_cents: paid } }));
    }
  }

  const held = input.orders.filter((o) => HELD.includes(o.escrow_status));
  const summary = {
    orders_checked: input.orders.length,
    card_payments_checked: input.card.length,
    card_verified_with_gateway: [...input.gateway.values()].filter((g) => !('error' in g)).length,
    mpesa_payments_checked: input.mpesa.length,
    held_in_escrow_cents: held.reduce((s, o) => s + o.total_cents, 0),
    held_orders: held.length,
    paid_cents: { card: sum(input.card.filter((p) => p.status === 'succeeded').map((p) => p.usd_cents)), mpesa: sum(input.mpesa.filter((m) => m.status === 'succeeded').map((m) => m.usd_cents)) },
    critical: issues.filter((i) => i.severity === 'critical').length,
    warnings: issues.filter((i) => i.severity === 'warning').length,
  };
  return { issues, summary };
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
