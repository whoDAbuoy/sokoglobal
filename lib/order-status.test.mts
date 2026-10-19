// Run: npx tsx --test lib/order-status.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderAction, orderGroup, PAID_ORDER_STATUSES, statusMeta } from './order-status.ts';

const ID = '44444444-4444-4444-8444-000000000001';

test('status pills', () => {
  assert.deepEqual(statusMeta('pending_payment'), { label: 'Awaiting payment', tone: 'warning' });
  assert.deepEqual(statusMeta('in_transit'), { label: 'Held in escrow', tone: 'escrow' });
  assert.deepEqual(statusMeta('delivered_pending_verification'), { label: 'Ready to verify', tone: 'warning' });
  assert.deepEqual(statusMeta('released'), { label: 'Supplier paid', tone: 'success' });
  assert.deepEqual(statusMeta('disputed'), { label: 'Dispute open', tone: 'danger' });
  assert.equal(statusMeta('cancelled').label, 'Cancelled');
});

test('unpaid → Complete payment on the order page (which forwards cart orders to checkout)', () => {
  assert.deepEqual(orderAction({ id: ID, escrow_status: 'pending_payment' }), { kind: 'link', label: 'Complete payment', href: `/dashboard/orders/${ID}`, primary: true });
});

test('escrow states → View escrow; delivered → Verify goods (primary)', () => {
  for (const s of ['funded', 'in_transit', 'customs_cleared'] as const) assert.equal((orderAction({ id: ID, escrow_status: s }) as { label: string }).label, 'View escrow');
  assert.deepEqual(orderAction({ id: ID, escrow_status: 'delivered_pending_verification' }), { kind: 'link', label: 'Verify goods', href: `/dashboard/orders/${ID}`, primary: true });
});

test('cancelled / refunded / disputed → support chat for that order', () => {
  for (const s of ['cancelled', 'refunded', 'disputed'] as const) {
    assert.deepEqual(orderAction({ id: ID, escrow_status: s }), { kind: 'support', label: 'Get help', orderId: ID });
  }
});

test('sample orders have no action', () => {
  assert.deepEqual(orderAction({ id: 'demo-order-1', escrow_status: 'in_transit' }), { kind: 'none' });
});

test('orders page groups', () => {
  assert.equal(orderGroup('pending_payment'), 'action');
  assert.equal(orderGroup('delivered_pending_verification'), 'action');
  assert.equal(orderGroup('disputed'), 'action');
  assert.equal(orderGroup('in_transit'), 'escrow');
  assert.equal(orderGroup('released'), 'completed');
  assert.equal(orderGroup('cancelled'), 'closed');
  assert.equal(orderGroup('refunded'), 'closed');
});

test('buyer order list only includes orders paid into escrow', () => {
  assert.ok(!PAID_ORDER_STATUSES.includes('pending_payment'));
  for (const s of ['funded', 'in_transit', 'customs_cleared', 'delivered_pending_verification', 'released', 'disputed', 'refunded', 'cancelled'] as const) {
    assert.ok(PAID_ORDER_STATUSES.includes(s), s);
  }
});
