// Run: npx tsx --test lib/supplier-pipeline.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterPipeline, laneCounts, laneOf, payoutSummary, releaseSplit, type PipelineOrder } from './supplier-pipeline.ts';

const o = (id: string, escrow_status: PipelineOrder['escrow_status'], total_cents: number, created_at: string, product_title = 'Shea Butter'): PipelineOrder =>
  ({ id, escrow_status, total_cents, created_at, product_title });

test('lanes follow the escrow lifecycle', () => {
  assert.equal(laneOf('pending_payment'), 'awaiting');
  assert.equal(laneOf('funded'), 'escrow');
  assert.equal(laneOf('in_transit'), 'transit');
  assert.equal(laneOf('customs_cleared'), 'transit');
  assert.equal(laneOf('delivered_pending_verification'), 'verify');
  assert.equal(laneOf('released'), 'completed');
  for (const s of ['disputed', 'refunded', 'cancelled'] as const) assert.equal(laneOf(s), 'issue');
});

const orders = [
  o('aaaa1111', 'funded', 600_00, '2026-10-01T00:00:00Z'),
  o('bbbb2222', 'in_transit', 900_00, '2026-10-05T00:00:00Z', 'Linen Shirts'),
  o('cccc3333', 'released', 500_00, '2026-09-01T00:00:00Z'),
  o('dddd4444', 'pending_payment', 700_00, '2026-10-10T00:00:00Z'),
];

test('filter, search and sort', () => {
  assert.deepEqual(filterPipeline(orders, 'all').map((x) => x.id), ['dddd4444', 'bbbb2222', 'aaaa1111', 'cccc3333']);
  assert.deepEqual(filterPipeline(orders, 'all', '', 'oldest').map((x) => x.id)[0], 'cccc3333');
  assert.deepEqual(filterPipeline(orders, 'all', '', 'value').map((x) => x.id)[0], 'bbbb2222');
  assert.deepEqual(filterPipeline(orders, 'transit').map((x) => x.id), ['bbbb2222']);
  assert.deepEqual(filterPipeline(orders, 'all', 'linen').map((x) => x.id), ['bbbb2222']);
  assert.deepEqual(filterPipeline(orders, 'all', 'cccc').map((x) => x.id), ['cccc3333']);
  assert.deepEqual(laneCounts(orders), { awaiting: 1, escrow: 1, transit: 1, verify: 0, completed: 1, issue: 0 });
});

test('payout dial and release split', () => {
  const p = payoutSummary([{ status: 'succeeded', amount_cents: 300_00 }, { status: 'processing', amount_cents: 100_00 }]);
  assert.equal(p.total, 400_00);
  assert.equal(p.paidPct, 75);
  assert.equal(payoutSummary([]).paidPct, 0);
  const r = releaseSplit(orders);
  assert.equal(r.released, 500_00);
  assert.equal(r.held, 1500_00);
  assert.equal(r.awaiting, 700_00);
  assert.equal(Math.round(r.releasedPct + r.heldPct + r.awaitingPct), 100);
  assert.deepEqual(releaseSplit([]), { released: 0, held: 0, awaiting: 0, releasedPct: 0, heldPct: 0, awaitingPct: 0 });
});
