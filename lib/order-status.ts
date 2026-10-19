import type { EscrowStatus } from './types';
import { UUID_RE } from './uploads';

export type Tone = 'warning' | 'escrow' | 'success' | 'danger' | 'muted';

/** Buyer-facing status pill for an order. */
export function statusMeta(status: EscrowStatus): { label: string; tone: Tone } {
  switch (status) {
    case 'pending_payment': return { label: 'Awaiting payment', tone: 'warning' };
    case 'funded':
    case 'in_transit':
    case 'customs_cleared': return { label: 'Held in escrow', tone: 'escrow' };
    case 'delivered_pending_verification': return { label: 'Ready to verify', tone: 'warning' };
    case 'released': return { label: 'Supplier paid', tone: 'success' };
    case 'disputed': return { label: 'Dispute open', tone: 'danger' };
    case 'refunded': return { label: 'Refunded', tone: 'muted' };
    case 'cancelled': return { label: 'Cancelled', tone: 'muted' };
    default: return { label: String(status).replace(/_/g, ' '), tone: 'muted' };
  }
}

export type OrderAction =
  | { kind: 'link'; label: string; href: string; primary: boolean }
  | { kind: 'support'; label: string; orderId: string }
  | { kind: 'none' };

/**
 * The one next step for an order card. Payment, tracking and verification all
 * happen on the order page (which forwards cart orders to their checkout);
 * closed or contested orders open the support chat for that order.
 * Sample (non-UUID) orders get no action.
 */
export function orderAction(order: { id: string; escrow_status: EscrowStatus }): OrderAction {
  if (!UUID_RE.test(order.id)) return { kind: 'none' };
  const page = `/dashboard/orders/${order.id}`;
  switch (order.escrow_status) {
    case 'pending_payment': return { kind: 'link', label: 'Complete payment', href: page, primary: true };
    case 'delivered_pending_verification': return { kind: 'link', label: 'Verify goods', href: page, primary: true };
    case 'funded':
    case 'in_transit':
    case 'customs_cleared': return { kind: 'link', label: 'View escrow', href: page, primary: false };
    case 'released': return { kind: 'link', label: 'View order', href: page, primary: false };
    case 'disputed':
    case 'refunded':
    case 'cancelled': return { kind: 'support', label: 'Get help', orderId: order.id };
    default: return { kind: 'link', label: 'View order', href: page, primary: false };
  }
}

/**
 * Statuses shown in a buyer's order list: only orders that have actually been
 * paid into escrow. Unpaid (pending_payment) checkouts stay off the list.
 */
export const PAID_ORDER_STATUSES: EscrowStatus[] = [
  'funded', 'in_transit', 'customs_cleared', 'delivered_pending_verification',
  'released', 'disputed', 'refunded', 'cancelled',
];

/** Grouping for the orders page. */
export type OrderGroup = 'action' | 'escrow' | 'completed' | 'closed';
export function orderGroup(status: EscrowStatus): OrderGroup {
  if (status === 'pending_payment' || status === 'delivered_pending_verification' || status === 'disputed') return 'action';
  if (status === 'funded' || status === 'in_transit' || status === 'customs_cleared') return 'escrow';
  if (status === 'released') return 'completed';
  return 'closed';
}
