// Run: npx tsx --test lib/tracking/validate.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escrowEffect, parsePathJson, parsePointJson, validateTracking, type TrackingDraft } from './validate.ts';

const empty = { discharge_timestamp: null, eta_timestamp: null, origin_port_coords: null, destination_coords: null, escrow_status: 'funded' };
const draft = (over: Partial<TrackingDraft> = {}): TrackingDraft => ({
  status: 'in_transit', discharge: '2026-10-01T08:00:00.000Z', eta: '2026-10-06T08:00:00.000Z',
  originText: '{"lat":51.47,"lng":-0.4543}', destinationText: '{"lat":-1.3192,"lng":36.9278}',
  waypointsText: '[{"lat":25.2532,"lng":55.3657}]', originLabel: 'London LHR', destinationLabel: 'Nairobi JKIA', ...over,
});
const NOW = Date.parse('2026-10-03T00:00:00Z');

test('point JSON parsing', () => {
  assert.deepEqual(parsePointJson(' {"lat": 6.5774, "lng": 3.3212} '), { ok: true, value: { lat: 6.5774, lng: 3.3212 } });
  assert.equal(parsePointJson('').ok && parsePointJson('').value, null);
  assert.equal(parsePointJson('{lat: 6}').ok, false);                    // not JSON
  assert.equal(parsePointJson('{"lat":"6.5","lng":3}').ok, false);       // string number
  assert.equal(parsePointJson('{"lat":95,"lng":3}').ok, false);          // out of range
  assert.equal(parsePointJson('[6.5, 3.3]').ok, false);                  // array, not object
  assert.equal(parsePointJson('{"lat":6,"lng":3,"x":1}').ok, false);     // extra keys
});

test('path JSON parsing', () => {
  assert.equal(parsePathJson('[]').ok && (parsePathJson('[]') as any).value.length, 0);
  const bad = parsePathJson('[{"lat":1,"lng":2},{"lat":1}]');
  assert.equal(bad.ok, false);
  assert.match((bad as any).error, /Waypoint #2/);
  assert.equal(parsePathJson(JSON.stringify(Array(501).fill({ lat: 0, lng: 0 }))).ok, false);
});

test('valid in-transit draft', () => {
  const r = validateTracking(draft(), empty, NOW);
  assert.equal(r.ok, true);
});

test('ETA must be after discharge (checked on merged values)', () => {
  const r = validateTracking(draft({ eta: '2026-09-30T08:00:00.000Z' }), empty, NOW);
  assert.equal(r.ok, false);
  assert.match((r as any).errors.eta, /after departure/);
  // only ETA changed, discharge kept from DB
  const r2 = validateTracking(draft({ discharge: null, eta: '2026-09-01T00:00:00Z' }),
    { ...empty, discharge_timestamp: '2026-10-01T00:00:00Z' }, NOW);
  assert.equal(r2.ok, false);
});

test('in transit requires schedule and endpoints (from draft or DB)', () => {
  const r = validateTracking(draft({ discharge: null, eta: null, originText: '', destinationText: '' }), empty, NOW);
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys((r as any).errors).sort(), ['destination', 'discharge', 'eta', 'origin']);
  const r2 = validateTracking(draft({ discharge: null, eta: null, originText: '', destinationText: '' }), {
    ...empty, discharge_timestamp: '2026-10-01T00:00:00Z', eta_timestamp: '2026-10-05T00:00:00Z',
    origin_port_coords: { lat: 1, lng: 1 }, destination_coords: { lat: 2, lng: 2 } }, NOW);
  assert.equal(r2.ok, true, 'existing values satisfy the requirement');
});

test('awaiting dispatch allows an empty schedule', () => {
  assert.equal(validateTracking(draft({ status: 'awaiting_dispatch', discharge: null, eta: null, originText: '', destinationText: '', waypointsText: '' }), empty, NOW).ok, true);
});

test('unpaid order cannot ship; closed order cannot change; typo years caught', () => {
  assert.match((validateTracking(draft(), { ...empty, escrow_status: 'pending_payment' }, NOW) as any).errors.status, /not paid/);
  assert.match((validateTracking(draft(), { ...empty, escrow_status: 'released' }, NOW) as any).errors.form, /closed/);
  assert.match((validateTracking(draft({ discharge: '2062-10-01T00:00:00Z', eta: '2062-10-05T00:00:00Z' }), empty, NOW) as any).errors.discharge, /year/);
  assert.match((validateTracking(draft({ eta: '2027-06-01T00:00:00Z' }), empty, NOW) as any).errors.eta, /120 days/);
});

test('escrow effect preview is forward-only', () => {
  assert.equal(escrowEffect('in_transit', 'funded'), 'in_transit');
  assert.equal(escrowEffect('delivered', 'customs_cleared'), 'delivered_pending_verification');
  assert.equal(escrowEffect('in_transit', 'customs_cleared'), null);
  assert.equal(escrowEffect('awaiting_dispatch', 'funded'), null);
});
