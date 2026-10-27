/**
 * Multi-commodity catalogue: category tree, attribute schemas, listing
 * validation, price tiers and buyer-side facet filtering. Pure (no React, no
 * Supabase). Contract: supabase/migrations/015_catalog.sql.
 */

export type AttributeType = 'text' | 'number' | 'select' | 'multiselect' | 'list' | 'boolean';

export type AttributeField = {
  key: string;
  label: string;
  type: AttributeType;
  unit?: string;
  options?: string[];
  required?: boolean;
  /** Offered as a filter on /dashboard/discover. */
  facet?: boolean;
};

export interface CategoryRow {
  id: string;
  parent_id: string | null;
  slug: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  sort_order: number;
  is_active: boolean;
  attribute_schema: unknown;
  legacy_category: 'beauty' | 'clothing' | 'general';
  requires_compliance: boolean;
}

export interface CategoryNode extends CategoryRow { depth: number; children: CategoryNode[] }

export const ATTR_KEY_RE = /^[a-z][a-z0-9_]{1,39}$/;
export const SKU_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/;
export const MAX_ATTRIBUTES = 40;
export const MAX_PRICE_TIERS = 10;

export const UNITS = ['unit', 'piece', 'pair', 'set', 'dozen', 'carton', 'bag', 'kg', 'tonne', 'g', 'litre', 'ml', 'metre', 'm²', 'm³', 'pallet', 'container'] as const;

/** Fields every listing can carry whatever its category. */
export const BASE_FIELDS: AttributeField[] = [
  { key: 'pack_size', label: 'Weight / volume per unit', type: 'text' },
  { key: 'packaging', label: 'Packaging', type: 'select', facet: true, options: ['Bag / sack', 'Carton', 'Drum / barrel', 'Bottle / jar', 'Pallet', 'Crate', 'IBC tote', 'Bulk / loose', 'Container load'] },
  { key: 'hs_code', label: 'HS code', type: 'text' },
];

const TYPES: AttributeType[] = ['text', 'number', 'select', 'multiselect', 'list', 'boolean'];

/** Sanitises a category's attribute_schema (admins edit it as JSON). Invalid entries are dropped. */
export function parseAttributeSchema(raw: unknown): AttributeField[] {
  if (!Array.isArray(raw)) return [];
  const out: AttributeField[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const key = typeof r.key === 'string' ? r.key.trim() : '';
    const type = r.type as AttributeType;
    if (!ATTR_KEY_RE.test(key) || seen.has(key) || !TYPES.includes(type)) continue;
    const label = typeof r.label === 'string' && r.label.trim() ? r.label.trim().slice(0, 60) : key;
    const field: AttributeField = { key, label, type };
    if (typeof r.unit === 'string' && r.unit.trim()) field.unit = r.unit.trim().slice(0, 16);
    if (type === 'select' || type === 'multiselect') {
      const opts = Array.isArray(r.options) ? [...new Set(r.options.filter((o): o is string => typeof o === 'string').map((o) => o.trim()).filter(Boolean))].slice(0, 50) : [];
      if (opts.length === 0) continue;
      field.options = opts;
    }
    if (r.required === true) field.required = true;
    if (r.facet === true) field.facet = true;
    seen.add(key);
    out.push(field);
  }
  return out;
}

export function validateAttributeSchemaJson(text: string): { ok: true; schema: AttributeField[] } | { ok: false; error: string } {
  let raw: unknown;
  try { raw = JSON.parse(text || '[]'); } catch { return { ok: false, error: 'Attribute fields must be valid JSON (a list of objects).' }; }
  if (!Array.isArray(raw)) return { ok: false, error: 'Attribute fields must be a JSON list.' };
  const schema = parseAttributeSchema(raw);
  if (schema.length !== raw.length) return { ok: false, error: 'Each field needs a key (a–z, 0–9, _), a label and a type; selects need options; keys must be unique.' };
  return { ok: true, schema };
}

const bySort = (a: CategoryRow, b: CategoryRow) => a.sort_order - b.sort_order || a.name.localeCompare(b.name);

/** Rows → forest. Rows whose parent is missing become roots; cycles are cut at the first revisit. */
export function buildCategoryTree(rows: readonly CategoryRow[]): CategoryNode[] {
  const ids = new Set(rows.map((r) => r.id));
  const kids = new Map<string | null, CategoryRow[]>();
  for (const r of rows) {
    const parent = r.parent_id && ids.has(r.parent_id) && r.parent_id !== r.id ? r.parent_id : null;
    kids.set(parent, [...(kids.get(parent) ?? []), r]);
  }
  const visited = new Set<string>();
  const walk = (parent: string | null, depth: number): CategoryNode[] =>
    (kids.get(parent) ?? []).sort(bySort).filter((r) => !visited.has(r.id)).map((r) => {
      visited.add(r.id);
      return { ...r, depth, children: walk(r.id, depth + 1) };
    });
  return walk(null, 0);
}

/** Depth-first list for selects: [{ row, depth }] in display order. */
export function flattenTree(nodes: readonly CategoryNode[]): CategoryNode[] {
  return nodes.flatMap((n) => [n, ...flattenTree(n.children)]);
}

/** Root → … → category. Empty when the id is unknown. */
export function categoryPath(rows: readonly CategoryRow[], id: string | null | undefined): CategoryRow[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const path: CategoryRow[] = [];
  let cur = id ? byId.get(id) : undefined;
  while (cur && !path.includes(cur) && path.length < 8) {
    path.unshift(cur);
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return path;
}

export const pathLabel = (rows: readonly CategoryRow[], id: string | null | undefined) => categoryPath(rows, id).map((c) => c.name).join(' › ');

/** The category and everything under it. */
export function descendantIds(rows: readonly CategoryRow[], id: string): string[] {
  const out = [id];
  for (let i = 0; i < out.length && out.length <= rows.length; i++) {
    for (const r of rows) if (r.parent_id === out[i] && !out.includes(r.id)) out.push(r.id);
  }
  return out;
}

/** Fields for a category: base fields, then each ancestor's, then its own. A later key replaces an earlier one. */
export function effectiveSchema(rows: readonly CategoryRow[], id: string | null | undefined): AttributeField[] {
  const merged = new Map<string, AttributeField>();
  for (const f of BASE_FIELDS) merged.set(f.key, f);
  for (const c of categoryPath(rows, id)) for (const f of parseAttributeSchema(c.attribute_schema)) merged.set(f.key, f);
  return [...merged.values()];
}

export function requiresCompliance(rows: readonly CategoryRow[], id: string | null | undefined): boolean {
  return categoryPath(rows, id).some((c) => c.requires_compliance);
}

/** Lookup by slug, exact name, or a "Parent > Child" path (case-insensitive). Used by bulk import. */
export function resolveCategory(rows: readonly CategoryRow[], ref: string): CategoryRow | null {
  const r = ref.trim().toLowerCase();
  if (!r) return null;
  const bySlug = rows.find((c) => c.slug === r);
  if (bySlug) return bySlug;
  const parts = r.split(/\s*(?:>|›|\/)\s*/).filter(Boolean);
  if (parts.length > 1) {
    // Each part matches a node's name, its slug, or the start of its name ("Agriculture" → "Agriculture & Produce").
    const same = (node: CategoryRow, part: string) => {
      const n = node.name.toLowerCase();
      return n === part || node.slug === slugify(part) || n.startsWith(`${part} `);
    };
    const hit = rows.find((c) => {
      const p = categoryPath(rows, c.id);
      return p.length >= parts.length && parts.every((part, i) => same(p[p.length - parts.length + i], part));
    });
    if (hit) return hit;
  }
  const byName = rows.filter((c) => c.name.toLowerCase() === r);
  return byName.length === 1 ? byName[0] : null;
}

/* ── Attributes ──────────────────────────────────────────────────────────── */

export type AttributeValue = string | number | boolean | string[];
export type AttributeResult = { ok: true; attributes: Record<string, AttributeValue> } | { ok: false; errors: Record<string, string> };

const TRUE = new Set(['true', 'yes', 'y', '1', 'on']);
const FALSE = new Set(['false', 'no', 'n', '0', 'off']);
const splitList = (v: unknown): string[] =>
  (Array.isArray(v) ? v.map(String) : typeof v === 'string' ? v.split(/[,;|]/) : []).map((s) => s.trim()).filter(Boolean);
const isBlank = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);

/**
 * Coerces and checks attribute values against the category schema. Keys outside
 * the schema are kept as free-text "custom" attributes (key format and size limited).
 * Blank values are dropped. Option matching is case-insensitive and returns the canonical option.
 */
export function validateAttributes(schema: readonly AttributeField[], input: Record<string, unknown>): AttributeResult {
  const out: Record<string, AttributeValue> = {};
  const errors: Record<string, string> = {};
  const fields = new Map(schema.map((f) => [f.key, f]));

  for (const f of schema) {
    const v = input[f.key];
    if (isBlank(v)) { if (f.required) errors[f.key] = `${f.label} is required.`; continue; }
    switch (f.type) {
      case 'number': {
        const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '').trim());
        if (!Number.isFinite(n) || Math.abs(n) > 1e12) errors[f.key] = `${f.label} must be a number.`;
        else out[f.key] = n;
        break;
      }
      case 'boolean': {
        const s = String(v).trim().toLowerCase();
        if (typeof v === 'boolean') out[f.key] = v;
        else if (TRUE.has(s)) out[f.key] = true;
        else if (FALSE.has(s)) out[f.key] = false;
        else errors[f.key] = `${f.label} must be yes or no.`;
        break;
      }
      case 'select': {
        const hit = f.options?.find((o) => o.toLowerCase() === String(v).trim().toLowerCase());
        if (!hit) errors[f.key] = `${f.label} must be one of: ${f.options?.join(', ')}.`;
        else out[f.key] = hit;
        break;
      }
      case 'multiselect': {
        const picked = splitList(v);
        const canonical = picked.map((p) => f.options?.find((o) => o.toLowerCase() === p.toLowerCase()));
        if (canonical.some((c) => !c)) errors[f.key] = `${f.label}: choose from ${f.options?.join(', ')}.`;
        else out[f.key] = [...new Set(canonical as string[])];
        break;
      }
      case 'list': {
        const items = [...new Set(splitList(v).map((s) => s.slice(0, 80)))].slice(0, 50);
        if (items.length) out[f.key] = items;
        break;
      }
      default: {
        const s = String(v).trim();
        if (s.length > 200) errors[f.key] = `${f.label} is too long (200 characters max).`;
        else out[f.key] = s;
      }
    }
  }

  for (const [key, v] of Object.entries(input)) {
    if (fields.has(key) || isBlank(v)) continue;
    if (!ATTR_KEY_RE.test(key)) { errors[key] = `Custom attribute names use a–z, 0–9 and _ (2–40 characters): "${key}".`; continue; }
    const s = Array.isArray(v) ? v.map(String).join(', ') : String(v).trim();
    if (s.length > 200) errors[key] = `${key} is too long (200 characters max).`;
    else out[key] = s;
  }

  if (Object.keys(out).length > MAX_ATTRIBUTES) errors._ = `Use at most ${MAX_ATTRIBUTES} attributes.`;
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, attributes: out };
}

/** "Grade: A; Harvest year=2026" → { grade: 'A', harvest_year: '2026' } (keys slugified). */
export function parseCustomAttributes(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of text.split(/[;\n]/)) {
    const m = part.match(/^\s*([^:=]+?)\s*[:=]\s*(.+?)\s*$/);
    if (!m) continue;
    const key = slugKey(m[1]);
    if (key) out[key] = m[2];
  }
  return out;
}

export function slugKey(label: string): string {
  return label.trim().toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'a_$1').slice(0, 40);
}

export function slugify(name: string): string {
  return name.trim().toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

export function formatAttribute(field: AttributeField | undefined, value: unknown): string {
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  const s = String(value ?? '');
  return field?.unit ? `${s} ${field.unit}` : s;
}

/* ── Price tiers ─────────────────────────────────────────────────────────── */

export type PriceTier = { min_qty: number; unit_price_cents: number };

/** Mirrors products_catalog_sync(): ≤10 tiers, increasing quantities, never pricier per unit, ≤ the base unit price. */
export function validatePriceTiers(tiers: readonly PriceTier[], baseUnitCents: number): { ok: true; tiers: PriceTier[] } | { ok: false; error: string } {
  if (tiers.length > MAX_PRICE_TIERS) return { ok: false, error: `Use at most ${MAX_PRICE_TIERS} price tiers.` };
  const sorted = [...tiers];
  let prevQty = 0;
  let prevPrice = baseUnitCents;
  for (const t of sorted) {
    if (!Number.isInteger(t.min_qty) || t.min_qty < 1 || !Number.isInteger(t.unit_price_cents) || t.unit_price_cents < 1) {
      return { ok: false, error: 'Each price tier needs a whole minimum quantity and a unit price.' };
    }
    if (t.min_qty <= prevQty) return { ok: false, error: 'Price tiers must have increasing minimum quantities.' };
    if (t.unit_price_cents > prevPrice) return { ok: false, error: 'Larger price tiers cannot cost more per unit than smaller ones (or the base price).' };
    prevQty = t.min_qty; prevPrice = t.unit_price_cents;
  }
  return { ok: true, tiers: sorted };
}

export function parsePriceTiers(raw: unknown): PriceTier[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((t): t is PriceTier => !!t && typeof t === 'object' && Number.isInteger((t as PriceTier).min_qty) && Number.isInteger((t as PriceTier).unit_price_cents));
}

/** Unit price for an order quantity: the deepest tier the quantity reaches, else the base price. */
export function unitPriceFor(baseUnitCents: number, tiers: readonly PriceTier[], qty: number): number {
  let price = baseUnitCents;
  for (const t of tiers) if (qty >= t.min_qty) price = Math.min(price, t.unit_price_cents);
  return price;
}

/* ── Listing ─────────────────────────────────────────────────────────────── */

export interface ListingInput {
  categoryId: string;
  title: string;
  brand?: string;
  description?: string;
  sku?: string;
  moq?: string | number | null;
  unitOfMeasure?: string;
  unitPriceCents: number;
  trialUnits: number;
  leadTimeDays?: string | number | null;
  originCountry: string;
  attributes: Record<string, unknown>;
  priceTiers?: PriceTier[];
}

/** Columns a supplier may insert (column grants in migration 015). Status is always draft. */
export interface ProductInsert {
  category_id: string;
  title: string;
  brand: string | null;
  description: string | null;
  sku: string | null;
  moq: number | null;
  unit_of_measure: string | null;
  unit_price_cents: number;
  trial_units: number;
  trial_goods_cents: number;
  lead_time_days: number | null;
  origin_country: string;
  attributes: Record<string, AttributeValue>;
  price_tiers: PriceTier[];
}

export type ListingResult = { ok: true; value: ProductInsert; category: CategoryRow } | { ok: false; errors: Record<string, string> };

const optInt = (v: string | number | null | undefined) => {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const n = Number(String(v).replace(/,/g, '').trim());
  return Number.isInteger(n) ? n : NaN;
};

/** Everything the DB checks, plus the category's attribute schema — so suppliers see every problem at once. */
export function validateListing(input: ListingInput, categories: readonly CategoryRow[]): ListingResult {
  const errors: Record<string, string> = {};
  const category = categories.find((c) => c.id === input.categoryId);
  if (!category) errors.category = 'Choose a category.';
  else if (!category.is_active) errors.category = `"${category.name}" is not accepting new listings.`;

  const title = input.title.trim().replace(/\s+/g, ' ');
  if (title.length < 3 || title.length > 140) errors.title = 'Title must be 3–140 characters.';
  const description = (input.description ?? '').trim();
  if (description.length > 5000) errors.description = 'Description is limited to 5,000 characters.';
  const brand = (input.brand ?? '').trim().slice(0, 120) || null;

  const sku = (input.sku ?? '').trim() || null;
  if (sku && !SKU_RE.test(sku)) errors.sku = 'SKU: letters, digits, . _ / - (up to 64, starting with a letter or digit).';

  const moq = optInt(input.moq);
  if (Number.isNaN(moq) || (moq !== null && (moq < 1 || moq > 100_000_000))) errors.moq = 'MOQ must be a whole number of at least 1.';
  const unit = (input.unitOfMeasure ?? '').trim() || null;
  if (unit && unit.length > 24) errors.unit_of_measure = 'Unit is limited to 24 characters.';

  if (!Number.isInteger(input.unitPriceCents) || input.unitPriceCents <= 0) errors.unit_price = 'Enter a unit price above $0.';
  if (!Number.isInteger(input.trialUnits) || input.trialUnits <= 0) errors.trial_units = 'Trial units must be a whole number above 0.';
  const goods = input.unitPriceCents * input.trialUnits;
  if (!Number.isSafeInteger(goods) || goods > 2_000_000_000) errors.trial_units = 'Trial batch value is too large.';

  const lead = optInt(input.leadTimeDays);
  if (Number.isNaN(lead) || (lead !== null && (lead < 1 || lead > 120))) errors.lead_time = 'Lead time must be 1–120 days.';

  const origin = input.originCountry.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(origin)) errors.origin_country = 'Origin must be a 2-letter country code (e.g. KE, MG).';

  let attributes: Record<string, AttributeValue> = {};
  if (category) {
    const a = validateAttributes(effectiveSchema(categories, category.id), input.attributes);
    if (a.ok) attributes = a.attributes;
    else for (const [k, msg] of Object.entries(a.errors)) errors[`attr.${k}`] = msg;
  }

  const tiersResult = validatePriceTiers(input.priceTiers ?? [], input.unitPriceCents > 0 ? input.unitPriceCents : Number.MAX_SAFE_INTEGER);
  if (!tiersResult.ok) errors.price_tiers = tiersResult.error;
  if (moq !== null && !Number.isNaN(moq) && (input.priceTiers ?? []).some((t) => t.min_qty < moq)) errors.price_tiers = 'Price tiers cannot start below the MOQ.';

  if (Object.keys(errors).length || !category || !tiersResult.ok) return { ok: false, errors };
  return {
    ok: true, category,
    value: {
      category_id: category.id, title, brand, description: description || null, sku, moq: moq as number | null,
      unit_of_measure: unit, unit_price_cents: input.unitPriceCents, trial_units: input.trialUnits, trial_goods_cents: goods,
      lead_time_days: lead as number | null, origin_country: origin, attributes, price_tiers: tiersResult.tiers,
    },
  };
}

/* ── Buyer catalogue: query string, filtering, facets ────────────────────── */

export type CatalogSort = 'featured' | 'newest' | 'price_asc' | 'price_desc';
export const CATALOG_SORTS: [CatalogSort, string][] = [['featured', 'Featured first'], ['newest', 'Newest'], ['price_asc', 'Landed cost: low to high'], ['price_desc', 'Landed cost: high to low']];
export const CATALOG_PAGE_SIZE = 24;

export interface CatalogQuery {
  category: string | null;           // slug
  q: string;
  sort: CatalogSort;
  page: number;
  filters: Record<string, string[]>; // f.<key>=value (repeatable)
  ranges: Record<string, { min?: number; max?: number }>; // min.<key>, max.<key>
}

type SearchParams = Record<string, string | string[] | undefined>;
const all = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v === undefined ? [] : [v]);

export function parseCatalogQuery(sp: SearchParams): CatalogQuery {
  const first = (k: string) => all(sp[k])[0] ?? '';
  const slug = first('category').trim().toLowerCase();
  const sort = CATALOG_SORTS.some(([s]) => s === first('sort')) ? (first('sort') as CatalogSort) : 'featured';
  const page = Math.max(1, Math.min(500, Number.parseInt(first('page'), 10) || 1));
  const filters: CatalogQuery['filters'] = {};
  const ranges: CatalogQuery['ranges'] = {};
  for (const [k, v] of Object.entries(sp)) {
    const m = k.match(/^(f|min|max)\.([a-z][a-z0-9_]{1,39})$/);
    if (!m) continue;
    if (m[1] === 'f') {
      const vals = [...new Set(all(v).map((s) => s.trim().slice(0, 80)).filter(Boolean))].slice(0, 20);
      if (vals.length) filters[m[2]] = vals;
    } else {
      const raw = (all(v)[0] ?? '').trim();
      const n = Number(raw);
      if (raw !== '' && Number.isFinite(n)) ranges[m[2]] = { ...ranges[m[2]], [m[1]]: n };
    }
  }
  return { category: /^[a-z0-9-]{1,60}$/.test(slug) ? slug : null, q: first('q').trim().slice(0, 100), sort, page, filters, ranges };
}

/** URL search string for a query (stable key order, page omitted when 1). */
export function catalogHref(q: CatalogQuery, base = '/dashboard/discover'): string {
  const p = new URLSearchParams();
  if (q.category) p.set('category', q.category);
  if (q.q) p.set('q', q.q);
  for (const k of Object.keys(q.filters).sort()) for (const v of q.filters[k]) p.append(`f.${k}`, v);
  for (const k of Object.keys(q.ranges).sort()) {
    if (q.ranges[k].min !== undefined) p.set(`min.${k}`, String(q.ranges[k].min));
    if (q.ranges[k].max !== undefined) p.set(`max.${k}`, String(q.ranges[k].max));
  }
  if (q.sort !== 'featured') p.set('sort', q.sort);
  if (q.page > 1) p.set('page', String(q.page));
  const s = p.toString();
  return s ? `${base}?${s}` : base;
}

export function toggleFilter(q: CatalogQuery, key: string, value: string): CatalogQuery {
  const cur = q.filters[key] ?? [];
  const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
  const filters = { ...q.filters };
  if (next.length) filters[key] = next; else delete filters[key];
  return { ...q, filters, page: 1 };
}

const valuesOf = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x)) : typeof v === 'boolean' ? [v ? 'Yes' : 'No'] : v === undefined || v === null || v === '' ? [] : [String(v)];

/** AND across keys, OR within a key; numeric ranges inclusive. Case-insensitive text matching. */
export function matchesFilters(attributes: Record<string, unknown> | null | undefined, filters: CatalogQuery['filters'], ranges: CatalogQuery['ranges'] = {}): boolean {
  const a = attributes ?? {};
  for (const [key, wanted] of Object.entries(filters)) {
    const have = valuesOf(a[key]).map((s) => s.toLowerCase());
    if (!wanted.some((w) => have.includes(w.toLowerCase()))) return false;
  }
  for (const [key, { min, max }] of Object.entries(ranges)) {
    const n = Number(a[key]);
    if (!Number.isFinite(n)) return false;
    if (min !== undefined && n < min) return false;
    if (max !== undefined && n > max) return false;
  }
  return true;
}

export interface Facet { field: AttributeField; values: { value: string; count: number }[]; range?: { min: number; max: number } }

/**
 * Facets for the current category: each facet-flagged (or select / boolean) field
 * with the values present in the given listings and how many listings have each.
 * Numeric facet fields get their min–max range instead.
 */
export function computeFacets(schema: readonly AttributeField[], listings: readonly { attributes: Record<string, unknown> | null }[], maxValues = 12): Facet[] {
  const out: Facet[] = [];
  for (const field of schema) {
    if (!(field.facet || field.type === 'select' || field.type === 'boolean')) continue;
    if (field.type === 'number') {
      const nums = listings.map((l) => Number(l.attributes?.[field.key])).filter((n) => Number.isFinite(n));
      if (nums.length >= 2 && Math.min(...nums) !== Math.max(...nums)) out.push({ field, values: [], range: { min: Math.min(...nums), max: Math.max(...nums) } });
      else if (nums.length) out.push({ field, values: [...new Set(nums)].map((n) => ({ value: String(n), count: nums.filter((x) => x === n).length })) });
      continue;
    }
    const counts = new Map<string, number>();
    for (const l of listings) for (const v of new Set(valuesOf(l.attributes?.[field.key]))) counts.set(v, (counts.get(v) ?? 0) + 1);
    if (counts.size === 0) continue;
    const values = [...counts].map(([value, count]) => ({ value, count })).sort((x, y) => y.count - x.count || x.value.localeCompare(y.value)).slice(0, maxValues);
    out.push({ field, values });
  }
  return out;
}

export function sortListings<T extends { is_featured?: boolean | null; created_at: string; landed_cost_cents: number }>(rows: readonly T[], sort: CatalogSort): T[] {
  const copy = [...rows];
  const newest = (a: T, b: T) => Date.parse(b.created_at) - Date.parse(a.created_at);
  switch (sort) {
    case 'price_asc': return copy.sort((a, b) => a.landed_cost_cents - b.landed_cost_cents || newest(a, b));
    case 'price_desc': return copy.sort((a, b) => b.landed_cost_cents - a.landed_cost_cents || newest(a, b));
    case 'newest': return copy.sort(newest);
    default: return copy.sort((a, b) => Number(!!b.is_featured) - Number(!!a.is_featured) || newest(a, b));
  }
}
