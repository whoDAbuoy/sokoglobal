// Run: npx tsx --test lib/admin-metrics.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  barHeights, dailyCounts, dailyCountsByDay, filledDots, formatChange, likePattern, orderMetrics, pageList, parsePage,
  paymentMethod, percentChange, periodWindows, txnFilterStatuses, txnStatus, type OrderMetricsRow,
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

const metrics = (o: Partial<OrderMetricsRow>): OrderMetricsRow => ({
  paid_count: 3, gmv: 1050_00, held: 600_00, released: 400_00, refunded: 50_00, disputed: 1, buyers: 2, repeat_buyers: 1,
  by_category: [{ category: 'electronics', cents: 650_00 }, { category: 'apparel', cents: 400_00 }],
  month: { gmv: 1050_00, by_provider: [{ provider: 'mpesa', cents: 600_00, count: 1 }, { provider: 'paystack', cents: 400_00, count: 1 },
    { provider: 'daraja', cents: 50_00, count: 1 }] },
  prev_month_gmv: 500_00, paid_days: {}, ...o,
});

test('order metrics derive averages, shares and payment-method labels from the SQL totals', () => {
  const s = orderMetrics(metrics({}));
  assert.equal(s.paidCount, 3);
  assert.equal(s.gmv, 1050_00);
  assert.equal(s.settledPct, 40);
  assert.equal(s.repeatPct, 50);
  assert.equal(s.avgOrder, 350_00);
  assert.equal(s.disputesOpen, 1);
  assert.equal(s.prevMonthGmv, 500_00);
  assert.deepEqual(s.month.byMethod.map((m) => [m.label, m.cents, m.count]), [['M-Pesa', 650_00, 2], ['Card', 400_00, 1]]);
  assert.equal(s.byCategory[0]!.category, 'electronics');
});

test('Postgres bigint sums arriving as strings are still numbers', () => {
  const s = orderMetrics(metrics({ gmv: '1050000' as unknown as number, paid_count: '3' as unknown as number }));
  assert.equal(s.gmv, 1_050_000);
  assert.equal(s.avgOrder, 350_000);
});

test('empty data gives zeros, not NaN', () => {
  const s = orderMetrics(metrics({ paid_count: 0, gmv: 0, held: 0, released: 0, refunded: 0, buyers: 0, repeat_buyers: 0, disputed: 0,
    by_category: [], month: { gmv: 0, by_provider: [] } }));
  assert.equal(s.settledPct, 0);
  assert.equal(s.repeatPct, 0);
  assert.equal(s.avgOrder, 0);
  assert.deepEqual(s.month.byMethod, []);
});

test('per-day counts from SQL fill the last 7 UTC days, oldest first', () => {
  const now = new Date('2026-10-19T09:00:00Z');
  assert.deepEqual(dailyCountsByDay({ '2026-10-19': 2, '2026-10-17': 1, '2026-10-01': 9 }, now, 7), [0, 0, 0, 0, 1, 0, 2]);
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
