// Run: npx tsx --test lib/landed-estimate.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateKenyaLanded, freightShareByOrigin } from './landed-estimate.ts';

test('estimateKenyaLanded: CIF, 25 % duty, IDF 3.5 %, RDL 2 %, VAT 16 % on CIF + duty', () => {
  const e = estimateKenyaLanded({ goodsCents: 100_000, freightCents: 20_000, origin: 'CN', dutyRate: 0.25 });
  assert.equal(e.cifCents, 120_000);
  assert.equal(e.dutyCents, 30_000);
  assert.equal(e.idfCents, 4_200);
  assert.equal(e.rdlCents, 2_400);
  assert.equal(e.vatCents, 24_000);
  assert.equal(e.taxesCents, 60_600);
  assert.equal(e.totalCents, 180_600);
});

test('estimateKenyaLanded: EAC origin pays no import duty; junk input is treated as zero', () => {
  const e = estimateKenyaLanded({ goodsCents: 100_000, freightCents: 0, origin: 'UG', dutyRate: 0.35 });
  assert.equal(e.dutyCents, 0);
  assert.equal(e.vatCents, 16_000);
  const z = estimateKenyaLanded({ goodsCents: Number.NaN, freightCents: -5, origin: 'US', dutyRate: 0.1 });
  assert.equal(z.totalCents, 0);
});

test('freightShareByOrigin: freight / goods per origin from live listings', () => {
  assert.deepEqual(freightShareByOrigin([
    { origin_country: 'CN', goods_cents: 40_000, freight_cents: 8_000 },
    { origin_country: 'CN', goods_cents: 60_000, freight_cents: 12_000 },
    { origin_country: 'US', goods_cents: 50_000, freight_cents: 15_000 },
    { origin_country: 'TR', goods_cents: 0, freight_cents: 1_000 },
  ]), { CN: 0.2, US: 0.3 });
});
