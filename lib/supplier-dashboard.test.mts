// Run: npx tsx --test lib/supplier-dashboard.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  categoryShares, compactUSD, rollingAverage, countSince, dailySeries, growthPct, heatLevel, orderHeatmap, productSales, splinePath,
} from './supplier-dashboard.ts';

const NOW = new Date('2026-10-26T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

test('growthPct compares the last 30 days with the 30 before', () => {
  assert.equal(growthPct([daysAgo(1), daysAgo(2), daysAgo(40)], NOW), 100);
  assert.equal(growthPct([daysAgo(1), daysAgo(35), daysAgo(45)], NOW), -50);
  assert.equal(growthPct([daysAgo(1)], NOW), null, 'nothing earlier to compare with');
  assert.equal(growthPct([daysAgo(70), 'not a date'], NOW), null, 'older rows and junk are ignored');
});

test('countSince counts the recent window only', () => {
  assert.equal(countSince([daysAgo(1), daysAgo(29), daysAgo(31)], NOW), 2);
});

test('dailySeries buckets by UTC day, oldest first, today last', () => {
  const s = dailySeries([
    { created_at: '2026-10-26T01:00:00Z', cents: 500 },
    { created_at: '2026-10-26T23:00:00Z', cents: 250 },
    { created_at: '2026-10-20T10:00:00Z', cents: 1000 },
    { created_at: '2026-08-01T10:00:00Z', cents: 9999 }, // outside the window
  ], NOW, 7);
  assert.equal(s.length, 7);
  assert.equal(s[0].date, '2026-10-20');
  assert.equal(s[0].cents, 1000);
  assert.equal(s[6].date, '2026-10-26');
  assert.equal(s[6].cents, 750);
  assert.equal(s[6].label, '26 Oct');
  assert.equal(s.reduce((n, p) => n + p.cents, 0), 1750);
});

test('orderHeatmap puts Monday first and uses four-hour UTC slots', () => {
  // 2026-10-26 is a Monday; 2026-10-25 a Sunday.
  const h = orderHeatmap(['2026-10-26T09:30:00Z', '2026-10-26T10:00:00Z', '2026-10-25T23:59:00Z', 'junk']);
  assert.equal(h.cells.length, 6);
  assert.equal(h.cells[0].length, 7);
  assert.equal(h.cells[2][0], 2, 'Mon 08:00–12:00');
  assert.equal(h.cells[5][6], 1, 'Sun 20:00–24:00');
  assert.equal(h.total, 3);
  assert.equal(h.max, 2);
});

test('heatLevel steps 0..4', () => {
  assert.equal(heatLevel(0, 10), 0);
  assert.equal(heatLevel(1, 10), 1);
  assert.equal(heatLevel(5, 10), 2);
  assert.equal(heatLevel(10, 10), 4);
  assert.equal(heatLevel(3, 0), 0);
});

test('categoryShares folds the tail into Other and sums to exactly 100', () => {
  const s = categoryShares([
    { category: 'beauty', cents: 333 }, { category: 'apparel', cents: 333 }, { category: 'electronics', cents: 333 },
    { category: 'food', cents: 1 }, { category: 'beauty', cents: 0 },
  ]);
  assert.deepEqual(s.map((x) => x.key), ['apparel', 'beauty', 'electronics', 'other']);
  assert.equal(s.reduce((n, x) => n + x.pct, 0), 100);
  assert.equal(s[0].label, 'Apparel');
  assert.deepEqual(categoryShares([]), []);
  assert.deepEqual(categoryShares([{ category: 'x', cents: 5 }]).map((x) => x.pct), [100]);
});

test('splinePath starts at the first point, ends at the last, and clamps control points', () => {
  assert.equal(splinePath([]), '');
  assert.equal(splinePath([{ x: 1, y: 2 }]), 'M1,2');
  const d = splinePath([{ x: 0, y: 100 }, { x: 10, y: 0 }, { x: 20, y: 100 }], 0, 100);
  assert.match(d, /^M0,100 C/);
  assert.match(d, /20,100$/);
  const ys = [...d.matchAll(/,(-?[\d.]+)/g)].map((m) => Number(m[1]));
  assert.ok(ys.every((y) => y >= 0 && y <= 100), 'never overshoots the plot');
});

test('productSales skips refunded and cancelled orders', () => {
  const s = productSales([
    { product_id: 'a', goods_cents: 1000, batches: 2, escrow_status: 'released' },
    { product_id: 'a', goods_cents: 500, batches: null, escrow_status: 'funded' },
    { product_id: 'b', goods_cents: 9000, batches: 1, escrow_status: 'refunded' },
    { product_id: 'c', goods_cents: 2000, batches: 1, escrow_status: 'in_transit' },
  ]);
  assert.deepEqual(s, [
    { id: 'c', orders: 1, batches: 1, earningsCents: 2000 },
    { id: 'a', orders: 2, batches: 3, earningsCents: 1500 },
  ]);
});

test('compactUSD', () => {
  assert.equal(compactUSD(95_000), '$950');
  assert.equal(compactUSD(120_000), '$1.2k');
  assert.equal(compactUSD(3_400_000), '$34k');
  assert.equal(compactUSD(150_000_000), '$1.5M');
  assert.equal(compactUSD(100_000), '$1k');
});

test('rollingAverage trails over the window and starts short', () => {
  assert.deepEqual(rollingAverage([7, 0, 0, 0, 0, 0, 0, 7], 7), [7, 4, 2, 2, 1, 1, 1, 1]);
  assert.deepEqual(rollingAverage([], 7), []);
  assert.deepEqual(rollingAverage([2, 4], 1), [2, 4]);
});
