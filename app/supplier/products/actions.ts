'use server';

import { revalidatePath } from 'next/cache';
import { getSessionProfile } from '@/lib/supabase/server';
import { friendlyError } from '@/lib/format';
import type { CategoryRow, ProductInsert } from '@/lib/catalog';
import { IMPORT_MAX_BYTES, cellToText, mapImportRows, parseCsv, type ImportRow } from '@/lib/catalog-import';

export type ImportState = {
  ok: boolean;
  message: string;
  mode?: 'preview' | 'commit';
  rows?: { line: number; title: string; errors: string[]; ok: boolean }[];
  created?: number;
} | null;

const CATEGORY_COLUMNS = 'id, parent_id, slug, name, description, icon, sort_order, is_active, attribute_schema, legacy_category, requires_compliance';

async function readTable(file: File): Promise<string[][]> {
  const name = file.name.toLowerCase();
  const buf = Buffer.from(await file.arrayBuffer());
  if (name.endsWith('.xlsx')) {
    const { readSheet } = await import('read-excel-file/node');
    const sheet = await readSheet(buf);
    return sheet.map((row) => row.map(cellToText)).filter((r) => r.some((c) => c.trim() !== ''));
  }
  return parseCsv(buf.toString('utf8'));
}

/**
 * Bulk import listings from CSV / Excel. "preview" validates every row;
 * "commit" inserts the valid rows as drafts. Inserts run with the supplier's own
 * session, so RLS (supplier_id = auth.uid(), status = draft) and the column
 * grants apply exactly as for the single-listing form.
 */
export async function importListings(_prev: ImportState, form: FormData): Promise<ImportState> {
  const { supabase, user, profile } = await getSessionProfile();
  if (!user || profile?.role !== 'supplier') return { ok: false, message: 'Supplier account required.' };
  const mode = form.get('mode') === 'commit' ? 'commit' : 'preview';
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: 'Choose a CSV or Excel (.xlsx) file.' };
  if (file.size > IMPORT_MAX_BYTES) return { ok: false, message: 'Files are limited to 2 MB (about 500 rows).' };
  if (!/\.(csv|txt|xlsx)$/i.test(file.name)) return { ok: false, message: 'Use a .csv or .xlsx file. Older .xls files: save as .xlsx first.' };

  const { data: categories, error: catError } = await supabase.from('categories').select(CATEGORY_COLUMNS);
  if (catError) return { ok: false, message: 'The multi-category catalogue is not set up yet (migration 015).' };

  let table: string[][];
  try { table = await readTable(file); } catch (e) {
    return { ok: false, message: `Could not read the file: ${e instanceof Error ? e.message : 'unknown format'}.` };
  }
  const result = mapImportRows(table, (categories ?? []) as CategoryRow[], { defaultOrigin: profile.country_code });
  if (result.fatal) return { ok: false, message: result.fatal };

  const summary = (rows: ImportRow[]) => rows.map((r) => ({ line: r.line, title: r.title, errors: r.errors, ok: r.errors.length === 0 }));
  if (mode === 'preview') {
    return {
      ok: result.valid > 0, mode, rows: summary(result.rows),
      message: `${result.valid} of ${result.rows.length} rows are ready${result.invalid ? `; fix ${result.invalid} row${result.invalid === 1 ? '' : 's'} or import the valid ones` : ''}.`,
    };
  }

  const valid = result.rows.filter((r): r is ImportRow & { value: ProductInsert } => !!r.value);
  let created = 0;
  for (let i = 0; i < valid.length; i += 50) {
    const chunk = valid.slice(i, i + 50);
    const { error } = await supabase.from('products').insert(chunk.map((r) => ({ ...r.value, supplier_id: user.id })));
    if (!error) { created += chunk.length; continue; }
    // One bad row (e.g. a SKU you already use) fails the batch — retry row by row to pin it down.
    for (const r of chunk) {
      const { error: rowError } = await supabase.from('products').insert({ ...r.value, supplier_id: user.id });
      if (rowError) r.errors.push(/products_supplier_sku_uniq/.test(rowError.message) ? `You already have a listing with SKU ${r.value.sku}.` : friendlyError(rowError.message));
      else created += 1;
    }
  }
  revalidatePath('/supplier');
  return {
    ok: created > 0, mode, created, rows: summary(result.rows),
    message: created ? `Created ${created} draft listing${created === 1 ? '' : 's'}. Add at least 3 photos to each, then submit for review.` : 'No listings were created.',
  };
}
