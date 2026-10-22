// Run: npx tsx --conditions=react-server --test lib/milestone.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MILESTONE_MIN_CENTS, amountDue, milestoneEligible, milestoneSplit, paidCents, paymentStep, settledStatus, type PayableOrder } from './milestone.ts';

test('milestoneSplit: 30% deposit rounded up to the cent, balance is the rest (same as Postgres)', () => {
  assert.deepEqual(milestoneSplit(114_000), { depositCents: 34_200, balanceCents: 79_800 });
  assert.deepEqual(milestoneSplit(309_478), { depositCents: 92_844, balanceCents: 216_634 });   // 92,843.4 → 92,844
  assert.deepEqual(milestoneSplit(1), { depositCents: 1, balanceCents: 0 });
  for (const total of [3, 99, 1_001, 57_000, 123_457, 999_999_999]) {
    const { depositCents, balanceCents } = milestoneSplit(total);
    assert.equal(depositCents + balanceCents, total);
    assert.ok(depositCents >= total * 0.3 && depositCents < total * 0.3 + 1, `deposit for ${total}`);
  }
  assert.throws(() => milestoneSplit(0));
  assert.throws(() => milestoneSplit(12.5));
});

test('eligibility: verified buyers, single orders of at least $1,000', () => {
  const base = { totalCents: MILESTONE_MIN_CENTS, kycApproved: true, inCart: false, orderType: 'trial' };
  assert.equal(milestoneEligible(base), true);
  assert.equal(milestoneEligible({ ...base, totalCents: MILESTONE_MIN_CENTS - 1 }), false);
  assert.equal(milestoneEligible({ ...base, kycApproved: false }), false);
  assert.equal(milestoneEligible({ ...base, inCart: true }), false);
  assert.equal(milestoneEligible({ ...base, orderType: 'pool' }), false);
});

const milestone = (extra: Partial<PayableOrder> = {}): PayableOrder => ({
  escrow_status: 'pending_payment', payment_structure: 'milestone_30_70', total_cents: 114_000,
  deposit_amount: 34_200, remaining_balance: 79_800, current_status: 'awaiting_dispatch', ...extra,
});

test('payment steps: deposit → wait for dispatch → balance → nothing due', () => {
  assert.deepEqual(paymentStep(milestone()), { kind: 'pay_deposit', amountCents: 34_200, balanceCents: 79_800 });
  const deposited = milestone({ escrow_status: 'deposit_paid', deposit_paid_at: '2026-10-01', funded_at: '2026-10-01' });
  assert.deepEqual(paymentStep(deposited), { kind: 'balance_waiting', balanceCents: 79_800 });
  assert.equal(amountDue(deposited), 79_800);
  const shipped = { ...deposited, current_status: 'in_transit' };
  assert.deepEqual(paymentStep(shipped), { kind: 'pay_balance', amountCents: 79_800 });
  assert.equal(paidCents(shipped), 34_200);
  const settled = { ...shipped, escrow_status: settledStatus('in_transit'), final_paid_at: '2026-10-05' };
  assert.deepEqual(paymentStep(settled), { kind: 'none' });
  assert.equal(amountDue(settled), 0);
  assert.equal(paidCents(settled), 114_000);
});

test('full-payment orders are unchanged', () => {
  const o: PayableOrder = { escrow_status: 'pending_payment', payment_structure: 'full', total_cents: 57_000 };
  assert.deepEqual(paymentStep(o), { kind: 'pay_full', amountCents: 57_000 });
  assert.equal(amountDue(o), 57_000);
  assert.equal(paidCents(o), 0);
  assert.equal(paidCents({ ...o, escrow_status: 'funded', funded_at: '2026-10-01' }), 57_000);
  // Rows from before migration 021 have no structure at all.
  assert.deepEqual(paymentStep({ escrow_status: 'pending_payment', total_cents: 57_000 }), { kind: 'pay_full', amountCents: 57_000 });
});

test('a paid balance resumes the escrow flow where the shipment is', () => {
  assert.equal(settledStatus('awaiting_dispatch'), 'funded');
  assert.equal(settledStatus('in_transit'), 'in_transit');
  assert.equal(settledStatus('arrived'), 'in_transit');
  assert.equal(settledStatus('out_for_delivery'), 'customs_cleared');
  assert.equal(settledStatus('delivered'), 'delivered_pending_verification');
  assert.equal(settledStatus(null), 'funded');
});
