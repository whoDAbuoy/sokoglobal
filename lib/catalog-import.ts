/**
 * Bulk listing import (CSV or Excel → product drafts). Pure: parsing, column
 * mapping and per-row validation. The server action inserts the valid rows as
 * the signed-in supplier, so RLS and column grants still apply.
 */
import { type CategoryRow, type PriceTier, type ProductInsert, parseCustomAttributes, resolveCategory, slugKey, validateListing } from './catalog';

export const IMPORT_MAX_ROWS = 500;
export const IMPORT_MAX_BYTES = 2 * 1024 * 1024;
export const IMPORT_TIERS = 3;

/** Header → canonical column. Unknown headers become custom attributes; "attr:<key>" sets a schema attribute. */
const COLUMN_ALIASES: Record<string, string> = {
  category: 'category', category_slug: 'category', category_path: 'category',
  title: 'title', product: 'title', product_name: 'title', name: 'title',
  brand: 'brand', description: 'description', sku: 'sku',
  unit_price_usd: 'unit_price', unit_price: 'unit_price', price_usd: 'unit_price', price: 'unit_price',
  trial_units: 'trial_units', trial_quantity: 'trial_units',
  moq: 'moq', minimum_order_quantity: 'moq', min_order_qty: 'moq',
  unit_of_measure: 'unit', unit: 'unit', uom: 'unit',
  lead_time_days: 'lead_time', lead_time: 'lead_time',
  origin_country: 'origin', origin: 'origin', country_of_origin: 'origin',
  attributes: 'attributes', other_attributes: 'attributes',
};

export const TEMPLATE_HEADERS = [
  'category', 'title', 'brand', 'sku', 'description', 'unit_price_usd', 'trial_units', 'moq', 'unit_of_measure', 'lead_time_days', 'origin_country',
  'tier1_min_qty', 'tier1_unit_price_usd', 'tier2_min_qty', 'tier2_unit_price_usd', 'tier3_min_qty', 'tier3_unit_price_usd',
  'attr:grade', 'attr:harvest_year', 'attr:packaging', 'attributes',
];

export function templateCsv(): string {
  const rows = [
    TEMPLATE_HEADERS,
    ['vanilla-beans', 'Madagascar Bourbon vanilla, Grade A', 'Sava Spice Co', 'VAN-A-17', 'Gourmet black beans, 16–18 cm, vacuum packed.', '320', '2', '2', 'kg', '21', 'MG',
      '10', '295', '50', '270', '', '', 'Premium / Grade A', '2026', 'Bag / sack', 'bean_length_cm=17; vanillin_pct=2.1; variety=Planifolia (Bourbon)'],
    ['Agriculture > Coffee, Tea & Cocoa', 'Kenya AA washed arabica, green', 'Nyeri Growers', 'KE-AA-60', '60 kg jute bags, SCA 86+.', '9.80', '60', '60', 'kg', '30', 'KE',
      '600', '9.20', '1200', '8.90', '', '', 'Premium / Grade A', '2026', 'Bag / sack', 'process=Washed; cupping_score=86.5'],
  ];
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

const csvCell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** RFC 4180 CSV: quoted fields, escaped quotes, CRLF/LF, BOM, trailing blank lines. Delimiter auto-detected (, ; or tab). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.slice(0, src.search(/\r?\n|$/));
  const delim = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const usdToCents = (v: string): number => {
  const s = v.replace(/[,\s$]/g, '');
  return /^\d{1,8}(\.\d{1,2})?$/.test(s) ? Math.round(Number(s) * 100) : NaN;
};
const intOf = (v: string): number => {
  const s = v.replace(/[,\s]/g, '');
  return /^\d{1,10}$/.test(s) ? Number(s) : NaN;
};

export interface ImportRow { line: number; title: string; value?: ProductInsert; errors: string[] }
export interface ImportResult { rows: ImportRow[]; valid: number; invalid: number; fatal?: string }

/**
 * Maps a parsed table (first row = headers) to validated product drafts.
 * Every row is checked against its category's attribute schema; duplicate SKUs
 * inside the file are flagged before the database sees them.
 */
export function mapImportRows(table: string[][], categories: readonly CategoryRow[], opts: { defaultOrigin: string }): ImportResult {
  if (table.length < 2) return { rows: [], valid: 0, invalid: 0, fatal: 'The file needs a header row and at least one product row.' };
  if (table.length - 1 > IMPORT_MAX_ROWS) return { rows: [], valid: 0, invalid: 0, fatal: `Import up to ${IMPORT_MAX_ROWS} rows at a time (this file has ${table.length - 1}).` };

  const headers = table[0].map((h) => h.trim());
  const cols = headers.map((h) => {
    const lower = h.toLowerCase();
    const attr = lower.match(/^(?:attr|attribute)[:.](.+)$/);
    if (attr) return { kind: 'attr' as const, key: slugKey(attr[1]) };
    const tier = lower.match(/^tier\s*(\d+)[\s_]*(min[\s_]*qty|unit[\s_]*price(?:[\s_]*usd)?)$/);
    if (tier) return { kind: 'tier' as const, n: Number(tier[1]), part: tier[2].startsWith('min') ? 'qty' as const : 'price' as const };
    const canonical = COLUMN_ALIASES[slugKey(lower)];
    if (canonical) return { kind: 'col' as const, key: canonical };
    return { kind: 'attr' as const, key: slugKey(h) };
  });
  if (!cols.some((c) => c.kind === 'col' && c.key === 'title') || !cols.some((c) => c.kind === 'col' && c.key === 'category')) {
    return { rows: [], valid: 0, invalid: 0, fatal: 'Columns "category" and "title" are required. Download the template for the full layout.' };
  }

  const seenSku = new Map<string, number>();
  const rows: ImportRow[] = table.slice(1).map((cells, i) => {
    const line = i + 2;
    const get = (key: string) => (cells[cols.findIndex((c) => c.kind === 'col' && c.key === key)] ?? '').trim();
    const errors: string[] = [];
    const attributes: Record<string, unknown> = { ...parseCustomAttributes(get('attributes')) };
    const tiers = new Map<number, { qty?: string; price?: string }>();
    cols.forEach((c, idx) => {
      const v = (cells[idx] ?? '').trim();
      if (!v) return;
      if (c.kind === 'attr' && c.key) attributes[c.key] = v;
      if (c.kind === 'tier') tiers.set(c.n, { ...tiers.get(c.n), [c.part]: v });
    });

    const priceTiers: PriceTier[] = [];
    for (const [n, t] of [...tiers].sort((a, b) => a[0] - b[0])) {
      if (!t.qty || !t.price) { errors.push(`Tier ${n} needs both a minimum quantity and a unit price.`); continue; }
      const qty = intOf(t.qty), price = usdToCents(t.price);
      if (!Number.isFinite(qty) || !Number.isFinite(price)) { errors.push(`Tier ${n}: use whole quantities and prices like 12.50.`); continue; }
      priceTiers.push({ min_qty: qty, unit_price_cents: price });
    }

    const category = resolveCategory(categories, get('category'));
    if (!category) errors.push(`Unknown category "${get('category') || '(blank)'}". Use a slug such as vanilla-beans or a path like "Agriculture > Spices & Herbs".`);
    const unitPrice = usdToCents(get('unit_price'));
    const trialUnits = intOf(get('trial_units') || get('moq') || '');
    if (!Number.isFinite(unitPrice)) errors.push('unit_price_usd must be a number like 12.50.');
    if (!Number.isFinite(trialUnits)) errors.push('trial_units must be a whole number (or give an moq).');

    const sku = get('sku');
    if (sku) {
      const k = sku.toLowerCase();
      if (seenSku.has(k)) errors.push(`SKU ${sku} is repeated (also on line ${seenSku.get(k)}).`);
      else seenSku.set(k, line);
    }

    let value: ProductInsert | undefined;
    if (category) {
      const v = validateListing({
        categoryId: category.id, title: get('title'), brand: get('brand'), description: get('description'), sku,
        moq: get('moq'), unitOfMeasure: get('unit'), unitPriceCents: Number.isFinite(unitPrice) ? unitPrice : 0,
        trialUnits: Number.isFinite(trialUnits) ? trialUnits : 0, leadTimeDays: get('lead_time'),
        originCountry: get('origin') || opts.defaultOrigin, attributes, priceTiers,
      }, categories);
      if (v.ok) value = v.value;
      else for (const [k, msg] of Object.entries(v.errors)) {
        if ((k === 'unit_price' && !Number.isFinite(unitPrice)) || (k === 'trial_units' && !Number.isFinite(trialUnits))) continue;
        errors.push(msg);
      }
    }
    return { line, title: get('title') || '(untitled)', value: errors.length ? undefined : value, errors };
  });

  const valid = rows.filter((r) => r.value).length;
  return { rows, valid, invalid: rows.length - valid };
}

/** Excel cell → text (dates as YYYY-MM-DD, numbers without float noise). */
export function cellToText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(6)));
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  return String(v);
}
