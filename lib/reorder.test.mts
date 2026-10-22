// Run: npx tsx --conditions=react-server --test lib/reorder.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reorderLines, restockDue, type ReorderSource } from './reorder.ts';

const product = (title: string, extra: Partial<NonNullable<ReorderSource['product']>> = {}) => ({
  status: 'live', title, supplier_name: 'Sup Co', image_url: null, category: 'general' as const, landed_cost_cents: 57_000, ...extra,
});

test('reorderLines: one line per listing from its latest completed order, same batch count', () => {
  const { lines, unavailable } = reorderLines([
    { order_id: 'o1', product_id: 'tee', batches: 2, completed_at: '2026-08-01T00:00:00Z', product: product('Tee') },
    { order_id: 'o2', product_id: 'tee', batches: 5, completed_at: '2026-09-01T00:00:00Z', product: product('Tee') },
    { order_id: 'o3', product_id: 'mango', batches: 1, completed_at: '2026-09-10T00:00:00Z', product: product('Mango', { landed_cost_cents: 60_000 }) },
    { order_id: 'o4', product_id: 'gone', batches: 1, completed_at: '2026-09-11T00:00:00Z', product: null },
    { order_id: 'o5', product_id: 'paused', batches: 1, completed_at: '2026-09-12T00:00:00Z', product: product('Paused', { status: 'archived' }) },
  ]);
  assert.deepEqual(lines.map((l) => [l.productId, l.quantity, l.fromOrderId]), [['mango', 1, 'o3'], ['tee', 5, 'o2']]);
  assert.equal(lines[0].landedCostCents, 60_000);   // today's price, not the old order's
  assert.deepEqual(unavailable.sort(), ['o4', 'o5']);
});

test('reorderLines clamps batches and caps the cart at 10 lines', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({
    order_id: `o${i}`, product_id: `p${i}`, batches: i === 0 ? 99 : null, completed_at: `2026-09-${String(i + 1).padStart(2, '0')}T00:00:00Z`, product: product(`P${i}`),
  }));
  const { lines } = reorderLines(many);
  assert.equal(lines.length, 10);
  assert.equal(lines.find((l) => l.productId === 'p0'), undefined);   // oldest dropped first
  assert.ok(lines.every((l) => l.quantity === 1));
  assert.equal(reorderLines([many[0]]).lines[0].quantity, 20);
});

test('restockDue: 30- and 60-day reminders with a 7-day catch-up window', () => {
  const now = Date.parse('2026-10-22T00:00:00Z');
  const daysAgo = (d: number) => new Date(now - d * 86_400_000).toISOString();
  assert.equal(restockDue(daysAgo(29), now), null);
  assert.equal(restockDue(daysAgo(30), now), 30);
  assert.equal(restockDue(daysAgo(37), now), 30);
  assert.equal(restockDue(daysAgo(45), now), null);
  assert.equal(restockDue(daysAgo(61), now), 60);
  assert.equal(restockDue(null, now), null);
});
