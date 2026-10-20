// Run: npx tsx --conditions=react-server --test lib/catalog-import.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IMPORT_MAX_ROWS, cellToText, mapImportRows, parseCsv, templateCsv } from './catalog-import.ts';
import type { CategoryRow } from './catalog.ts';

// Mirrors the seeded nodes in supabase/migrations/015_catalog.sql that the template uses.
const c = (id: string, parent: string | null, slug: string, name: string, attribute_schema: unknown[]): CategoryRow =>
  ({ id, parent_id: parent, slug, name, sort_order: 0, is_active: true, attribute_schema, legacy_category: 'general', requires_compliance: false });
const SEED: CategoryRow[] = [
  c('a', null, 'agriculture', 'Agriculture & Produce', [
    { key: 'grade', label: 'Purity / quality grade', type: 'select', facet: true, options: ['Premium / Grade A', 'Grade B', 'Grade C', 'Industrial / processing'] },
    { key: 'harvest_year', label: 'Harvest year', type: 'number', facet: true },
    { key: 'moisture_pct', label: 'Moisture', type: 'number', unit: '%' },
  ]),
  c('s', 'a', 'spices-herbs', 'Spices & Herbs', [{ key: 'form', label: 'Form', type: 'select', facet: true, options: ['Whole', 'Cut / sifted', 'Ground', 'Oil / extract'] }]),
  c('v', 's', 'vanilla-beans', 'Vanilla Beans', [
    { key: 'bean_length_cm', label: 'Bean length', type: 'number', unit: 'cm', facet: true },
    { key: 'vanillin_pct', label: 'Vanillin content', type: 'number', unit: '%' },
    { key: 'variety', label: 'Variety', type: 'select', facet: true, options: ['Planifolia (Bourbon)', 'Tahitensis', 'Pompona'] },
  ]),
  c('k', 'a', 'coffee-tea', 'Coffee, Tea & Cocoa', [
    { key: 'variety', label: 'Variety / cultivar', type: 'text', facet: true },
    { key: 'process', label: 'Process', type: 'select', facet: true, options: ['Washed', 'Natural', 'Honey', 'CTC', 'Orthodox', 'Fermented'] },
    { key: 'cupping_score', label: 'Cupping score', type: 'number' },
  ]),
];

test('parseCsv: quotes, escaped quotes, embedded newlines, CRLF, BOM, blank lines', () => {
  const rows = parseCsv('﻿a,b,c\r\n"x, y","he said ""hi""","line1\nline2"\r\n\r\n1,,3\n');
  assert.deepEqual(rows, [['a', 'b', 'c'], ['x, y', 'he said "hi"', 'line1\nline2'], ['1', '', '3']]);
});

test('parseCsv: detects semicolon and tab delimiters (European Excel exports)', () => {
  assert.deepEqual(parseCsv('title;price\nBeans;12,50\n'), [['title', 'price'], ['Beans', '12,50']]);
  assert.deepEqual(parseCsv('title\tprice\nBeans\t12\n'), [['title', 'price'], ['Beans', '12']]);
});

test('the downloadable template imports cleanly against the seeded categories', () => {
  const r = mapImportRows(parseCsv(templateCsv()), SEED, { defaultOrigin: 'KE' });
  assert.equal(r.fatal, undefined);
  assert.deepEqual(r.rows.map((x) => x.errors), [[], []]);
  const [vanilla, coffee] = r.rows.map((x) => x.value!);
  assert.equal(vanilla.category_id, 'v');
  assert.equal(vanilla.sku, 'VAN-A-17');
  assert.equal(vanilla.trial_goods_cents, 64_000);
  assert.deepEqual(vanilla.price_tiers, [{ min_qty: 10, unit_price_cents: 29_500 }, { min_qty: 50, unit_price_cents: 27_000 }]);
  assert.deepEqual(vanilla.attributes, { grade: 'Premium / Grade A', harvest_year: 2026, packaging: 'Bag / sack', bean_length_cm: 17, vanillin_pct: 2.1, variety: 'Planifolia (Bourbon)' });
  assert.equal(coffee.category_id, 'k', 'path "Agriculture > Coffee, Tea & Cocoa" resolves');
  assert.equal(coffee.unit_price_cents, 980);
  assert.equal(coffee.attributes.process, 'Washed');
});

test('row errors: unknown category, bad price, incomplete tier, duplicate SKU, bad attribute', () => {
  const csv = [
    'category,title,sku,unit_price_usd,trial_units,tier1_min_qty,tier1_unit_price_usd,attr:grade,Origin',
    'weapons,Thing,S1,10,5,,,,',
    'vanilla-beans,Beans,S2,ten,5,,,,',
    'vanilla-beans,Beans two,S3,10,5,10,,,',
    'vanilla-beans,Beans three,s3,10,5,,,,',
    'vanilla-beans,Beans four,S4,10,5,,,Z grade,',
    'vanilla-beans,Beans five,S5,10,5,,,Grade B,MG',
  ].join('\n');
  const r = mapImportRows(parseCsv(csv), SEED, { defaultOrigin: 'KE' });
  const e = r.rows.map((x) => x.errors.join(' | '));
  assert.match(e[0], /Unknown category "weapons"/);
  assert.match(e[1], /unit_price_usd must be a number/);
  assert.match(e[2], /Tier 1 needs both/);
  assert.match(e[3], /SKU s3 is repeated \(also on line 4\)/);
  assert.match(e[4], /Purity \/ quality grade must be one of/);
  assert.equal(e[5], '');
  assert.equal(r.rows[5].value?.origin_country, 'MG');
  assert.equal(r.valid, 1);
  assert.equal(r.invalid, 5);
});

test('fatal errors: missing columns, empty file, too many rows', () => {
  assert.match(mapImportRows([['title'], ['x']], SEED, { defaultOrigin: 'KE' }).fatal!, /"category" and "title"/);
  assert.match(mapImportRows([['category', 'title']], SEED, { defaultOrigin: 'KE' }).fatal!, /at least one product row/);
  const big = [['category', 'title'], ...Array.from({ length: IMPORT_MAX_ROWS + 1 }, () => ['vanilla-beans', 'x'])];
  assert.match(mapImportRows(big, SEED, { defaultOrigin: 'KE' }).fatal!, /up to 500 rows/);
});

test('cellToText: Excel cell values to text', () => {
  assert.equal(cellToText(null), '');
  assert.equal(cellToText(12), '12');
  assert.equal(cellToText(0.1 + 0.2), '0.3');
  assert.equal(cellToText(true), 'yes');
  assert.equal(cellToText(new Date('2026-05-01T00:00:00Z')), '2026-05-01');
});
