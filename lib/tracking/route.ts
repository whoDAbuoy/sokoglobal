/**
 * Great-circle route maths for shipment tracking (pure, framework-free).
 *
 * The marker moves along the route by DISTANCE, not by waypoint index, so a
 * long Atlantic leg takes proportionally longer than a short hop. Between
 * waypoints we follow the great circle (spherical interpolation), which is
 * what aircraft/ships actually fly — a straight line in lat/lng is wrong
 * over intercontinental distances.
 */
export interface GeoPoint { lat: number; lng: number }

export interface Route {
  points: GeoPoint[];
  /** cumulative distance (km) at each point; cum[0] = 0 */
  cum: number[];
  totalKm: number;
}

const R_KM = 6371.0088;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function isGeoPoint(p: unknown): p is GeoPoint {
  if (!p || typeof p !== 'object') return false;
  const { lat, lng } = p as Record<string, unknown>;
  return typeof lat === 'number' && typeof lng === 'number'
    && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

/** Central angle between two points (radians), haversine form — stable for small distances. */
function centralAngle(a: GeoPoint, b: GeoPoint): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const distanceKm = (a: GeoPoint, b: GeoPoint) => centralAngle(a, b) * R_KM;

/** Point at fraction f ∈ [0,1] along the great circle from a to b. */
export function greatCircleInterpolate(a: GeoPoint, b: GeoPoint, f: number): GeoPoint {
  const d = centralAngle(a, b);
  if (d < 1e-12) return { lat: a.lat, lng: a.lng };
  const A = Math.sin((1 - f) * d) / Math.sin(d);
  const B = Math.sin(f * d) / Math.sin(d);
  const φ1 = rad(a.lat), λ1 = rad(a.lng), φ2 = rad(b.lat), λ2 = rad(b.lng);
  const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
  const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
  const z = A * Math.sin(φ1) + B * Math.sin(φ2);
  return { lat: deg(Math.atan2(z, Math.hypot(x, y))), lng: deg(Math.atan2(y, x)) };
}

/** Initial bearing a → b in degrees clockwise from north (for rotating the marker). */
export function bearingDeg(a: GeoPoint, b: GeoPoint): number {
  const φ1 = rad(a.lat), φ2 = rad(b.lat), Δλ = rad(b.lng - a.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** origin → waypoints → destination, dropping invalid points and consecutive duplicates. */
export function buildRoute(origin: GeoPoint, waypoints: unknown, destination: GeoPoint): Route {
  const mids = Array.isArray(waypoints) ? waypoints.filter(isGeoPoint) : [];
  const points = [origin, ...mids, destination].filter(
    (p, i, arr) => i === 0 || distanceKm(arr[i - 1], p) > 0.001,
  );
  const cum = [0];
  for (let i = 1; i < points.length; i += 1) cum.push(cum[i - 1] + distanceKm(points[i - 1], points[i]));
  return { points, cum, totalKm: cum[cum.length - 1] };
}

/**
 * Progress fraction t = (now − discharge) / (eta − discharge).
 * Returns the RAW value (may be < 0 before departure or > 1 after ETA) so the
 * caller can derive status; clamp it for positioning. null if dates are unusable.
 */
export function progressFraction(nowMs: number, dischargeIso: string | null, etaIso: string | null): number | null {
  if (!dischargeIso || !etaIso) return null;
  const start = Date.parse(dischargeIso);
  const end = Date.parse(etaIso);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (end <= start) return nowMs >= end ? 1 : 0;
  return (nowMs - start) / (end - start);
}

export const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/** Position, heading and travelled distance at fraction t of the route's length. */
export function positionAt(route: Route, t: number): { point: GeoPoint; bearing: number; segment: number; travelledKm: number } {
  const { points, cum, totalKm } = route;
  if (points.length === 1 || totalKm === 0) return { point: points[0], bearing: 0, segment: 0, travelledKm: 0 };
  const target = clamp01(t) * totalKm;
  let i = 1;
  while (i < cum.length - 1 && cum[i] < target) i += 1;      // segment [i-1, i] contains target
  const segLen = cum[i] - cum[i - 1];
  const f = segLen === 0 ? 0 : (target - cum[i - 1]) / segLen;
  const a = points[i - 1], b = points[i];
  const point = greatCircleInterpolate(a, b, f);
  // Heading along the great circle at this point (look slightly ahead).
  const ahead = greatCircleInterpolate(a, b, Math.min(1, f + 0.01));
  const bearing = f >= 0.99 ? bearingDeg(greatCircleInterpolate(a, b, 0.98), b) : bearingDeg(point, ahead);
  return { point, bearing, segment: i - 1, travelledKm: target };
}

/** Densify for drawing: each leg becomes a smooth geodesic polyline (~one vertex per stepKm). */
export function densify(points: GeoPoint[], stepKm = 150): GeoPoint[] {
  const out: GeoPoint[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const n = Math.max(1, Math.ceil(distanceKm(points[i - 1], points[i]) / stepKm));
    out.push(points[i - 1]);   // exact vertex (no float drift at joins)
    for (let k = 1; k < n; k += 1) out.push(greatCircleInterpolate(points[i - 1], points[i], k / n));
  }
  out.push(points[points.length - 1]);
  return out;
}

/**
 * Leaflet draws straight lines in lng/lat space; keep consecutive longitudes
 * within ±180° so a route crossing the antimeridian doesn't wrap the world.
 */
export function unwrapLongitudes(points: GeoPoint[]): GeoPoint[] {
  const out: GeoPoint[] = [];
  let offset = 0;
  for (let i = 0; i < points.length; i += 1) {
    if (i > 0) {
      const d = points[i].lng + offset - out[i - 1].lng;
      if (d > 180) offset -= 360; else if (d < -180) offset += 360;
    }
    out.push({ lat: points[i].lat, lng: points[i].lng + offset });
  }
  return out;
}

/** Split a densified path at fraction t into travelled / remaining polylines. */
export function splitAt(route: Route, t: number, stepKm = 150): { travelled: GeoPoint[]; remaining: GeoPoint[]; here: GeoPoint } {
  const { point, segment } = positionAt(route, t);
  const before = [...route.points.slice(0, segment + 1), point];
  const after = [point, ...route.points.slice(segment + 1)];
  return { travelled: densify(before, stepKm), remaining: densify(after, stepKm), here: point };
}

export type DisplayStatus = 'AWAITING_DISPATCH' | 'IN_TRANSIT' | 'ARRIVED' | 'CUSTOMS_CLEARED' | 'OUT_FOR_DELIVERY' | 'DELIVERED';

/**
 * UI status. Ops-reported milestones after arrival win; otherwise time-based
 * progress decides, and t ≥ 1 flips the display to ARRIVED automatically.
 * Display only — escrow state is never changed from the browser.
 */
export function deriveStatus(t: number | null, shipmentStatus: string | null, escrowStatus: string | null): DisplayStatus {
  if (escrowStatus === 'released' || escrowStatus === 'delivered_pending_verification' || shipmentStatus === 'delivered') return 'DELIVERED';
  if (shipmentStatus === 'out_for_delivery') return 'OUT_FOR_DELIVERY';
  if (shipmentStatus === 'customs_cleared' || escrowStatus === 'customs_cleared') return 'CUSTOMS_CLEARED';
  if (shipmentStatus === 'arrived') return 'ARRIVED';
  if (t === null) return 'AWAITING_DISPATCH';
  if (t >= 1) return 'ARRIVED';
  if (t < 0) return 'AWAITING_DISPATCH';
  return 'IN_TRANSIT';
}
