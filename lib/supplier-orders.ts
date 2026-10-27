/**
 * Supplier order catalogue (pure): paid orders waiting to ship, grouped per listing.
 * Contract: get_supplier_grouped_catalog() and orders.fulfillment_status (migration 018).
 */
import type { EscrowStatus } from './types';

export interface BuyerLine {
  order_id: string; quantity: number; batches: number; goods_cents: number; paid_at: string | null;
  buyer_company: string | null; buyer_country: string | null; destination: string | null; eta: string | null;
  shipment_status: string | null; tracking_number: string | null; carrier: string | null;
  /** Migration 021: milestone orders arrive with only the 30% deposit paid; quoted orders come from an RFQ. */
  payment_structure?: string | null; escrow_status?: string | null; is_rfq?: boolean;
}

export interface ListingGroup {
  listing_id: string; title: string; image_url: string | null; unit_of_measure: string | null;
  order_count: number; total_quantity: number; total_batches: number; total_goods_cents: number; total_landed_cents: number;
  oldest_paid_at: string | null; orders: BuyerLine[];
}

/** Same derivation as the orders.fulfillment_status generated column. */
export function fulfillmentStatus(o: { escrow_status: EscrowStatus | string; current_status?: string | null; funded_at?: string | null }): string {
  switch (o.escrow_status) {
    case 'pending_payment': return 'awaiting_payment';
    case 'cancelled': return o.funded_at ? 'closed' : 'void';
    case 'refunded': return 'closed';
    case 'released': return 'completed';
    case 'disputed': return 'on_hold';
    case 'delivered_pending_verification': return 'delivered';
    case 'funded': return (o.current_status ?? 'awaiting_dispatch') === 'awaiting_dispatch' ? 'pending_fulfillment' : 'in_fulfillment';
    default: return 'in_fulfillment';
  }
}

/** What a supplier may ever see: never unpaid, never cancelled-before-payment. */
export const visibleToSupplier = (o: Parameters<typeof fulfillmentStatus>[0]) => !['awaiting_payment', 'void'].includes(fulfillmentStatus(o));

const num = (v: unknown) => (typeof v === 'number' ? v : Number(v ?? 0)) || 0;
const str = (v: unknown) => (typeof v === 'string' && v ? v : null);

/** RPC rows → typed groups (bigint sums arrive as numbers or strings). */
export function parseGroupedCatalog(rows: unknown): ListingGroup[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((r: Record<string, unknown>) => ({
    listing_id: String(r.listing_id), title: String(r.title ?? 'Listing'), image_url: str(r.image_url), unit_of_measure: str(r.unit_of_measure),
    order_count: num(r.order_count), total_quantity: num(r.total_quantity), total_batches: num(r.total_batches),
    total_goods_cents: num(r.total_goods_cents), total_landed_cents: num(r.total_landed_cents), oldest_paid_at: str(r.oldest_paid_at),
    orders: (Array.isArray(r.orders) ? r.orders : []).map((o: Record<string, unknown>) => ({
      order_id: String(o.order_id), quantity: num(o.quantity), batches: num(o.batches) || 1, goods_cents: num(o.goods_cents), paid_at: str(o.paid_at),
      buyer_company: str(o.buyer_company), buyer_country: str(o.buyer_country), destination: str(o.destination), eta: str(o.eta),
      shipment_status: str(o.shipment_status), tracking_number: str(o.tracking_number), carrier: str(o.carrier),
      payment_structure: str(o.payment_structure), escrow_status: str(o.escrow_status), is_rfq: o.is_rfq === true,
    })),
  }));
}

export function catalogTotals(groups: readonly ListingGroup[]) {
  return groups.reduce((t, g) => ({ listings: t.listings + 1, orders: t.orders + g.order_count, goodsCents: t.goodsCents + g.total_goods_cents }),
    { listings: 0, orders: 0, goodsCents: 0 });
}
