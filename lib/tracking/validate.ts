/**
 * Shipment-tracking input validation, shared by the admin form (instant
 * feedback) and the server action (authoritative). Postgres re-validates
 * coordinates and ETA > discharge via CHECK constraints as a final backstop.
 */
import { isGeoPoint, type GeoPoint } from '@/lib/tracking/route';

export const SHIPMENT_STATUSES = [
  'awaiting_dispatch', 'in_transit', 'arrived', 'customs_cleared', 'out_for_delivery', 'delivered',
] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

export const MAX_WAYPOINTS = 500;
const MAX_TRANSIT_DAYS = 120;
const DAY = 86_400_000;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** `{"lat": 6.5774, "lng": 3.3212}` → GeoPoint. Empty input → null (keep existing). */
export function parsePointJson(text: string): ParseResult<GeoPoint | null> {
  const t = text.trim();
  if (!t) return { ok: true, value: null };
  let v: unknown;
  try { v = JSON.parse(t); } catch { return { ok: false, error: 'Not valid JSON — expected {"lat": 6.57, "lng": 3.32}' }; }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { ok: false, error: 'Expected an object {"lat": …, "lng": …}' };
  const keys = Object.keys(v);
  if (keys.some((k) => k !== 'lat' && k !== 'lng')) return { ok: false, error: 'Only "lat" and "lng" keys are allowed' };
  if (!isGeoPoint(v)) return { ok: false, error: 'lat must be −90…90 and lng −180…180 (numbers, not strings)' };
  return { ok: true, value: { lat: (v as GeoPoint).lat, lng: (v as GeoPoint).lng } };
}

/** `[{"lat":…, "lng":…}, …]` → GeoPoint[]. Empty input → null (keep existing); "[]" clears. */
export function parsePathJson(text: string): ParseResult<GeoPoint[] | null> {
  const t = text.trim();
  if (!t) return { ok: true, value: null };
  let v: unknown;
  try { v = JSON.parse(t); } catch { return { ok: false, error: 'Not valid JSON — expected [{"lat": …, "lng": …}, …]' }; }
  if (!Array.isArray(v)) return { ok: false, error: 'Expected a JSON array of points' };
  if (v.length > MAX_WAYPOINTS) return { ok: false, error: `At most ${MAX_WAYPOINTS} waypoints` };
  const out: GeoPoint[] = [];
  for (let i = 0; i < v.length; i += 1) {
    const r = parsePointJson(JSON.stringify(v[i]));
    if (!r.ok || !r.value) return { ok: false, error: `Waypoint #${i + 1}: ${r.ok ? 'empty' : r.error}` };
    out.push(r.value);
  }
  return { ok: true, value: out };
}

export interface TrackingDraft {
  status: string;
  discharge: string | null;      // ISO 8601 (UTC) or null = keep existing
  eta: string | null;
  originText: string;
  destinationText: string;
  waypointsText: string;
  originLabel: string;
  destinationLabel: string;
}

export interface ExistingTracking {
  discharge_timestamp: string | null;
  eta_timestamp: string | null;
  origin_port_coords: GeoPoint | null;
  destination_coords: GeoPoint | null;
  escrow_status: string;
}

export interface ValidTracking {
  status: ShipmentStatus;
  discharge: string | null;
  eta: string | null;
  origin: GeoPoint | null;
  destination: GeoPoint | null;
  waypoints: GeoPoint[] | null;
  originLabel: string | null;
  destinationLabel: string | null;
}

export type FieldErrors = Partial<Record<'status' | 'discharge' | 'eta' | 'origin' | 'destination' | 'waypoints' | 'originLabel' | 'destinationLabel' | 'form', string>>;

const validIso = (s: string | null) => (s === null ? true : Number.isFinite(Date.parse(s)));

/**
 * Validate a draft against the order's current values. Mirrors the RPC's
 * semantics: empty fields keep what's stored (COALESCE), so rules such as
 * "ETA after departure" are checked on the MERGED result.
 */
export function validateTracking(d: TrackingDraft, existing: ExistingTracking, nowMs = Date.now()):
  { ok: true; value: ValidTracking } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};

  const status = SHIPMENT_STATUSES.find((s) => s === d.status);
  if (!status) errors.status = 'Choose a shipment status';

  if (!validIso(d.discharge)) errors.discharge = 'Invalid date';
  if (!validIso(d.eta)) errors.eta = 'Invalid date';

  const origin = parsePointJson(d.originText);
  if (!origin.ok) errors.origin = origin.error;
  const destination = parsePointJson(d.destinationText);
  if (!destination.ok) errors.destination = destination.error;
  const waypoints = parsePathJson(d.waypointsText);
  if (!waypoints.ok) errors.waypoints = waypoints.error;

  if (d.originLabel.length > 80) errors.originLabel = 'Max 80 characters';
  if (d.destinationLabel.length > 80) errors.destinationLabel = 'Max 80 characters';

  // ── Merged-state rules ──
  const discharge = d.discharge ?? existing.discharge_timestamp;
  const eta = d.eta ?? existing.eta_timestamp;
  if (!errors.discharge && !errors.eta && discharge && eta) {
    const s = Date.parse(discharge), e = Date.parse(eta);
    if (e <= s) errors.eta = 'ETA must be after departure (discharge)';
    else if (e - s > MAX_TRANSIT_DAYS * DAY) errors.eta = `Transit longer than ${MAX_TRANSIT_DAYS} days — check the dates`;
  }
  if (!errors.discharge && d.discharge && Math.abs(Date.parse(d.discharge) - nowMs) > 365 * DAY) {
    errors.discharge = 'Departure is more than a year from today — check the year';
  }

  const mergedOrigin = origin.ok ? origin.value ?? existing.origin_port_coords : null;
  const mergedDest = destination.ok ? destination.value ?? existing.destination_coords : null;
  if (status && status !== 'awaiting_dispatch') {
    if (!discharge && !errors.discharge) errors.discharge = 'Required once the shipment has left';
    if (!eta && !errors.eta) errors.eta = 'Required once the shipment has left';
    if (!mergedOrigin && !errors.origin) errors.origin = 'Required once the shipment has left';
    if (!mergedDest && !errors.destination) errors.destination = 'Required once the shipment has left';
  }
  if (status && status !== 'awaiting_dispatch' && existing.escrow_status === 'pending_payment') {
    errors.status = 'Order is not paid yet — it can only be "Awaiting dispatch"';
  }
  if (['released', 'refunded', 'cancelled'].includes(existing.escrow_status)) {
    errors.form = `Order is closed (${existing.escrow_status}); tracking can no longer change`;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      status: status!,
      discharge: d.discharge, eta: d.eta,
      origin: origin.ok ? origin.value : null,
      destination: destination.ok ? destination.value : null,
      waypoints: waypoints.ok ? waypoints.value : null,
      originLabel: d.originLabel.trim() || null,
      destinationLabel: d.destinationLabel.trim() || null,
    },
  };
}

/** Escrow effect of a status (mirrors the forward-only sync in set_shipment_tracking). */
export function escrowEffect(status: ShipmentStatus, escrow: string): string | null {
  const rank = ['funded', 'in_transit', 'customs_cleared', 'delivered_pending_verification'];
  const target: Record<ShipmentStatus, string | null> = {
    awaiting_dispatch: null, in_transit: 'in_transit', arrived: 'in_transit',
    customs_cleared: 'customs_cleared', out_for_delivery: 'customs_cleared', delivered: 'delivered_pending_verification',
  };
  const t = target[status];
  if (!t || !rank.includes(escrow) || rank.indexOf(t) <= rank.indexOf(escrow)) return null;
  return t;
}

/** Common hubs for quick entry. Airport coordinates (consolidated air freight). */
export const HUBS: { code: string; name: string; lat: number; lng: number; side: 'origin' | 'transit' | 'destination' }[] = [
  { code: 'LHR', name: 'London Heathrow', lat: 51.47, lng: -0.4543, side: 'origin' },
  { code: 'CDG', name: 'Paris Charles de Gaulle', lat: 49.0097, lng: 2.5479, side: 'origin' },
  { code: 'FRA', name: 'Frankfurt', lat: 50.0379, lng: 8.5622, side: 'origin' },
  { code: 'AMS', name: 'Amsterdam Schiphol', lat: 52.3105, lng: 4.7683, side: 'origin' },
  { code: 'JFK', name: 'New York JFK', lat: 40.6413, lng: -73.7781, side: 'origin' },
  { code: 'ATL', name: 'Atlanta', lat: 33.6407, lng: -84.4277, side: 'origin' },
  { code: 'ICN', name: 'Seoul Incheon', lat: 37.4602, lng: 126.4407, side: 'origin' },
  { code: 'DXB', name: 'Dubai', lat: 25.2532, lng: 55.3657, side: 'transit' },
  { code: 'DOH', name: 'Doha', lat: 25.2731, lng: 51.6081, side: 'transit' },
  { code: 'IST', name: 'Istanbul', lat: 41.2753, lng: 28.7519, side: 'transit' },
  { code: 'ADD', name: 'Addis Ababa', lat: 8.9779, lng: 38.7993, side: 'transit' },
  { code: 'LOS', name: 'Lagos', lat: 6.5774, lng: 3.3212, side: 'destination' },
  { code: 'ABV', name: 'Abuja', lat: 9.0068, lng: 7.2632, side: 'destination' },
  { code: 'NBO', name: 'Nairobi JKIA', lat: -1.3192, lng: 36.9278, side: 'destination' },
  { code: 'ACC', name: 'Accra', lat: 5.6052, lng: -0.1668, side: 'destination' },
  { code: 'JNB', name: 'Johannesburg', lat: -26.1367, lng: 28.2411, side: 'destination' },
  { code: 'DAR', name: 'Dar es Salaam', lat: -6.8781, lng: 39.2026, side: 'destination' },
  { code: 'EBB', name: 'Entebbe', lat: 0.0424, lng: 32.4435, side: 'destination' },
  { code: 'KGL', name: 'Kigali', lat: -1.9686, lng: 30.1395, side: 'destination' },
  { code: 'DSS', name: 'Dakar', lat: 14.67, lng: -17.0733, side: 'destination' },
  { code: 'ABJ', name: 'Abidjan', lat: 5.2614, lng: -3.9263, side: 'destination' },
];
