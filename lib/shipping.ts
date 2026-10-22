/**
 * Supplier shipments and the buyer's tracking timeline (pure). Contract:
 * public.shipments and supplier_save_shipment() in migration 021.
 */
import type { EscrowStatus } from './types';

export type ShipmentStage = 'label_created' | 'in_transit' | 'out_for_delivery' | 'delivered';
export const SHIPMENT_STAGES: ShipmentStage[] = ['label_created', 'in_transit', 'out_for_delivery', 'delivered'];
export const SHIPMENT_STAGE_LABEL: Record<ShipmentStage, string> = {
  label_created: 'Label created', in_transit: 'Handed to carrier', out_for_delivery: 'Out for delivery', delivered: 'Delivered',
};

/**
 * Carriers offered in the dispatch form. Only carriers with a public tracking
 * page we can link to by waybill get a URL template; for the rest the supplier
 * can paste the carrier's tracking link.
 */
export const CARRIERS: { name: string; trackingUrl?: (waybill: string) => string }[] = [
  { name: 'Sendy' },
  { name: 'DHL Express', trackingUrl: (n) => `https://www.dhl.com/global-en/home/tracking/tracking-express.html?submit=1&tracking-id=${encodeURIComponent(n)}` },
  { name: 'Fargo Courier' },
  { name: 'G4S Courier' },
  { name: 'Wells Fargo Kenya' },
];

const WAYBILL = /^[A-Za-z0-9][A-Za-z0-9 ./_-]*$/;
const stageRank = (s: string) => SHIPMENT_STAGES.indexOf(s as ShipmentStage);

/** The supplier's link if given, else one built from a known carrier's waybill, else none. */
export function trackingLink(s: { carrier_name: string; tracking_number: string; tracking_url?: string | null }): string | null {
  if (s.tracking_url && /^https:\/\/\S+$/.test(s.tracking_url)) return s.tracking_url;
  const carrier = CARRIERS.find((c) => c.name.toLowerCase() === s.carrier_name.trim().toLowerCase());
  return carrier?.trackingUrl ? carrier.trackingUrl(s.tracking_number.trim()) : null;
}

export interface ShipmentDraft { carrier: string; trackingNumber: string; trackingUrl: string | null; estimatedDelivery: string | null; status: ShipmentStage }
type Field = 'carrier' | 'trackingNumber' | 'trackingUrl' | 'estimatedDelivery' | 'status';

/** Same rules as supplier_save_shipment(): forward-only status, waybill format, https link, future ETA on dispatch. */
export function validateShipmentDraft(
  input: { carrier?: unknown; trackingNumber?: unknown; trackingUrl?: unknown; estimatedDelivery?: unknown; status?: unknown },
  existing: { status: string; dispatched_at: string | null } | null,
  now = Date.now(),
): { ok: true; value: ShipmentDraft } | { ok: false; errors: Partial<Record<Field | 'form', string>> } {
  const t = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const errors: Partial<Record<Field | 'form', string>> = {};
  const carrier = t(input.carrier);
  const trackingNumber = t(input.trackingNumber);
  const trackingUrl = t(input.trackingUrl) || null;
  const etaRaw = t(input.estimatedDelivery);
  const status = t(input.status) as ShipmentStage;

  if (carrier.length < 2 || carrier.length > 80) errors.carrier = 'Choose or type the carrier.';
  if (trackingNumber.length < 3 || trackingNumber.length > 80 || !WAYBILL.test(trackingNumber)) errors.trackingNumber = 'Enter the waybill / tracking number (letters, digits, spaces, . / _ -).';
  if (trackingUrl && (!/^https:\/\/\S+$/.test(trackingUrl) || trackingUrl.length > 500)) errors.trackingUrl = 'Tracking links must start with https://';
  if (!SHIPMENT_STAGES.includes(status)) errors.status = 'Choose the shipment stage.';
  else if (existing && stageRank(status) < stageRank(existing.status)) errors.status = `This shipment is already ${SHIPMENT_STAGE_LABEL[existing.status as ShipmentStage]?.toLowerCase() ?? existing.status}; it cannot move back.`;

  let estimatedDelivery: string | null = null;
  if (etaRaw) {
    const ms = Date.parse(etaRaw);
    if (Number.isNaN(ms)) errors.estimatedDelivery = 'Enter a valid date.';
    else {
      estimatedDelivery = new Date(ms).toISOString();
      if (status === 'in_transit' && !existing?.dispatched_at && ms <= now) errors.estimatedDelivery = 'The estimated delivery must be in the future.';
    }
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { carrier, trackingNumber, trackingUrl, estimatedDelivery, status } };
}

// ── Buyer timeline ──────────────────────────────────────────────────────────

export type TimelineKey = 'placed' | 'escrowed' | 'dispatched' | 'delivered';
export interface TimelineStep { key: TimelineKey; label: string; state: 'done' | 'current' | 'upcoming'; at: string | null; detail: string | null }

export interface TimelineOrder {
  escrow_status: EscrowStatus; created_at: string; funded_at?: string | null; deposit_paid_at?: string | null; final_paid_at?: string | null;
  payment_structure?: string | null; discharge_timestamp?: string | null; delivered_at?: string | null; current_status?: string | null;
  eta_timestamp?: string | null;
}
export interface TimelineShipment { status: string; dispatched_at: string | null; delivered_at: string | null; estimated_delivery: string | null; carrier_name: string; tracking_number: string }

const DISPATCHED: string[] = ['in_transit', 'arrived', 'customs_cleared', 'out_for_delivery', 'delivered'];
const PAID: EscrowStatus[] = ['deposit_paid', 'funded', 'in_transit', 'customs_cleared', 'delivered_pending_verification', 'released', 'disputed'];

/** Order Placed → Payment Escrowed → Dispatched → Delivered, from the order row and its shipment. */
export function trackingTimeline(o: TimelineOrder, s: TimelineShipment | null): TimelineStep[] {
  const closed = o.escrow_status === 'cancelled' || o.escrow_status === 'refunded';
  const milestone = o.payment_structure === 'milestone_30_70';
  const paid = !!(o.funded_at || o.deposit_paid_at) || PAID.includes(o.escrow_status);
  const dispatched = (!!s && s.status !== 'label_created') || DISPATCHED.includes(o.current_status ?? '');
  const delivered = s?.status === 'delivered' || o.current_status === 'delivered'
    || o.escrow_status === 'delivered_pending_verification' || o.escrow_status === 'released';

  const reached = [true, paid, dispatched, delivered];
  const firstOpen = reached.indexOf(false);
  const state = (i: number): TimelineStep['state'] => (reached[i] ? 'done' : i === firstOpen && !closed ? 'current' : 'upcoming');

  const escrowDetail = !paid ? (milestone ? 'Pay the 30% deposit to start' : null)
    : milestone && !o.final_paid_at ? '30% deposit held in escrow · 70% due on dispatch'
    : milestone ? 'Deposit and balance held in escrow'
    : 'Held in escrow until you verify the goods';
  const eta = s?.estimated_delivery ?? o.eta_timestamp ?? null;

  return [
    { key: 'placed', label: 'Order placed', state: state(0), at: o.created_at, detail: null },
    { key: 'escrowed', label: 'Payment escrowed', state: state(1), at: o.deposit_paid_at ?? o.funded_at ?? null, detail: escrowDetail },
    { key: 'dispatched', label: 'Dispatched', state: state(2), at: s?.dispatched_at ?? o.discharge_timestamp ?? null,
      detail: s ? `${s.carrier_name} · ${s.tracking_number}` : null },
    { key: 'delivered', label: 'Delivered', state: state(3), at: s?.delivered_at ?? o.delivered_at ?? null,
      detail: delivered ? null : eta ? `Estimated ${new Date(eta).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}` : null },
  ];
}
