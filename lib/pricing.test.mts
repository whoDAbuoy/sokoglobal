// Run: npx tsx --conditions=react-server --test lib/pricing.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PRICING, addonsCents, earlyPayoutBreakdown, escrowFeeCents, formatRate, goldState, markedUpFreightCents,
  parseAddons, parsePricing, parsePricingInput, parseRevenue, pricingChanges, pricingToInput, revenueTotals,
} from './pricing.ts';

test('parsing falls back to the migration defaults; numeric strings from PostgREST are accepted', () => {
  assert.deepEqual(parsePricing(null), DEFAULT_PRICING);
  const p = parsePricing({ supplier_gold_monthly_price: '59.00', escrow_fee_percent: '0.0250', fx_spread_percent: 5, logistics_markup_percent: null });
  assert.equal(p.supplier_gold_monthly_price, 59);
  assert.equal(p.escrow_fee_percent, 0.025);
  assert.equal(p.fx_spread_percent, DEFAULT_PRICING.fx_spread_percent, 'out of bounds → default');
  assert.equal(p.logistics_markup_percent, DEFAULT_PRICING.logistics_markup_percent);
});

test('escrow fee mirrors orders_platform_fees() (the DB test expects 1140 on $570 and 1256 on $628)', () => {
  assert.equal(escrowFeeCents(57_000, 0.02), 1140);
  assert.equal(escrowFeeCents(62_800, 0.02), 1256);
  assert.equal(escrowFeeCents(25, 0.02), 1, 'half a cent rounds up');
  assert.equal(escrowFeeCents(57_000, 0), 0);
  assert.equal(escrowFeeCents(Number.NaN, 0.02), 0);
});

test('early payout: goods − commission − early fee, each floored', () => {
  assert.deepEqual(earlyPayoutBreakdown(50_000, 0.03, 0.03), { grossCents: 50_000, commissionCents: 1500, feeCents: 1500, netCents: 47_000 });
  assert.deepEqual(earlyPayoutBreakdown(333, 0.05, 0.03), { grossCents: 333, commissionCents: 16, feeCents: 9, netCents: 308 });
});

test('logistics markup on the carrier cost', () => {
  assert.equal(markedUpFreightCents(10_000, 0.08), 10_800);
  assert.equal(markedUpFreightCents(0, 0.08), 0);
});

test('rates format as percentages', () => {
  assert.equal(formatRate(0.05), '5%');
  assert.equal(formatRate(0.025), '2.5%');
  assert.equal(formatRate(0.0075), '0.75%');
});

test('form input: dollars for prices, percentages for rates, same bounds as Postgres', () => {
  const ok = parsePricingInput({ ...pricingToInput(DEFAULT_PRICING), supplier_gold_monthly_price: '$1,250.50', escrow_fee_percent: '2.5%' });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.value.supplier_gold_monthly_price, 1250.5);
    assert.equal(ok.value.escrow_fee_percent, 0.025);
    assert.equal(ok.value.default_supplier_commission_rate, 0.05);
  }
  const bad = parsePricingInput({ ...pricingToInput(DEFAULT_PRICING), featured_rfq_price: '0.5', fx_spread_percent: '11', early_payout_discount_fee: '3.333', supplier_gold_commission_rate: '6' });
  assert.equal(bad.ok, false);
  if (!bad.ok) {
    assert.match(bad.errors.featured_rfq_price ?? '', /between \$1/);
    assert.match(bad.errors.fx_spread_percent ?? '', /10%/);
    assert.match(bad.errors.early_payout_discount_fee ?? '', /percentage/);
    assert.match(bad.errors.supplier_gold_commission_rate ?? '', /higher than the standard/);
  }
});

test('round trip and change set', () => {
  const back = parsePricingInput(pricingToInput(DEFAULT_PRICING));
  assert.deepEqual(back, { ok: true, value: DEFAULT_PRICING });
  assert.deepEqual(pricingChanges(DEFAULT_PRICING, { ...DEFAULT_PRICING, featured_rfq_price: 20 }), { featured_rfq_price: 20 });
  assert.deepEqual(pricingChanges(DEFAULT_PRICING, DEFAULT_PRICING), {});
});

test('Gold state: active until the period ends, lapsed after, none without a period', () => {
  const now = Date.parse('2026-10-23T12:00:00Z');
  assert.deepEqual(goldState(null, now), { kind: 'none' });
  assert.deepEqual(goldState({ status: 'active', current_period_end: '2026-11-23T12:00:00Z' }, now), { kind: 'active', until: '2026-11-23T12:00:00Z' });
  assert.equal(goldState({ status: 'active', current_period_end: '2026-10-23T11:59:00Z' }, now).kind, 'lapsed');
  assert.equal(goldState({ status: 'past_due', current_period_end: '2026-12-01T00:00:00Z' }, now).kind, 'lapsed');
});

test('revenue summary: numbers (bigint sums arrive as strings), missing → 0, totals add every stream once', () => {
  const r = parseRevenue({ subscriptions_cents: '9800', rfq_featured_cents: 1500, rfq_white_glove_cents: 2500, escrow_fees_cents: 2280,
    fx_margin_cents: 930, commission_cents: 1500, early_payout_fees_cents: 1500, early_payout_exposure_cents: 47000, crypto_fees_cents: 582, bogus: 5 });
  assert.equal(r.subscriptions_cents, 9800);
  assert.equal(r.logistics_markup_cents, 0);
  assert.equal(r.white_glove_open, 0);
  assert.deepEqual(revenueTotals(r), { rfqPromotions: 4000, total: 9800 + 4000 + 2280 + 930 + 1500 + 1500 + 582 });
  assert.equal(parseRevenue(null).commission_cents, 0);
});

test('RFQ add-ons: known, unique, stable order; priced from settings', () => {
  assert.deepEqual(parseAddons(['white_glove', 'featured', 'featured', 'banner']), ['featured', 'white_glove']);
  assert.deepEqual(parseAddons('white_glove'), ['white_glove']);
  assert.deepEqual(parseAddons(42), []);
  assert.equal(addonsCents(['featured', 'white_glove'], DEFAULT_PRICING), 4000);
  assert.equal(addonsCents([], DEFAULT_PRICING), 0);
});
