// Run: npx tsx --conditions=react-server --test lib/supplier-orders.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalogTotals, fulfillmentStatus, parseGroupedCatalog, visibleToSupplier, type ListingGroup } from './supplier-orders.ts';

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

const group = (listing_id: string, order_count: number, total_goods_cents: number): ListingGroup => ({
  listing_id, title: listing_id, image_url: null, unit_of_measure: null, order_count, total_quantity: 0, total_batches: 0,
  total_goods_cents, total_landed_cents: total_goods_cents, oldest_paid_at: null, orders: [],
});

test('catalogTotals sums listings, orders and goods value', () => {
  assert.deepEqual(catalogTotals([group('shea', 2, 150_000), group('kit', 1, 60_000)]), { listings: 2, orders: 3, goodsCents: 210_000 });
  assert.deepEqual(catalogTotals([]), { listings: 0, orders: 0, goodsCents: 0 });
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
