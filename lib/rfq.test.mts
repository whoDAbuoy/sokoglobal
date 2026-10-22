// Run: npx tsx --conditions=react-server --test lib/rfq.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canAcceptQuote, canDeleteRfq, categoryOptions, categoryWithin, rfqDeleteBlock, rfqShareUrl, showsRfqDelete, effectiveRfqStatus, parseAmount, parseTiers, quoteOrderLine, rfqTransition, unitPriceForQuantity,
  validateQuoteDraft, validateRfqDraft, validateTiers, type RfqStatus,
} from './rfq.ts';

test('RFQ status machine: quotes, acceptance and closing', () => {
  assert.equal(rfqTransition('open', 'quote_submitted'), 'quoted');
  assert.equal(rfqTransition('quoted', 'quote_submitted'), 'quoted');
  assert.equal(rfqTransition('quoted', 'last_quote_closed'), 'open');
  assert.equal(rfqTransition('quoted', 'accept'), 'accepted');
  assert.equal(rfqTransition('open', 'close'), 'rejected');
  assert.equal(rfqTransition('quoted', 'expire'), 'expired');
  for (const done of ['accepted', 'rejected', 'expired'] as RfqStatus[]) {
    for (const e of ['quote_submitted', 'accept', 'close', 'expire'] as const) assert.equal(rfqTransition(done, e), null, `${done} + ${e}`);
  }
});

test('a live request past its deadline reads as expired before the cron runs', () => {
  const now = Date.parse('2026-10-22T12:00:00Z');
  assert.equal(effectiveRfqStatus({ status: 'quoted', expires_at: '2026-10-22T11:00:00Z' }, now), 'expired');
  assert.equal(effectiveRfqStatus({ status: 'quoted', expires_at: '2026-10-23T11:00:00Z' }, now), 'quoted');
  assert.equal(effectiveRfqStatus({ status: 'accepted', expires_at: '2026-10-01T00:00:00Z' }, now), 'accepted');
});

const RFQ = { status: 'quoted' as RfqStatus, expires_at: '2026-11-01T00:00:00Z' };
const QUOTE = { status: 'pending' as const, valid_until: '2026-10-30T00:00:00Z', allowed_payment_structures: ['full', 'milestone_30_70'] };
const NOW = Date.parse('2026-10-22T00:00:00Z');

test('quote acceptance rules mirror accept_rfq_quote()', () => {
  assert.deepEqual(canAcceptQuote(RFQ, QUOTE, 'milestone_30_70', NOW), { ok: true });
  assert.deepEqual(canAcceptQuote(RFQ, { ...QUOTE, allowed_payment_structures: ['full'] }, 'milestone_30_70', NOW),
    { ok: false, reason: 'The supplier did not offer that payment option' });
  assert.equal(canAcceptQuote(RFQ, QUOTE, 'credit_30_days', NOW).ok, false);
  assert.equal(canAcceptQuote({ ...RFQ, status: 'accepted' }, QUOTE, 'full', NOW).ok, false);
  assert.equal(canAcceptQuote(RFQ, { ...QUOTE, status: 'rejected' }, 'full', NOW).ok, false);
  assert.equal(canAcceptQuote(RFQ, { ...QUOTE, valid_until: '2026-10-21T00:00:00Z' }, 'full', NOW).ok, false);
  assert.equal(canAcceptQuote({ ...RFQ, expires_at: '2026-10-21T00:00:00Z' }, QUOTE, 'full', NOW).ok, false);
});

test('tier pricing and the order line match Postgres (KES → USD cents at the USD rate)', () => {
  const tiers = [{ min_qty: 1000, unit_price_kes: 400 }, { min_qty: 5000, unit_price_kes: 380 }];
  assert.equal(unitPriceForQuantity(420, tiers, 999), 420);
  assert.equal(unitPriceForQuantity(420, tiers, 1000), 400);
  assert.equal(unitPriceForQuantity(420, tiers, 7000), 380);
  // Same numbers as the database scenario: 1,000 × KES 400 at 129.25 KES/USD = $3,094.78.
  assert.deepEqual(quoteOrderLine(1000, { unit_price_kes: 420, price_tiers: tiers, moq: 500 }, 129.25),
    { quantity: 1000, unitPriceKes: 400, totalKes: 400_000, goodsCents: 309_478, raisedToMoq: false });
  // Below the MOQ the order is raised to it (and priced at the tier the MOQ reaches).
  const line = quoteOrderLine(200, { unit_price_kes: 420, price_tiers: tiers, moq: 1000 }, 129.25);
  assert.equal(line.quantity, 1000);
  assert.equal(line.unitPriceKes, 400);
  assert.equal(line.raisedToMoq, true);
});

test('validateTiers: distinct whole quantities, positive prices, never dearer in bulk', () => {
  assert.equal(validateTiers([{ min_qty: 100, unit_price_kes: 90 }, { min_qty: 500, unit_price_kes: 80 }], 100), null);
  assert.match(validateTiers([{ min_qty: 100, unit_price_kes: 90 }, { min_qty: 100, unit_price_kes: 80 }], 100)!, /same quantity/);
  assert.match(validateTiers([{ min_qty: 100, unit_price_kes: 120 }], 100)!, /more per unit/);
  assert.match(validateTiers([{ min_qty: 1.5, unit_price_kes: 90 }], 100)!, /whole/);
  assert.match(validateTiers(Array.from({ length: 6 }, (_, i) => ({ min_qty: i + 1, unit_price_kes: 1 })), 100)!, /At most 5/);
});

test('validateRfqDraft trims, parses and reports per-field errors', () => {
  const ok = validateRfqDraft({ title: '  Cotton tees ', description: 'Plain tees, mixed sizes', quantity: '1,000', deliveryLocation: 'Nairobi', targetPriceKes: '410.50', expiresInDays: '' });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.value.title, 'Cotton tees');
    assert.equal(ok.value.quantity, 1000);
    assert.equal(ok.value.targetPriceKes, 410.5);
    assert.equal(ok.value.expiresInDays, 14);
    assert.equal(ok.value.categoryId, null);
  }
  const bad = validateRfqDraft({ title: 'x', description: 'short', quantity: '0', deliveryLocation: '', targetPriceKes: '1.234', categoryId: 'nope', expiresInDays: '90' });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.deepEqual(Object.keys(bad.errors).sort(), ['categoryId', 'deliveryLocation', 'description', 'expiresInDays', 'quantity', 'targetPriceKes', 'title']);
});

test('validateQuoteDraft: skips empty tier rows, sorts tiers, offers only quotable terms', () => {
  const r = validateQuoteDraft({
    productId: 'bbbbbbbb-0000-4000-8000-000000000001', unitPriceKes: '420', moq: '500', validDays: '7', leadTimeDays: '',
    tiers: [{ minQty: '5000', unitPriceKes: '380' }, { minQty: '', unitPriceKes: '' }, { minQty: '1000', unitPriceKes: '400' }],
    allowedStructures: ['full', 'milestone_30_70', 'credit_30_days', 'full'],
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.deepEqual(r.value.priceTiers.map((t) => t.min_qty), [1000, 5000]);
    assert.deepEqual(r.value.allowedStructures, ['full', 'milestone_30_70']);
    assert.equal(r.value.leadTimeDays, null);
  }
  const bad = validateQuoteDraft({ productId: '', unitPriceKes: 'abc', moq: '-1', validDays: '120', allowedStructures: ['credit_30_days'] });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.deepEqual(Object.keys(bad.errors).sort(), ['allowedStructures', 'moq', 'productId', 'unitPriceKes', 'validDays']);
});

test('amount parsing and tier parsing from Postgres', () => {
  assert.equal(parseAmount('1,250.5'), 1250.5);
  assert.equal(parseAmount(''), null);
  assert.ok(Number.isNaN(parseAmount('12.345')));
  assert.deepEqual(parseTiers([{ min_qty: 500, unit_price_kes: '80.5' }, { min_qty: 'x' }, { min_qty: 100, unit_price_kes: 90 }]),
    [{ min_qty: 100, unit_price_kes: 90 }, { min_qty: 500, unit_price_kes: 80.5 }]);
  assert.deepEqual(parseTiers(null), []);
});

test('category matching walks up the tree; options read as breadcrumbs', () => {
  const parents = new Map<string, string | null>([['agri', null], ['spices', 'agri'], ['vanilla', 'spices'], ['apparel', null]]);
  assert.equal(categoryWithin('vanilla', 'agri', parents), true);
  assert.equal(categoryWithin('vanilla', 'vanilla', parents), true);
  assert.equal(categoryWithin('spices', 'vanilla', parents), false);
  assert.equal(categoryWithin('apparel', 'agri', parents), false);
  assert.equal(categoryWithin(null, 'agri', parents), false);
  assert.equal(categoryWithin(null, null, parents), true);
  assert.deepEqual(categoryOptions([
    { id: 'spices', parent_id: 'agri', name: 'Spices' }, { id: 'agri', parent_id: null, name: 'Agriculture' },
    { id: 'vanilla', parent_id: 'spices', name: 'Vanilla' }, { id: 'apparel', parent_id: null, name: 'Apparel', sort_order: -1 },
  ]).map((o) => o.label), ['Apparel', 'Agriculture', 'Agriculture › Spices', 'Agriculture › Spices › Vanilla']);
});

test('deletion rules mirror the 022 policies; share links point at /rfqs/<id>', () => {
  const owner = { isOwner: true, isSuperAdmin: false };
  const admin = { isOwner: false, isSuperAdmin: true };
  const other = { isOwner: false, isSuperAdmin: false };
  assert.equal(canDeleteRfq({ status: 'open', hasOrder: false }, owner), true);
  assert.equal(canDeleteRfq({ status: 'quoted', hasOrder: false }, owner), true);
  // 023: closed and expired requests can be deleted by their buyer too; accepted ones cannot.
  for (const s of ['rejected', 'expired'] as RfqStatus[]) assert.equal(canDeleteRfq({ status: s, hasOrder: false }, owner), true, s);
  assert.equal(canDeleteRfq({ status: 'accepted', hasOrder: false }, owner), false);
  assert.match(rfqDeleteBlock({ status: 'accepted', hasOrder: true }, owner)!, /escrow order/);
  assert.equal(showsRfqDelete(owner), true);
  assert.equal(showsRfqDelete(other), false);
  assert.equal(canDeleteRfq({ status: 'rejected', hasOrder: false }, admin), true);
  assert.equal(canDeleteRfq({ status: 'accepted', hasOrder: true }, admin), false);
  assert.equal(canDeleteRfq({ status: 'open', hasOrder: false }, other), false);
  assert.equal(rfqShareUrl('https://sokoglobal.com/', 'abc-123'), 'https://sokoglobal.com/rfqs/abc-123');
});
