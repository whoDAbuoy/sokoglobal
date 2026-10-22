// Run: npx tsx --conditions=react-server --test lib/currency.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CURRENCY, FALLBACK_RATES, convertFromKes, formatCurrency, formatUsdCents, kesFromUsdCents, normalizeRates, parseCurrency,
} from './currency.ts';

const RATES = { KES: 1, USD: 129.25, UGX: 0.0351, TZS: 0.0513, RWF: 0.0935 };
const nbsp = (s: string) => s.replace(/ /g, ' ');

test('formatCurrency converts a KES amount into the selected currency', () => {
  assert.equal(formatCurrency(12_925, 'USD', RATES), '$100.00');
  assert.equal(nbsp(formatCurrency(12_925, 'KES', RATES)), 'KES 12,925.00');
  // 1 KES = 1 / 0.0351 ≈ 28.49 UGX; UGX has no minor unit.
  assert.equal(nbsp(formatCurrency(1_000, 'UGX', RATES)), 'UGX 28,490');
  assert.equal(nbsp(formatCurrency(1_000, 'RWF', RATES)), 'RWF 10,695');
  assert.equal(nbsp(formatCurrency(1_000, 'TZS', RATES)), 'TZS 19,493.18');
});

test('USD-cent amounts render exactly in USD and via KES elsewhere', () => {
  assert.equal(formatUsdCents(57_000, 'USD', RATES), '$570.00');
  assert.equal(kesFromUsdCents(57_000, RATES), 73_672.5);
  assert.equal(nbsp(formatUsdCents(57_000, 'KES', RATES)), 'KES 73,672.50');
  assert.equal(nbsp(formatUsdCents(57_000, 'UGX', RATES)), 'UGX 2,098,932');
  assert.equal(formatUsdCents(1_250_000, 'USD', RATES, { compact: true }), '$12.5K');
});

test('conversions round-trip through KES', () => {
  const kes = kesFromUsdCents(10_000, RATES);
  assert.equal(convertFromKes(kes, 'USD', RATES), 100);
  assert.equal(formatCurrency(Number.NaN, 'USD', RATES), '$0.00');
});

test('parseCurrency accepts supported codes only', () => {
  assert.equal(parseCurrency('ugx'), 'UGX');
  assert.equal(parseCurrency(' KES '), 'KES');
  assert.equal(parseCurrency('EUR'), DEFAULT_CURRENCY);
  assert.equal(parseCurrency(undefined), DEFAULT_CURRENCY);
});

test('normalizeRates keeps valid rows, falls back for bad ones and pins KES to 1', () => {
  const r = normalizeRates([
    { currency_code: 'USD', rate_to_kes: '130.5' },     // numeric arrives as a string from PostgREST
    { currency_code: 'UGX', rate_to_kes: -1 },
    { currency_code: 'KES', rate_to_kes: 2 },
    { currency_code: 'EUR', rate_to_kes: 140 },
    null,
  ]);
  assert.equal(r.USD, 130.5);
  assert.equal(r.UGX, FALLBACK_RATES.UGX);
  assert.equal(r.KES, 1);
  assert.equal('EUR' in r, false);
  assert.deepEqual(normalizeRates(null), FALLBACK_RATES);
});
