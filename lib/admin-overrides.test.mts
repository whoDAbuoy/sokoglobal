// Run: npx tsx --conditions=react-server --test lib/admin-overrides.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isHeld, parseUsdToCents, planRefund, validateLandedCost, validateReason } from './admin-overrides.ts';

const order = { total_cents: 60_000, escrow_status: 'funded' };
const usdCard = { provider_ref: '123', currency: 'USD', usd_rate: 1, amount_minor: 60_000 };

test('planRefund: full card refund goes to Paystack for the order total', () => {
  assert.deepEqual(planRefund({ order, mode: 'full', card: usdCard }),
    { ok: true, full: true, amountCents: 60_000, provider: 'paystack', transaction: '123', amountMinor: 60_000 });
});

test('planRefund: partial refunds in another currency round down and never exceed the charge', () => {
  const kes = { provider_ref: '9', currency: 'KES', usd_rate: 129.31, amount_minor: 7_758_600 };
  const p = planRefund({ order, mode: 'partial', amountCents: 1_001, card: kes });
  assert.ok(p.ok && p.provider === 'paystack');
  if (p.ok && p.provider === 'paystack') assert.equal(p.amountMinor, 129_439);   // 1001 × 129.31 = 129439.31 → floor
  const capped = planRefund({ order: { ...order, total_cents: 100_000 }, mode: 'full', card: { ...kes, amount_minor: 5_000 } });
  assert.ok(capped.ok && capped.provider === 'paystack' && capped.amountMinor === 5_000);
});

test('planRefund: M-Pesa is recorded for a manual send; no payment is an error', () => {
  const p = planRefund({ order, mode: 'full', mpesa: { id: 'm1', mpesa_receipt: 'QWE123' } });
  assert.deepEqual(p, { ok: true, full: true, amountCents: 60_000, provider: 'mpesa', receipt: 'QWE123' });
  assert.equal(planRefund({ order, mode: 'full' }).ok, false);
  assert.equal(planRefund({ order, mode: 'full', card: { ...usdCard, provider_ref: null } }).ok, false);
});

test('planRefund: only while held in escrow; partial must be below the total', () => {
  for (const s of ['pending_payment', 'released', 'refunded', 'cancelled']) assert.equal(planRefund({ order: { ...order, escrow_status: s }, mode: 'full', card: usdCard }).ok, false, s);
  assert.equal(planRefund({ order: { ...order, escrow_status: 'disputed' }, mode: 'full', card: usdCard }).ok, true);
  assert.equal(planRefund({ order, mode: 'partial', amountCents: 60_000, card: usdCard }).ok, false);
  assert.equal(planRefund({ order, mode: 'partial', amountCents: 0, card: usdCard }).ok, false);
  assert.equal(planRefund({ order, mode: 'partial', amountCents: null, card: usdCard }).ok, false);
  assert.equal(isHeld('in_transit'), true);
});

test('parseUsdToCents / validateReason / validateLandedCost', () => {
  assert.equal(parseUsdToCents('1,234.5'), 123_450);
  assert.equal(parseUsdToCents('$12'), 1_200);
  assert.equal(parseUsdToCents('-1'), null);
  assert.equal(parseUsdToCents('1.234'), null);
  assert.equal(validateReason(' ok ').ok, false);
  assert.deepEqual(validateReason('  buyer   confirmed '), { ok: true, reason: 'buyer confirmed' });
  const pending = { escrow_status: 'pending_payment', checkout_group_id: null };
  assert.deepEqual(validateLandedCost(pending, { goods: '500', freight: '60.5', customs: '0' }), { ok: true, goods: 50_000, freight: 6_050, customs: 0, total: 56_050 });
  assert.equal(validateLandedCost({ ...pending, escrow_status: 'funded' }, { goods: '1', freight: '1', customs: '1' }).ok, false);
  assert.equal(validateLandedCost({ ...pending, checkout_group_id: 'g' }, { goods: '1', freight: '1', customs: '1' }).ok, false);
  assert.equal(validateLandedCost(pending, { goods: '0', freight: '1', customs: '1' }).ok, false);
});
