// Run: npx tsx --test lib/trending.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePoolSort, parseTrending, sortPools, trendingReason } from './trending.ts';

test('RPC rows are parsed; numeric strings become numbers; junk is dropped', () => {
  const rows = parseTrending([{ product_id: 'a', score: '12.500', buyers: 3, orders: '2', pledges: 0, inquiries: 1, saves: 0, views: 4 }, { score: 1 }, null]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].score, 12.5);
  assert.equal(rows[0].orders, 2);
  assert.deepEqual(parseTrending(null), []);
});

test('the reason leads with the strongest signal', () => {
  const base = { product_id: 'a', score: 1, buyers: 1, orders: 0, pledges: 0, inquiries: 0, saves: 0, views: 0 };
  assert.equal(trendingReason({ ...base, orders: 2, inquiries: 1, buyers: 4 }), '2 orders · 1 inquiry');
  assert.equal(trendingReason({ ...base, pledges: 1, buyers: 5 }), '1 pool pledge · 5 buyers interested');
  assert.equal(trendingReason({ ...base, saves: 3 }), '3 saves');
  assert.equal(trendingReason({ ...base, views: 9, buyers: 6 }), '6 buyers interested');
  assert.equal(trendingReason({ ...base, views: 1 }), 'Getting attention');
});

test('pool sorting', () => {
  const pools = [
    { id: 'a', deadline: '2026-11-10', pledged_cents: 10, target_cents: 100, created_at: '2026-10-01' },
    { id: 'b', deadline: '2026-11-02', pledged_cents: 90, target_cents: 100, created_at: '2026-10-20' },
    { id: 'c', deadline: '2026-11-05', pledged_cents: 50, target_cents: 100, created_at: '2026-10-25' },
  ];
  const ids = (sort: Parameters<typeof sortPools>[1], scores = new Map<string, number>()) => sortPools(pools, sort, scores).map((p) => p.id).join('');
  assert.equal(ids('closing'), 'bca');
  assert.equal(ids('funded'), 'bca');
  assert.equal(ids('new'), 'cba');
  assert.equal(ids('trending', new Map([['a', 9], ['c', 2]])), 'acb', 'scored pools first, then by deadline');
  assert.equal(parsePoolSort('funded'), 'funded');
  assert.equal(parsePoolSort('random'), 'trending');
});
