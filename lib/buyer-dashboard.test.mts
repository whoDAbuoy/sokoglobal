// Run: npx tsx --test lib/buyer-dashboard.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderPill, shipmentStage, summarizeOrders, trackedOrder, type OrderRow } from './buyer-dashboard.ts';

const row = (id: string, escrow_status: OrderRow['escrow_status'], total_cents: number, created_at = '2026-10-01T00:00:00Z'): OrderRow =>
  ({ id, escrow_status, total_cents, created_at });

test('summarizeOrders: held value counts paid-in-full orders only, closed orders drop out of the total', () => {
  const s = summarizeOrders([
    row('a', 'funded', 50_000), row('b', 'in_transit', 20_000), row('c', 'delivered_pending_verification', 10_000),
    row('d', 'deposit_paid', 100_000), row('e', 'released', 7_000), row('f', 'refunded', 9_999), row('g', 'disputed', 3_000),
  ]);
  assert.equal(s.heldCents, 80_000);
  assert.equal(s.depositOrders, 1);
  assert.equal(s.active, 4);
  assert.equal(s.needsAction, 2);
  assert.equal(s.inTransit, 1);
  assert.equal(s.orderedCents, 50_000 + 20_000 + 10_000 + 100_000 + 7_000 + 3_000);
  assert.deepEqual(summarizeOrders([]), { active: 0, needsAction: 0, heldCents: 0, depositOrders: 0, orderedCents: 0, inTransit: 0 });
});

test('shipmentStage walks the five stages and drops orders that left the pipeline', () => {
  assert.equal(shipmentStage('deposit_paid'), 1);
  assert.equal(shipmentStage('funded'), 2);
  assert.equal(shipmentStage('in_transit'), 3);
  assert.equal(shipmentStage('customs_cleared'), 4);
  assert.equal(shipmentStage('delivered_pending_verification'), 5);
  assert.equal(shipmentStage('released'), 5);
  for (const s of ['pending_payment', 'disputed', 'refunded', 'cancelled'] as const) assert.equal(shipmentStage(s), null, s);
});

test('trackedOrder prefers the newest shipment on the move, then the newest undelivered paid order', () => {
  const orders = [
    row('old-transit', 'in_transit', 1, '2026-09-01T00:00:00Z'),
    row('new-funded', 'funded', 1, '2026-10-20T00:00:00Z'),
    row('new-transit', 'customs_cleared', 1, '2026-10-10T00:00:00Z'),
  ];
  assert.equal(trackedOrder(orders)?.id, 'new-transit');
  assert.equal(trackedOrder([row('f', 'funded', 1), row('r', 'released', 1, '2026-10-25T00:00:00Z')])?.id, 'f');
  assert.equal(trackedOrder([row('r', 'released', 1), row('x', 'refunded', 1)]), null);
});

test('orderPill: buyer wording and tones', () => {
  assert.deepEqual(orderPill('funded'), { label: 'Paid', tone: 'mint' });
  assert.deepEqual(orderPill('in_transit'), { label: 'In transit', tone: 'blue' });
  assert.deepEqual(orderPill('released'), { label: 'Delivered', tone: 'mint' });
  assert.equal(orderPill('disputed').tone, 'rose');
  assert.equal(orderPill('weird_status' as never).label, 'weird status');
});
