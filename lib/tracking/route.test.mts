// Run: npx tsx --test lib/tracking/route.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRoute, bearingDeg, deriveStatus, distanceKm, greatCircleInterpolate, positionAt,
  progressFraction, splitAt, unwrapLongitudes,
} from './route.ts';

const LHR = { lat: 51.47, lng: -0.4543 };   // London Heathrow
const LOS = { lat: 6.5774, lng: 3.3212 };   // Lagos Murtala Muhammed
const NBO = { lat: -1.3192, lng: 36.9278 }; // Nairobi JKIA
const ICN = { lat: 37.4602, lng: 126.4407 };// Seoul Incheon

test('progress fraction: before, during, at and after ETA', () => {
  const d = '2026-10-01T00:00:00Z', e = '2026-10-11T00:00:00Z';
  assert.equal(progressFraction(Date.parse('2026-09-30T00:00:00Z'), d, e), -0.1);
  assert.equal(progressFraction(Date.parse('2026-10-06T00:00:00Z'), d, e), 0.5);
  assert.equal(progressFraction(Date.parse(e), d, e), 1);
  assert.ok(progressFraction(Date.parse('2026-10-12T00:00:00Z'), d, e)! > 1);
  assert.equal(progressFraction(0, null, e), null);
  assert.equal(progressFraction(0, 'garbage', e), null);
  assert.equal(progressFraction(Date.parse(e), e, d), 1, 'eta <= discharge is treated as arrived once past eta');
});

test('distance sanity: London→Lagos ≈ 5,000 km', () => {
  const km = distanceKm(LHR, LOS);
  assert.ok(km > 4900 && km < 5100, `got ${km}`);
});

test('great-circle midpoint is equidistant from both ends', () => {
  const mid = greatCircleInterpolate(LHR, NBO, 0.5);
  assert.ok(Math.abs(distanceKm(LHR, mid) - distanceKm(mid, NBO)) < 0.5);
});

test('positionAt moves by distance, not by waypoint index', () => {
  // Short first leg (LHR→Paris), long second leg (Paris→Lagos)
  const CDG = { lat: 49.0097, lng: 2.5479 };
  const route = buildRoute(LHR, [CDG], LOS);
  const atTen = positionAt(route, 0.1);
  assert.equal(atTen.segment, 1, '10% of the way is already past the short LHR–CDG leg');
  assert.ok(Math.abs(atTen.travelledKm - route.totalKm * 0.1) < 1e-6);
});

test('endpoints and clamping', () => {
  const route = buildRoute(LHR, [], LOS);
  const s = positionAt(route, -3).point, e = positionAt(route, 7).point;
  assert.ok(distanceKm(s, LHR) < 0.01 && distanceKm(e, LOS) < 0.01);
});

test('invalid waypoints and duplicates are dropped', () => {
  const route = buildRoute(LHR, [{ lat: 999, lng: 0 }, 'x', LHR, { lat: 30, lng: 5 }], LOS);
  assert.equal(route.points.length, 3);
});

test('bearing London→Lagos is roughly south', () => {
  const b = bearingDeg(LHR, LOS);
  assert.ok(b > 150 && b < 200, `got ${b}`);
});

test('split keeps the current point on both halves', () => {
  const route = buildRoute(ICN, [{ lat: 25.2532, lng: 55.3657 }], NBO);  // via Dubai
  const { travelled, remaining, here } = splitAt(route, 0.4);
  assert.deepEqual(travelled.at(-1), here);
  assert.deepEqual(remaining[0], here);
});

test('antimeridian unwrap keeps longitudes continuous', () => {
  const out = unwrapLongitudes([{ lat: 0, lng: 170 }, { lat: 0, lng: -175 }, { lat: 0, lng: -160 }]);
  assert.deepEqual(out.map((p) => p.lng), [170, 185, 200]);
});

test('status: auto ARRIVED at t ≥ 1; ops milestones win', () => {
  assert.equal(deriveStatus(null, 'awaiting_dispatch', 'funded'), 'AWAITING_DISPATCH');
  assert.equal(deriveStatus(-0.2, 'in_transit', 'in_transit'), 'AWAITING_DISPATCH');
  assert.equal(deriveStatus(0.5, 'in_transit', 'in_transit'), 'IN_TRANSIT');
  assert.equal(deriveStatus(1, 'in_transit', 'in_transit'), 'ARRIVED');
  assert.equal(deriveStatus(1.4, 'in_transit', 'in_transit'), 'ARRIVED');
  assert.equal(deriveStatus(1, 'customs_cleared', 'customs_cleared'), 'CUSTOMS_CLEARED');
  assert.equal(deriveStatus(0.3, 'delivered', 'delivered_pending_verification'), 'DELIVERED');
});
