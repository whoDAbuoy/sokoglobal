// Run: npx tsx --conditions=react-server --test lib/catalog.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCategoryTree, catalogHref, categoryPath, computeFacets, descendantIds, effectiveSchema, flattenTree, matchesFilters,
  parseAttributeSchema, parseCatalogQuery, parseCustomAttributes, resolveCategory, slugify, sortListings, toggleFilter,
  unitPriceFor, validateAttributeSchemaJson, validateAttributes, validateListing, validatePriceTiers, type CategoryRow,
} from './catalog.ts';

const cat = (id: string, parent: string | null, name: string, schema: unknown[] = [], extra: Partial<CategoryRow> = {}): CategoryRow => ({
  id, parent_id: parent, slug: slugify(name), name, sort_order: 0, is_active: true, attribute_schema: schema,
  legacy_category: 'general', requires_compliance: false, ...extra,
});
export const CATS: CategoryRow[] = [
  cat('agri', null, 'Agriculture', [
    { key: 'grade', label: 'Grade', type: 'select', facet: true, options: ['Premium / Grade A', 'Grade B'] },
    { key: 'harvest_year', label: 'Harvest year', type: 'number', facet: true },
    { key: 'certifications', label: 'Certifications', type: 'multiselect', facet: true, options: ['Organic', 'Fairtrade'] },
  ]),
  cat('spice', 'agri', 'Spices', [{ key: 'form', label: 'Form', type: 'select', options: ['Whole', 'Ground'] }]),
  cat('van', 'spice', 'Vanilla Beans', [{ key: 'bean_length_cm', label: 'Bean length', type: 'number', unit: 'cm', required: true }]),
  cat('chem', null, 'Chemicals', [{ key: 'sds_available', label: 'SDS available', type: 'boolean', required: true }], { requires_compliance: true }),
  cat('old', null, 'Paused', [], { is_active: false }),
];

test('tree: nesting, ordering, orphan → root, self-parent cut', () => {
  const rows = [...CATS, cat('orphan', 'missing', 'Orphan'), cat('self', 'self', 'Self')];
  const tree = buildCategoryTree(rows);
  assert.deepEqual(tree.map((n) => n.id).sort(), ['agri', 'chem', 'old', 'orphan', 'self'].sort());
  const flat = flattenTree(tree);
  assert.equal(flat.find((n) => n.id === 'van')?.depth, 2);
  assert.deepEqual(categoryPath(CATS, 'van').map((c) => c.id), ['agri', 'spice', 'van']);
  assert.deepEqual(descendantIds(CATS, 'agri').sort(), ['agri', 'spice', 'van']);
  assert.deepEqual(categoryPath(CATS, 'nope'), []);
});

test('effectiveSchema: base fields + ancestors + own, later keys override', () => {
  const keys = effectiveSchema(CATS, 'van').map((f) => f.key);
  assert.deepEqual(keys, ['pack_size', 'packaging', 'hs_code', 'grade', 'harvest_year', 'certifications', 'form', 'bean_length_cm']);
  const rows = [...CATS, cat('x', 'agri', 'X', [{ key: 'grade', label: 'Cup grade', type: 'text' }])];
  assert.equal(effectiveSchema(rows, 'x').find((f) => f.key === 'grade')?.type, 'text');
});

test('parseAttributeSchema drops invalid entries; JSON validator reports them', () => {
  const parsed = parseAttributeSchema([{ key: 'ok_key', label: 'OK', type: 'text' }, { key: 'Bad Key', type: 'text' }, { key: 'sel', type: 'select' }, { key: 'ok_key', type: 'number' }]);
  assert.deepEqual(parsed.map((f) => f.key), ['ok_key']);
  assert.equal(validateAttributeSchemaJson('[{"key":"grade","label":"Grade","type":"select","options":["A"]}]').ok, true);
  assert.equal(validateAttributeSchemaJson('{"key":1}').ok, false);
  assert.equal(validateAttributeSchemaJson('[{"key":"g","type":"text"}]').ok, false, 'key too short');
  assert.equal(validateAttributeSchemaJson('not json').ok, false);
});

test('validateAttributes: coercion, canonical options, required, custom keys', () => {
  const schema = effectiveSchema(CATS, 'van');
  const r = validateAttributes(schema, {
    grade: 'premium / grade a', harvest_year: '2,026', certifications: 'organic; Fairtrade', bean_length_cm: '17', moisture: '', custom_note: 'hand cured',
  });
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(r.attributes, { grade: 'Premium / Grade A', harvest_year: 2026, certifications: ['Organic', 'Fairtrade'], bean_length_cm: 17, custom_note: 'hand cured' });
  const bad = validateAttributes(schema, { grade: 'Z', harvest_year: 'soon', certifications: 'Organic, Kosher', 'Bad key': 'x' });
  assert.ok(!bad.ok);
  if (!bad.ok) assert.deepEqual(Object.keys(bad.errors).sort(), ['Bad key', 'bean_length_cm', 'certifications', 'grade', 'harvest_year'].sort());
  const chem = validateAttributes(effectiveSchema(CATS, 'chem'), { sds_available: 'Yes' });
  assert.ok(chem.ok && chem.attributes.sds_available === true);
  assert.equal(validateAttributes(effectiveSchema(CATS, 'chem'), { sds_available: 'maybe' }).ok, false);
});

const listing = (over: Record<string, unknown> = {}) => ({
  categoryId: 'van', title: 'Madagascar vanilla', sku: 'VAN-1', moq: '2', unitOfMeasure: 'kg', unitPriceCents: 30_000, trialUnits: 2,
  leadTimeDays: '21', originCountry: 'mg', attributes: { bean_length_cm: '17', grade: 'Grade B' },
  priceTiers: [{ min_qty: 10, unit_price_cents: 28_000 }, { min_qty: 50, unit_price_cents: 25_000 }], ...over,
});

test('validateListing: a complete listing maps to the supplier insert columns', () => {
  const v = validateListing(listing(), CATS);
  assert.ok(v.ok);
  if (v.ok) {
    assert.equal(v.value.trial_goods_cents, 60_000);
    assert.equal(v.value.origin_country, 'MG');
    assert.equal(v.value.moq, 2);
    assert.deepEqual(v.value.attributes, { grade: 'Grade B', bean_length_cm: 17 });
    assert.ok(!('status' in v.value) && !('is_featured' in v.value), 'never sets status or featured');
  }
});

test('validateListing: every problem reported at once', () => {
  const v = validateListing(listing({ title: 'x', sku: '-bad', moq: '0', unitPriceCents: 0, leadTimeDays: '200', originCountry: 'Kenya', attributes: {} }), CATS);
  assert.ok(!v.ok);
  if (!v.ok) for (const k of ['title', 'sku', 'moq', 'unit_price', 'lead_time', 'origin_country', 'attr.bean_length_cm']) assert.ok(k in v.errors, k);
  const inactive = validateListing(listing({ categoryId: 'old', attributes: {} }), CATS);
  assert.ok(!inactive.ok && /not accepting/.test(inactive.errors.category));
  const tiersBelowMoq = validateListing(listing({ moq: '20' }), CATS);
  assert.ok(!tiersBelowMoq.ok && /below the MOQ/.test(tiersBelowMoq.errors.price_tiers));
});

test('price tiers: increasing quantities, never pricier, ≤ base; unitPriceFor picks the deepest tier', () => {
  assert.equal(validatePriceTiers([{ min_qty: 10, unit_price_cents: 900 }, { min_qty: 5, unit_price_cents: 800 }], 1000).ok, false);
  assert.equal(validatePriceTiers([{ min_qty: 10, unit_price_cents: 900 }, { min_qty: 50, unit_price_cents: 950 }], 1000).ok, false);
  assert.equal(validatePriceTiers([{ min_qty: 10, unit_price_cents: 1100 }], 1000).ok, false);
  assert.equal(validatePriceTiers([{ min_qty: 1.5, unit_price_cents: 900 }], 1000).ok, false);
  assert.equal(validatePriceTiers(Array.from({ length: 11 }, (_, i) => ({ min_qty: i + 1, unit_price_cents: 900 })), 1000).ok, false);
  const tiers = [{ min_qty: 10, unit_price_cents: 900 }, { min_qty: 50, unit_price_cents: 800 }];
  assert.equal(unitPriceFor(1000, tiers, 9), 1000);
  assert.equal(unitPriceFor(1000, tiers, 10), 900);
  assert.equal(unitPriceFor(1000, tiers, 500), 800);
});

test('resolveCategory: slug, unique name, or path', () => {
  assert.equal(resolveCategory(CATS, 'vanilla-beans')?.id, 'van');
  assert.equal(resolveCategory(CATS, 'Vanilla Beans')?.id, 'van');
  assert.equal(resolveCategory(CATS, 'Agriculture > Spices')?.id, 'spice');
  assert.equal(resolveCategory(CATS, 'spices › vanilla beans')?.id, 'van');
  assert.equal(resolveCategory(CATS, 'Weapons'), null);
  assert.equal(resolveCategory(CATS, ''), null);
});

test('parseCustomAttributes / slugify', () => {
  assert.deepEqual(parseCustomAttributes('Grade: A; Harvest year=2026\nNo separator; 9 lives: yes'), { grade: 'A', harvest_year: '2026', a_9_lives: 'yes' });
  assert.equal(slugify('Spices & Herbs'), 'spices-and-herbs');
  assert.equal(slugify('Café Crème'), 'cafe-creme');
});

test('catalog query string round-trips; toggling resets the page', () => {
  const q = parseCatalogQuery({ category: 'vanilla-beans', q: ' vanilla ', sort: 'price_asc', page: '3', 'f.grade': ['Grade B', 'Premium / Grade A'], 'min.harvest_year': '2025', 'max.harvest_year': '', 'f.Bad Key': 'x', evil: '1' });
  assert.deepEqual(q, { category: 'vanilla-beans', q: 'vanilla', sort: 'price_asc', page: 3, filters: { grade: ['Grade B', 'Premium / Grade A'] }, ranges: { harvest_year: { min: 2025 } } });
  const href = catalogHref(q);
  const back = parseCatalogQuery(Object.fromEntries([...new URL(href, 'https://x').searchParams].reduce((m, [k, v]) => m.set(k, [...(m.get(k) ?? []), v]), new Map<string, string[]>())));
  assert.deepEqual(back, q);
  const t = toggleFilter(q, 'grade', 'Grade B');
  assert.deepEqual(t.filters, { grade: ['Premium / Grade A'] });
  assert.equal(t.page, 1);
  assert.deepEqual(toggleFilter(toggleFilter(t, 'grade', 'Premium / Grade A'), 'form', 'Whole').filters, { form: ['Whole'] });
  assert.equal(parseCatalogQuery({ category: '../etc', sort: 'drop table' }).category, null);
  assert.equal(catalogHref(parseCatalogQuery({})), '/dashboard/discover');
});

const L = (attributes: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ attributes, created_at: '2026-10-01T00:00:00Z', landed_cost_cents: 50_000, ...extra });

test('matchesFilters: AND across keys, OR within, arrays and booleans, ranges', () => {
  const a = { grade: 'Grade B', certifications: ['Organic', 'Fairtrade'], harvest_year: 2026, cold_chain: true };
  assert.equal(matchesFilters(a, { grade: ['grade b'] }), true);
  assert.equal(matchesFilters(a, { grade: ['Grade B'], certifications: ['Kosher', 'Organic'] }), true);
  assert.equal(matchesFilters(a, { grade: ['Grade B'], certifications: ['Kosher'] }), false);
  assert.equal(matchesFilters(a, { cold_chain: ['Yes'] }), true);
  assert.equal(matchesFilters(a, {}, { harvest_year: { min: 2025, max: 2026 } }), true);
  assert.equal(matchesFilters(a, {}, { harvest_year: { min: 2027 } }), false);
  assert.equal(matchesFilters({}, {}, { harvest_year: { min: 1 } }), false);
  assert.equal(matchesFilters(null, {}), true);
});

test('computeFacets: counts per value, ranges for numbers, skips empty fields', () => {
  const schema = effectiveSchema(CATS, 'van');
  const facets = computeFacets(schema, [
    L({ grade: 'Grade B', certifications: ['Organic'], harvest_year: 2025 }),
    L({ grade: 'Grade B', certifications: ['Organic', 'Fairtrade'], harvest_year: 2026 }),
    L({ grade: 'Premium / Grade A' }),
  ]);
  const by = Object.fromEntries(facets.map((f) => [f.field.key, f]));
  assert.deepEqual(by.grade.values, [{ value: 'Grade B', count: 2 }, { value: 'Premium / Grade A', count: 1 }]);
  assert.deepEqual(by.certifications.values, [{ value: 'Organic', count: 2 }, { value: 'Fairtrade', count: 1 }]);
  assert.deepEqual(by.harvest_year.range, { min: 2025, max: 2026 });
  assert.equal(by.form, undefined, 'no listing has a form value');
  assert.equal(by.pack_size, undefined, 'plain text fields are not facets');
});

test('sortListings: featured first, then newest; price sorts', () => {
  const rows = [
    L({}, { id: 'a', created_at: '2026-10-03T00:00:00Z', landed_cost_cents: 70_000 }),
    L({}, { id: 'b', created_at: '2026-10-01T00:00:00Z', landed_cost_cents: 50_000, is_featured: true }),
    L({}, { id: 'c', created_at: '2026-10-02T00:00:00Z', landed_cost_cents: 60_000 }),
  ];
  assert.deepEqual(sortListings(rows, 'featured').map((r) => r.id), ['b', 'a', 'c']);
  assert.deepEqual(sortListings(rows, 'newest').map((r) => r.id), ['a', 'c', 'b']);
  assert.deepEqual(sortListings(rows, 'price_asc').map((r) => r.id), ['b', 'c', 'a']);
  assert.deepEqual(sortListings(rows, 'price_desc').map((r) => r.id), ['a', 'c', 'b']);
});
