/**
 * Pure helpers for the supplier fulfilment pipeline and payout dial (no React).
 * Inputs are rows the supplier RLS policies already return (orders on their
 * products, their own payouts).
 */
import type { EscrowStatus } from './types';

export type PipelineLane = 'awaiting' | 'escrow' | 'transit' | 'verify' | 'completed' | 'issue';

export const LANES: { id: PipelineLane; label: string; hint: string; tone: string }[] = [
  { id: 'awaiting', label: 'Awaiting payment', hint: 'Buyer has not paid yet', tone: 'tone-pending' },
  { id: 'escrow', label: 'Paid to escrow', hint: 'Prepare the batch for pickup', tone: 'tone-escrow' },
  { id: 'transit', label: 'In transit', hint: 'Flying or clearing customs', tone: 'tone-transit' },
  { id: 'verify', label: 'Buyer verifying', hint: 'Delivered — awaiting confirmation', tone: 'tone-active' },
  { id: 'completed', label: 'Paid out', hint: 'Escrow released to you', tone: 'tone-escrow' },
  { id: 'issue', label: 'Disputed / closed', hint: 'Disputes, refunds, cancellations', tone: 'tone-danger' },
];

export function laneOf(status: EscrowStatus): PipelineLane {
  switch (status) {
    case 'pending_payment': return 'awaiting';
    case 'deposit_paid':
    case 'funded': return 'escrow';
    case 'in_transit':
    case 'customs_cleared': return 'transit';
    case 'delivered_pending_verification': return 'verify';
    case 'released': return 'completed';
    default: return 'issue'; // disputed, refunded, cancelled
  }
}

export interface PipelineOrder {
  id: string;
  escrow_status: EscrowStatus;
  total_cents: number;
  created_at: string;
  product_title: string;
}

export type PipelineSort = 'newest' | 'oldest' | 'value';

/** Filter by lane ('all' = every lane) and product search, then sort. */
export function filterPipeline<T extends PipelineOrder>(orders: readonly T[], lane: PipelineLane | 'all', query = '', sort: PipelineSort = 'newest'): T[] {
  const q = query.trim().toLowerCase();
  const list = orders.filter((o) => (lane === 'all' || laneOf(o.escrow_status) === lane) && (!q || o.product_title.toLowerCase().includes(q) || o.id.startsWith(q)));
  return list.sort((a, b) => {
    if (sort === 'value') return b.total_cents - a.total_cents;
    const d = Date.parse(a.created_at) - Date.parse(b.created_at);
    return sort === 'oldest' ? d : -d;
  });
}

export function laneCounts(orders: readonly PipelineOrder[]): Record<PipelineLane, number> {
  const c = { awaiting: 0, escrow: 0, transit: 0, verify: 0, completed: 0, issue: 0 };
  for (const o of orders) c[laneOf(o.escrow_status)] += 1;
  return c;
}

export type PayoutStatus = 'processing' | 'succeeded' | 'failed' | 'on_hold';

/** Payout dial figures: share of payout value that has reached the supplier. */
export function payoutSummary(payouts: readonly { status: PayoutStatus; amount_cents: number }[]) {
  const by = { processing: 0, succeeded: 0, failed: 0, on_hold: 0 } as Record<PayoutStatus, number>;
  const count = { processing: 0, succeeded: 0, failed: 0, on_hold: 0 } as Record<PayoutStatus, number>;
  for (const p of payouts) { by[p.status] += p.amount_cents; count[p.status] += 1; }
  const total = by.processing + by.succeeded + by.failed + by.on_hold;
  return { by, count, total, paidPct: total ? Math.round((by.succeeded / total) * 100) : 0 };
}

/**
 * Escrow release bar: order value released vs still held vs awaiting payment,
 * as percentages that add up to 100 (or all 0 with no orders).
 */
export function releaseSplit(orders: readonly { escrow_status: EscrowStatus; total_cents: number }[]) {
  let released = 0, held = 0, awaiting = 0;
  for (const o of orders) {
    const lane = laneOf(o.escrow_status);
    if (lane === 'completed') released += o.total_cents;
    else if (lane === 'awaiting') awaiting += o.total_cents;
    else if (lane !== 'issue' || o.escrow_status === 'disputed') held += o.total_cents;
  }
  const sum = released + held + awaiting;
  const pct = (v: number) => (sum ? Math.round((v / sum) * 1000) / 10 : 0);
  return { released, held, awaiting, releasedPct: pct(released), heldPct: pct(held), awaitingPct: pct(awaiting) };
}
