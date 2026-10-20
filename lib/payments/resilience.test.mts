// Run: npx tsx --test lib/payments/resilience.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideRetry, MAX_WEBHOOK_ATTEMPTS, reconcileEscrow, retryDelayMs, type GatewayCharge, type ReconCardPayment, type ReconMpesaPayment, type ReconOrder } from './resilience.ts';

test('backoff doubles from 5 minutes and caps at 6 hours', () => {
  assert.equal(retryDelayMs(1), 5 * 60_000);
  assert.equal(retryDelayMs(2), 10 * 60_000);
  assert.equal(retryDelayMs(4), 40 * 60_000);
  assert.equal(retryDelayMs(20), 6 * 60 * 60_000);
});

test('retry decisions', () => {
  assert.deepEqual(decideRetry(1, { outcome: 'applied' }), { action: 'done', outcome: 'applied' });
  assert.equal(decideRetry(2, { pending: true }).action, 'retry');
  assert.equal(decideRetry(MAX_WEBHOOK_ATTEMPTS, { error: 'timeout' }).action, 'dead_letter');
});

const NOW = new Date('2026-10-20T12:00:00Z');
const order = (o: Partial<ReconOrder>): ReconOrder => ({ id: 'o1', escrow_status: 'funded', total_cents: 50_000, funded_at: '2026-10-20T10:00:00Z', payment_provider: 'paystack', checkout_group_id: null, ...o });
const card = (p: Partial<ReconCardPayment>): ReconCardPayment => ({ reference: 'ord.o1', kind: 'order', order_id: 'o1', checkout_group_id: null, status: 'succeeded', usd_cents: 50_000, amount_minor: 50_000, currency: 'USD', created_at: '2026-10-20T10:00:00Z', ...p });
const mpesa = (m: Partial<ReconMpesaPayment>): ReconMpesaPayment => ({ id: 'm1', order_id: 'o2', checkout_group_id: null, status: 'succeeded', usd_cents: 50_000, mpesa_receipt: 'QWE123', created_at: '2026-10-20T10:00:00Z', ...m });
const gw = (entries: [string, GatewayCharge][]) => new Map(entries);

test('a clean ledger has no issues', () => {
  const r = reconcileEscrow({ orders: [order({}), order({ id: 'o2', payment_provider: 'mpesa' })], card: [card({})], mpesa: [mpesa({})],
    gateway: gw([['ord.o1', { status: 'success', amountMinor: 50_000, currency: 'USD' }]]), now: NOW });
  assert.deepEqual(r.issues, []);
  assert.equal(r.summary.held_in_escrow_cents, 100_000);
  assert.equal(r.summary.card_verified_with_gateway, 1);
});

test('gateway disagreements are critical', () => {
  const kinds = (g: GatewayCharge, p: Partial<ReconCardPayment> = {}) =>
    reconcileEscrow({ orders: [order({})], card: [card(p)], mpesa: [], gateway: gw([['ord.o1', g]]), now: NOW }).issues.map((i) => i.kind);
  assert.deepEqual(kinds({ status: 'failed', amountMinor: 50_000, currency: 'USD' }), ['gateway_not_successful']);
  assert.deepEqual(kinds({ status: 'success', amountMinor: 40_000, currency: 'USD' }), ['amount_mismatch']);
  assert.deepEqual(kinds({ error: 'timeout' }), ['gateway_unreachable']);
  const lost = reconcileEscrow({ orders: [order({ escrow_status: 'pending_payment', funded_at: null })], card: [card({ status: 'initiated' })], mpesa: [],
    gateway: gw([['ord.o1', { status: 'success', amountMinor: 50_000, currency: 'USD' }]]), now: NOW });
  assert.deepEqual(lost.issues.map((i) => [i.kind, i.severity]), [['unapplied_charge', 'critical']]);
});

test('ledger invariants', () => {
  const r = reconcileEscrow({
    orders: [order({ id: 'x', payment_provider: 'mpesa' }), order({ id: 'o2', escrow_status: 'pending_payment', funded_at: null, payment_provider: null }), order({ id: 'o3', total_cents: 60_000 })],
    card: [card({ reference: 'ord.o3', order_id: 'o3' })],
    mpesa: [mpesa({}), mpesa({ id: 'm2', order_id: 'o9', status: 'pending', created_at: '2026-10-20T09:00:00Z' }), mpesa({ id: 'm3', order_id: 'o8', mpesa_receipt: null })],
    gateway: new Map(), now: NOW,
  });
  const kinds = r.issues.map((i) => `${i.kind}:${i.order_id ?? i.reference}`).sort();
  assert.deepEqual(kinds, ['escrow_amount_mismatch:o3', 'funded_without_payment:x', 'missing_receipt:o8', 'payment_not_applied:o2', 'stale_pending:o9'].sort());
  assert.equal(r.issues.find((i) => i.kind === 'funded_without_payment')!.fingerprint, 'funded_without_payment:x');
});

test('cart payments must equal the sum of their orders', () => {
  const r = reconcileEscrow({
    orders: [order({ id: 'a', checkout_group_id: 'g', total_cents: 30_000 }), order({ id: 'b', checkout_group_id: 'g', total_cents: 20_000 })],
    card: [card({ reference: 'grp.g', kind: 'group', order_id: null, checkout_group_id: 'g', usd_cents: 50_000 })], mpesa: [], gateway: new Map(), now: NOW,
  });
  assert.deepEqual(r.issues, []);
  const bad = reconcileEscrow({
    orders: [order({ id: 'a', checkout_group_id: 'g', total_cents: 30_000 })],
    card: [card({ reference: 'grp.g', kind: 'group', order_id: null, checkout_group_id: 'g', usd_cents: 50_000 })], mpesa: [], gateway: new Map(), now: NOW,
  });
  assert.deepEqual(bad.issues.map((i) => i.kind), ['escrow_amount_mismatch']);
});
