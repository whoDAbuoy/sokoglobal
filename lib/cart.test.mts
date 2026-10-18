// Run: npx tsx --test lib/cart.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_BATCHES_PER_LINE, MAX_CART_LINES, clampQuantity, lineTotals, normalizeStoredCart } from './cart.ts';

test('clampQuantity keeps quantities whole and within 1..20', () => {
  assert.equal(clampQuantity(3), 3);
  assert.equal(clampQuantity('4'), 4);
  assert.equal(clampQuantity(2.9), 2);
  for (const bad of [0, -5, NaN, '', 'abc', null, undefined]) assert.equal(clampQuantity(bad), 1, String(bad));
  assert.equal(clampQuantity(999), MAX_BATCHES_PER_LINE);
});

test('lineTotals multiplies goods, freight, customs, landed cost and units (matches migration 010)', () => {
  const batch = { goods_cents: 40000, freight_cents: 11200, customs_cents: 6700, landed_cost_cents: 57900, trial_units: 50 };
  assert.deepEqual(lineTotals(batch, 3), {
    quantity: 3, units: 150, goods_cents: 120000, freight_cents: 33600, customs_cents: 20100, landed_cost_cents: 173700,
  });
  assert.equal(lineTotals(batch, 0).landed_cost_cents, 57900);   // clamped to 1
});

test('normalizeStoredCart upgrades old carts, drops junk and duplicates, caps lines', () => {
  const legacy = [{ productId: 'a', title: 'A' }, { productId: 'b', title: 'B', quantity: 4 }];
  assert.deepEqual(normalizeStoredCart(legacy).map((i) => [i.productId, i.quantity]), [['a', 1], ['b', 4]]);
  assert.deepEqual(normalizeStoredCart([null, 7, { title: 'no id' }, { productId: 'a' }, { productId: 'a', quantity: 9 }]).map((i) => i.quantity), [1]);
  assert.equal(normalizeStoredCart([{ productId: 'x', quantity: 500 }])[0].quantity, MAX_BATCHES_PER_LINE);
  assert.equal(normalizeStoredCart(Array.from({ length: 15 }, (_, i) => ({ productId: `p${i}` }))).length, MAX_CART_LINES);
  assert.deepEqual(normalizeStoredCart('not an array'), []);
});
