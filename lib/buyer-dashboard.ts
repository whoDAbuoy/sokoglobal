/**
 * Pure read-model helpers for the buyer overview (Sellsy layout): order summary tiles, the
 * shipment preview stepper and the status pills in the recent-orders table. Presentation only:
 * they summarise rows the page already loaded and never touch money rules (escrow, releases and
 * refunds stay in Postgres and lib/payments).
 */
import type { EscrowStatus } from './types';

export interface OrderRow { id: string; escrow_status: EscrowStatus; total_cents: number; created_at: string }

/** Paid in full and not yet released to the supplier (a deposit-only order holds just its deposit, so it is counted apart). */
const HELD: EscrowStatus[] = ['funded', 'in_transit', 'customs_cleared', 'delivered_pending_verification'];
const ACTIVE: EscrowStatus[] = ['deposit_paid', ...HELD];
const CLOSED: EscrowStatus[] = ['refunded', 'cancelled'];

export interface OrderSummary {
  /** Orders still moving: deposit paid through delivered-awaiting-verification. */
  active: number;
  /** Orders waiting on the buyer (verify goods) or in dispute. */
  needsAction: number;
  /** Full order value of paid-in-full orders not yet released. */
  heldCents: number;
  /** Orders on a 30% deposit (their balance is not in escrow yet). */
  depositOrders: number;
  /** Value of every order that was not refunded or cancelled. */
  orderedCents: number;
  inTransit: number;
}

export function summarizeOrders(orders: OrderRow[]): OrderSummary {
  const s: OrderSummary = { active: 0, needsAction: 0, heldCents: 0, depositOrders: 0, orderedCents: 0, inTransit: 0 };
  for (const o of orders) {
    const cents = o.total_cents ?? 0;
    if (ACTIVE.includes(o.escrow_status)) s.active += 1;
    if (o.escrow_status === 'delivered_pending_verification' || o.escrow_status === 'disputed') s.needsAction += 1;
    if (HELD.includes(o.escrow_status)) s.heldCents += cents;
    if (o.escrow_status === 'deposit_paid') s.depositOrders += 1;
    if (o.escrow_status === 'in_transit' || o.escrow_status === 'customs_cleared') s.inTransit += 1;
    if (!CLOSED.includes(o.escrow_status)) s.orderedCents += cents;
  }
  return s;
}

export const SHIPMENT_STAGES = ['Paid', 'In escrow', 'In transit', 'Customs cleared', 'Delivered'] as const;

/**
 * How far an order has got along the five preview stages (0 = none reached … 5 = delivered).
 * null for orders that left the pipeline (refunded, cancelled, disputed) or were never paid.
 */
export function shipmentStage(status: EscrowStatus): number | null {
  switch (status) {
    case 'deposit_paid': return 1;
    case 'funded': return 2;
    case 'in_transit': return 3;
    case 'customs_cleared': return 4;
    case 'delivered_pending_verification':
    case 'released': return 5;
    default: return null;
  }
}

/**
 * The order to preview in the shipment widget: the newest one on the move (in transit or
 * customs cleared), else the newest paid one not yet delivered. null when nothing is in flight.
 */
export function trackedOrder<T extends OrderRow>(orders: T[]): T | null {
  const newest = [...orders].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  return newest.find((o) => o.escrow_status === 'in_transit' || o.escrow_status === 'customs_cleared')
    ?? newest.find((o) => { const s = shipmentStage(o.escrow_status); return s !== null && s < 5; })
    ?? null;
}

export type PillTone = 'mint' | 'blue' | 'amber' | 'rose' | 'muted';

/** Short, high-contrast status for the recent-orders table (Paid · In transit · Delivered …). */
export function orderPill(status: EscrowStatus): { label: string; tone: PillTone } {
  switch (status) {
    case 'pending_payment': return { label: 'Awaiting payment', tone: 'amber' };
    case 'deposit_paid': return { label: 'Deposit paid', tone: 'mint' };
    case 'funded': return { label: 'Paid', tone: 'mint' };
    case 'in_transit': return { label: 'In transit', tone: 'blue' };
    case 'customs_cleared': return { label: 'Customs cleared', tone: 'blue' };
    case 'delivered_pending_verification': return { label: 'Delivered · verify', tone: 'amber' };
    case 'released': return { label: 'Delivered', tone: 'mint' };
    case 'disputed': return { label: 'Dispute open', tone: 'rose' };
    case 'refunded': return { label: 'Refunded', tone: 'muted' };
    case 'cancelled': return { label: 'Cancelled', tone: 'muted' };
    default: return { label: String(status).replace(/_/g, ' '), tone: 'muted' };
  }
}
