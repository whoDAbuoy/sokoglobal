// Run: npx tsx --conditions=react-server --test lib/shipping.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trackingLink, trackingTimeline, validateShipmentDraft, type TimelineOrder } from './shipping.ts';

const NOW = Date.parse('2026-10-22T12:00:00Z');

test('validateShipmentDraft: waybill format, https links, future ETA, forward-only stage', () => {
  const ok = validateShipmentDraft({ carrier: ' DHL Express ', trackingNumber: 'JD0146 00006', estimatedDelivery: '2026-10-28', status: 'in_transit' }, null, NOW);
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.value.estimatedDelivery, '2026-10-28T00:00:00.000Z');

  const bad = validateShipmentDraft({ carrier: 'x', trackingNumber: '<script>', trackingUrl: 'http://track.example', estimatedDelivery: '2026-10-01', status: 'in_transit' }, null, NOW);
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.deepEqual(Object.keys(bad.errors).sort(), ['carrier', 'estimatedDelivery', 'trackingNumber', 'trackingUrl']);

  const back = validateShipmentDraft({ carrier: 'Sendy', trackingNumber: 'SND-123', status: 'label_created' }, { status: 'in_transit', dispatched_at: '2026-10-20' }, NOW);
  assert.equal(back.ok, false);
  // An ETA in the past is fine once the parcel has already been dispatched (later updates).
  assert.equal(validateShipmentDraft({ carrier: 'Sendy', trackingNumber: 'SND-123', estimatedDelivery: '2026-10-21', status: 'in_transit' },
    { status: 'in_transit', dispatched_at: '2026-10-20' }, NOW).ok, true);
});

test('trackingLink prefers the supplier link, then a known carrier, else none', () => {
  assert.equal(trackingLink({ carrier_name: 'Sendy', tracking_number: 'S1', tracking_url: 'https://sendy.example/t/S1' }), 'https://sendy.example/t/S1');
  assert.match(trackingLink({ carrier_name: 'dhl express', tracking_number: 'JD 1' })!, /^https:\/\/www\.dhl\.com\/.*tracking-id=JD%201$/);
  assert.equal(trackingLink({ carrier_name: 'Fargo Courier', tracking_number: 'F1' }), null);
  assert.equal(trackingLink({ carrier_name: 'Sendy', tracking_number: 'S1', tracking_url: 'javascript:alert(1)' }), null);
});

const order = (extra: Partial<TimelineOrder> = {}): TimelineOrder => ({ escrow_status: 'pending_payment', created_at: '2026-10-01T09:00:00Z', ...extra });
const states = (o: TimelineOrder, s: Parameters<typeof trackingTimeline>[1] = null) => trackingTimeline(o, s).map((x) => x.state);
const SHIP = { status: 'in_transit', dispatched_at: '2026-10-05T10:00:00Z', delivered_at: null, estimated_delivery: '2026-10-12T00:00:00Z', carrier_name: 'DHL Express', tracking_number: 'JD1' };

test('timeline: placed → escrowed → dispatched → delivered', () => {
  assert.deepEqual(states(order()), ['done', 'current', 'upcoming', 'upcoming']);
  assert.deepEqual(states(order({ escrow_status: 'funded', funded_at: '2026-10-02' })), ['done', 'done', 'current', 'upcoming']);
  const shipped = trackingTimeline(order({ escrow_status: 'in_transit', funded_at: '2026-10-02', current_status: 'in_transit' }), SHIP);
  assert.deepEqual(shipped.map((x) => x.state), ['done', 'done', 'done', 'current']);
  assert.equal(shipped[2].detail, 'DHL Express · JD1');
  assert.equal(shipped[3].detail, 'Estimated 12 Oct');
  assert.deepEqual(states(order({ escrow_status: 'released', funded_at: '2026-10-02' }), { ...SHIP, status: 'delivered', delivered_at: '2026-10-11' }), ['done', 'done', 'done', 'done']);
});

test('timeline: milestone orders say what is held and what is due', () => {
  const t = trackingTimeline(order({ escrow_status: 'deposit_paid', payment_structure: 'milestone_30_70', deposit_paid_at: '2026-10-02', funded_at: '2026-10-02' }), null);
  assert.equal(t[1].state, 'done');
  assert.match(t[1].detail!, /30% deposit held/);
  assert.equal(t[2].state, 'current');
  assert.match(trackingTimeline(order({ payment_structure: 'milestone_30_70' }), null)[1].detail!, /deposit to start/);
});

test('timeline: an order cancelled before payment has no current step', () => {
  assert.deepEqual(states(order({ escrow_status: 'cancelled' })), ['done', 'upcoming', 'upcoming', 'upcoming']);
});
