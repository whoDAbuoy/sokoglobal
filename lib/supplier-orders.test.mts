// Run: npx tsx --conditions=react-server --test lib/supplier-orders.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalogTotals, fulfillmentStatus, groupPaidOrders, parseGroupedCatalog, visibleToSupplier, type RawOrder } from './supplier-orders.ts';

test('fulfillment status mirrors the generated column; unpaid orders are never visible to suppliers', () => {
  assert.equal(fulfillmentStatus({ escrow_status: 'pending_payment' }), 'awaiting_payment');
  assert.equal(fulfillmentStatus({ escrow_status: 'funded', current_status: 'awaiting_dispatch' }), 'pending_fulfillment');
  assert.equal(fulfillmentStatus({ escrow_status: 'funded', current_status: 'in_transit' }), 'in_fulfillment');
  assert.equal(fulfillmentStatus({ escrow_status: 'cancelled', funded_at: null }), 'void');
  assert.equal(fulfillmentStatus({ escrow_status: 'cancelled', funded_at: '2026-10-01' }), 'closed');
  assert.equal(fulfillmentStatus({ escrow_status: 'released' }), 'completed');
  assert.equal(visibleToSupplier({ escrow_status: 'pending_payment' }), false);
  assert.equal(visibleToSupplier({ escrow_status: 'cancelled', funded_at: null }), false);
  assert.equal(visibleToSupplier({ escrow_status: 'funded', current_status: 'awaiting_dispatch' }), true);
  assert.equal(visibleToSupplier({ escrow_status: 'refunded' }), true);
});

const o = (id: string, product_id: string, escrow_status: RawOrder['escrow_status'], funded_at: string | null, quantity: number, goods_cents: number, extra: Partial<RawOrder> = {}): RawOrder => ({
  id, product_id, escrow_status, funded_at, quantity, goods_cents, total_cents: goods_cents + 6000, batches: 1, current_status: 'awaiting_dispatch', ...extra,
});

test('groupPaidOrders: one card per listing with summed quantity and value, oldest payment first', () => {
  const listings = new Map([['shea', { title: 'Shea butter', image_url: 'https://cdn/1.jpg', unit_of_measure: 'kg' }], ['kit', { title: 'Kitenge', image_url: null, unit_of_measure: null }]]);
  const groups = groupPaidOrders([
    o('o1', 'shea', 'pending_payment', null, 100, 50_000),                                 // unpaid → never shown
    o('o2', 'shea', 'funded', '2026-10-19T10:00:00Z', 100, 50_000, { buyer_company: 'Imp Co' }),
    o('o3', 'shea', 'funded', '2026-10-18T10:00:00Z', 200, 100_000, { buyer_company: 'Imp Two', batches: 2 }),
    o('o4', 'kit', 'funded', '2026-10-20T10:00:00Z', 30, 60_000, { current_status: 'in_transit' }),   // already shipped
    o('o5', 'kit', 'funded', '2026-10-20T11:00:00Z', 30, 60_000),
    o('o6', 'kit', 'cancelled', null, 30, 60_000),
  ], listings);
  assert.deepEqual(groups.map((g) => g.listing_id), ['shea', 'kit']);
  const shea = groups[0];
  assert.equal(shea.order_count, 2);
  assert.equal(shea.total_quantity, 300);
  assert.equal(shea.total_batches, 3);
  assert.equal(shea.total_goods_cents, 150_000);
  assert.equal(shea.total_landed_cents, 162_000);
  assert.equal(shea.oldest_paid_at, '2026-10-18T10:00:00Z');
  assert.deepEqual(shea.orders.map((x) => x.buyer_company), ['Imp Two', 'Imp Co']);
  assert.equal(groups[1].order_count, 1);
  assert.deepEqual(catalogTotals(groups), { listings: 2, orders: 3, goodsCents: 210_000 });
  assert.deepEqual(groupPaidOrders([o('x', 'shea', 'pending_payment', null, 1, 1)], listings), []);
});

test('parseGroupedCatalog handles bigint-as-string sums and missing fields', () => {
  const [g] = parseGroupedCatalog([{ listing_id: 'l1', title: 'Vanilla', image_url: null, unit_of_measure: 'kg', order_count: 2, total_quantity: '300',
    total_batches: '3', total_goods_cents: '150000', total_landed_cents: '168000', oldest_paid_at: '2026-10-18T10:00:00Z',
    orders: [{ order_id: 'o1', quantity: 100, batches: 1, goods_cents: 50000, buyer_company: 'Imp Co', paid_at: '2026-10-18T10:00:00Z' }] }]);
  assert.equal(g.total_quantity, 300);
  assert.equal(g.total_goods_cents, 150000);
  assert.equal(g.orders[0].buyer_company, 'Imp Co');
  assert.equal(g.orders[0].destination, null);
  assert.deepEqual(parseGroupedCatalog(null), []);
});
