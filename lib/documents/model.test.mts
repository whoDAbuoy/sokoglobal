// Run: npx tsx --test lib/documents/model.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invoiceAvailable, invoiceModel, maskRef, payoutReceiptModel, receiptAvailable, winAnsi } from './model.ts';

const order = {
  id: '1234abcd-0000-4000-8000-000000000000', escrow_status: 'customs_cleared' as const, created_at: '2026-10-01T09:00:00Z', funded_at: '2026-10-01T10:00:00Z',
  quantity: 48, goods_cents: 32_640, freight_cents: 11_200, customs_cents: 6_700, total_cents: 50_540,
  payment_provider: 'mpesa', payment_ref: 'QWERTY123456',
  product: { title: 'Snail Mucin Essence', brand: 'Seoul Lab', origin_country: 'kr' },
  buyer: { company_name: 'Glow Boutique', full_name: 'Amara Okafor', country_code: 'ke' },
  supplier: { company_name: 'Seoul Lab Co.', country_code: 'KR' },
};

test('invoice only after customs clearance', () => {
  assert.equal(invoiceAvailable('in_transit'), false);
  assert.equal(invoiceAvailable('customs_cleared'), true);
  assert.equal(invoiceAvailable('released'), true);
  assert.equal(invoiceAvailable('refunded'), false);
});

test('invoice model: numbers, lines and landed total', () => {
  const m = invoiceModel(order, new Date('2026-10-20T00:00:00Z'));
  assert.equal(m.number, 'INV-1234ABCD');
  assert.equal(m.issued, '20 Oct 2026');
  assert.equal(m.table.rows[0][0], 'Seoul Lab - Snail Mucin Essence');
  assert.equal(m.table.rows[0][2], '$6.80');          // 32,640 / 48 units
  assert.equal(m.totals.at(-1)!.value, '$505.40');
  assert.equal(m.totals.at(-1)!.strong, true);
  assert.ok(m.facts.some((f) => f.value === 'M-Pesa · ref …123456'));
  assert.equal(m.parties[1].lines[2], 'KE');
});

test('payout receipt', () => {
  assert.equal(receiptAvailable('processing'), false);
  const m = payoutReceiptModel({ id: 'aaaabbbb-0000', order_id: '1234abcd-0000', reference: 'po_1', status: 'succeeded', gross_cents: 32_640, fee_cents: 640,
    amount_cents: 32_000, currency: 'USD', payout_currency: 'EUR', payout_amount: 295.1, created_at: '2026-10-10T00:00:00Z', completed_at: '2026-10-11T00:00:00Z',
    supplier: { company_name: 'Seoul Lab Co.', country_code: 'KR' } });
  assert.equal(m.number, 'PAY-AAAABBBB');
  assert.equal(m.table.rows[1][3], '-$6.40');
  assert.equal(m.totals[0].value, '$320.00');
  assert.equal(m.totals[1].label, 'Paid out in EUR');
});

test('invoice with an escrow fee (migration 026): own line, landed cost separate from the total paid', () => {
  const m = invoiceModel({ ...order, escrow_fee_cents: 1_011, total_cents: 51_551 }, new Date('2026-10-20T00:00:00Z'));
  assert.deepEqual(m.table.rows.at(-1), ['Escrow protection fee (SokoGlobal)', '1', '$10.11', '$10.11']);
  assert.deepEqual(m.totals.map((t) => t.value), ['$505.40', '$10.11', '$515.51']);
  assert.equal(m.totals.at(-1)!.label, 'Total paid (USD)');
});

test('early payout receipt splits commission and the early fee', () => {
  const m = payoutReceiptModel({ id: 'aaaabbbb-0000', order_id: '1234abcd-0000', reference: 'po_2', status: 'succeeded', gross_cents: 50_000, fee_cents: 3_000,
    early_payout_fee_cents: 1_500, early: true, amount_cents: 47_000, currency: 'USD', created_at: '2026-10-10T00:00:00Z', completed_at: '2026-10-10T00:00:00Z',
    supplier: { company_name: 'Seoul Lab Co.', country_code: 'KR' } });
  assert.deepEqual(m.table.rows.slice(1).map((r) => [r[0], r[3]]), [['Platform commission', '-$15.00'], ['Instant early payout fee', '-$15.00']]);
  assert.match(m.parties[1].lines[1], /early payout/);
  assert.equal(m.totals[0].value, '$470.00');
});

test('text safe for standard PDF fonts', () => {
  assert.equal(winAnsi('Maison — “Rouge” café…'), 'Maison - "Rouge" café...');
  assert.equal(winAnsi('上海贸易'), '????');
  assert.equal(maskRef(null), '—');
  assert.equal(maskRef('abc'), 'abc');
});
