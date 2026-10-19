// Run: npx tsx --test lib/admin-metrics.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  barHeights, dailyCounts, escrowSummary, filledDots, formatChange, likePattern, pageList, parsePage,
  paymentMethod, percentChange, periodWindows, txnFilterStatuses, txnStatus, type MetricOrder,
} from './admin-metrics.ts';

test('percent change vs last period', () => {
  assert.equal(percentChange(118, 100), 18);
  assert.equal(percentChange(42, 50), -16);
  assert.equal(percentChange(5, 0), null);
  assert.equal(formatChange(18.2), '+18.2%');
  assert.equal(formatChange(-8.7), '-8.7%');
  assert.equal(formatChange(0), '0%');
  assert.equal(formatChange(null, 3), 'New');
  assert.equal(formatChange(null, 0), '—');
});

test('period windows are back-to-back', () => {
  const w = periodWindows(new Date('2026-10-19T12:00:00Z'), 7);
  assert.equal(w.current.to, '2026-10-19T12:00:00.000Z');
  assert.equal(w.current.from, '2026-10-12T12:00:00.000Z');
  assert.equal(w.previous.to, w.current.from);
  assert.equal(w.previous.from, '2026-10-05T12:00:00.000Z');
});

test('transaction pills', () => {
  assert.deepEqual(txnStatus('pending_payment'), { label: 'Pending', tone: 'warning' });
  for (const s of ['funded', 'in_transit', 'customs_cleared', 'delivered_pending_verification'] as const) assert.equal(txnStatus(s).label, 'Paid');
  assert.equal(txnStatus('released').label, 'Released');
  assert.equal(txnStatus('refunded').label, 'Refunded');
  assert.equal(txnStatus('disputed').tone, 'danger');
  assert.equal(txnFilterStatuses(''), null);
  assert.equal(txnFilterStatuses('nonsense'), null);
  assert.deepEqual(txnFilterStatuses('pending'), ['pending_payment']);
});

test('paid-by badge from orders.payment_provider', () => {
  assert.deepEqual(paymentMethod('mpesa'), { label: 'M-Pesa', kind: 'mpesa' });
  assert.deepEqual(paymentMethod('paystack'), { label: 'Card', kind: 'card' });
  assert.deepEqual(paymentMethod('flutterwave'), { label: 'Flutterwave', kind: 'flutterwave' });
  assert.deepEqual(paymentMethod(null), { label: '—', kind: 'none' });
});

test('pagination buttons', () => {
  assert.deepEqual(pageList(1, 1), [1]);
  assert.deepEqual(pageList(1, 2), [1, 2]);
  assert.deepEqual(pageList(1, 10), [1, 2, '…', 10]);
  assert.deepEqual(pageList(5, 10), [1, '…', 4, 5, 6, '…', 10]);
  assert.deepEqual(pageList(3, 10), [1, 2, 3, 4, '…', 10]);
  assert.deepEqual(pageList(10, 10), [1, '…', 9, 10]);
  assert.equal(parsePage('3', 5), 3);
  assert.equal(parsePage('99', 5), 5);
  assert.equal(parsePage('-1'), 1);
  assert.equal(parsePage(undefined), 1);
});

const order = (o: Partial<MetricOrder>): MetricOrder => ({
  buyer_id: 'b1', escrow_status: 'funded', total_cents: 100_00, created_at: '2026-10-18T00:00:00Z',
  funded_at: '2026-10-18T00:00:00Z', payment_provider: 'mpesa', category: 'electronics', ...o,
});

test('escrow summary ignores unpaid checkouts and splits held / released / refunded', () => {
  const s = escrowSummary([
    order({ total_cents: 600_00 }),
    order({ escrow_status: 'released', total_cents: 400_00, payment_provider: 'paystack', buyer_id: 'b2', category: 'apparel' }),
    order({ escrow_status: 'refunded', total_cents: 50_00, buyer_id: 'b2' }),
    order({ escrow_status: 'pending_payment', total_cents: 999_00, funded_at: null, buyer_id: 'b3' }),
    order({ escrow_status: 'cancelled', total_cents: 70_00, funded_at: null, buyer_id: 'b4' }),
  ]);
  assert.equal(s.paidCount, 3);
  assert.equal(s.gmv, 1050_00);
  assert.equal(s.held, 600_00);
  assert.equal(s.released, 400_00);
  assert.equal(s.refunded, 50_00);
  assert.equal(s.settledPct, 40);
  assert.equal(s.buyers, 2);
  assert.equal(s.repeatBuyers, 1);
  assert.equal(s.repeatPct, 50);
  assert.equal(s.avgOrder, 350_00);
  assert.deepEqual(s.byMethod.map((m) => [m.label, m.cents]), [['M-Pesa', 650_00], ['Card', 400_00]]);
  assert.equal(s.byCategory[0]!.category, 'electronics');
});

test('empty data gives zeros, not NaN', () => {
  const s = escrowSummary([]);
  assert.equal(s.settledPct, 0);
  assert.equal(s.repeatPct, 0);
  assert.equal(s.avgOrder, 0);
});

test('daily counts bucket by UTC day, oldest first', () => {
  const now = new Date('2026-10-19T09:00:00Z');
  const c = dailyCounts(['2026-10-19T01:00:00Z', '2026-10-19T23:00:00Z', '2026-10-17T10:00:00Z', '2026-10-01T00:00:00Z', null, 'bad'], now, 7);
  assert.deepEqual(c, [0, 0, 0, 0, 1, 0, 2]);
});

test('bars, dots and search escaping', () => {
  assert.deepEqual(barHeights([0, 5, 10]), [8, 50, 100]);
  assert.deepEqual(barHeights([0, 0]), [8, 8]);
  assert.equal(filledDots(54, 24), 13);
  assert.equal(filledDots(150, 10), 10);
  assert.equal(filledDots(Number.NaN, 10), 0);
  assert.equal(likePattern('50%_off'), '%50\\%\\_off%');
});
