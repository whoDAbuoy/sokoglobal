import 'server-only';
import { cache } from 'react';
import { z } from 'zod';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { UUID_RE } from '@/lib/uploads';

/**
 * Reads for the public listing / supplier pages and the sitemap (migration 036). They use the anon
 * key with no cookies: the data is identical for every visitor (signed in or not) and comes only from
 * the public_* functions, which expose public columns of live listings and suppliers in good standing.
 * Rows are validated before use; a row that doesn't match is treated as missing, never half-rendered.
 */
let anonClient: SupabaseClient | undefined;
function db(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Supabase is not configured');
  anonClient ??= createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  return anonClient;
}

// numeric columns arrive as numbers or strings depending on size; nulls stay null.
const num = z.union([z.number(), z.string()]).transform(Number).pipe(z.number().finite());

const listingRow = z.object({
  id: z.string(), title: z.string(), brand: z.string().nullable(), description: z.string().nullable(),
  category: z.string(), category_id: z.string().nullable(), category_name: z.string().nullable(),
  origin_country: z.string(), attributes: z.record(z.string(), z.unknown()).nullable().transform((a) => a ?? {}),
  trial_units: z.number().int(), moq: z.number().int().nullable(), unit_of_measure: z.string().nullable(),
  unit_price_cents: z.number().int(), landed_cost_cents: z.number().int(), lead_time_days: z.number().int().nullable(),
  images: z.array(z.string()).nullable().transform((a) => a ?? []),
  created_at: z.string(), updated_at: z.string(),
  supplier_id: z.string(), supplier_company: z.string(), supplier_country: z.string(),
  supplier_verified: z.boolean(), supplier_gold: z.boolean(), supplier_avatar_url: z.string().nullable(),
  rating_average: num.nullable(), rating_count: z.number().int(),
});
export type PublicListing = z.infer<typeof listingRow>;

const supplierRow = z.object({
  id: z.string(), company_name: z.string(), country_code: z.string(), kyc_verified: z.boolean(), gold: z.boolean(),
  avatar_url: z.string().nullable(), bio: z.string().nullable(), created_at: z.string(), updated_at: z.string(),
  rating_average: num.nullable(), rating_count: z.number().int(), live_listings: z.number().int(),
});
export type PublicSupplier = z.infer<typeof supplierRow>;

const cardRow = z.object({
  id: z.string(), title: z.string(), origin_country: z.string(), landed_cost_cents: z.number().int(), trial_units: z.number().int(),
  image_url: z.string().nullable(), supplier_id: z.string(), supplier_company: z.string(), supplier_verified: z.boolean(), created_at: z.string(),
});
export type PublicListingCard = z.infer<typeof cardRow>;

// "name" arrives with migration 038; before it, URLs fall back to the bare id (which redirects to the readable one).
const sitemapRow = z.object({ kind: z.enum(['product', 'supplier']), id: z.string(), last_modified: z.string(), name: z.string().nullish() });
export type SitemapEntry = z.infer<typeof sitemapRow>;

function first<T>(schema: z.ZodType<T>, data: unknown, label: string): T | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (row == null) return null;
  const parsed = schema.safeParse(row);
  if (!parsed.success) { console.error(`[public-catalog] unexpected ${label} row`, z.prettifyError(parsed.error)); return null; }
  return parsed.data;
}
function all<T>(schema: z.ZodType<T>, data: unknown, label: string): T[] {
  return (Array.isArray(data) ? data : []).flatMap((r) => {
    const parsed = schema.safeParse(r);
    if (!parsed.success) { console.error(`[public-catalog] skipped ${label} row`, z.prettifyError(parsed.error)); return []; }
    return [parsed.data];
  });
}

/** A live listing, or null (not found, not public, invalid id). Cached per request: metadata and page share it. */
export const getPublicListing = cache(async (id: string): Promise<PublicListing | null> => {
  if (!UUID_RE.test(id)) return null;
  const { data, error } = await db().rpc('public_listing', { p_id: id });
  if (error) throw new Error(`Could not load listing: ${error.message}`);
  return first(listingRow, data, 'listing');
});

export const getPublicSupplier = cache(async (id: string): Promise<PublicSupplier | null> => {
  if (!UUID_RE.test(id)) return null;
  const { data, error } = await db().rpc('public_supplier', { p_id: id });
  if (error) throw new Error(`Could not load supplier: ${error.message}`);
  return first(supplierRow, data, 'supplier');
});

/** Listing cards for a supplier or a category (newest first, at most 48). Errors → empty (secondary content). */
export async function getPublicListings(opts: { supplierId?: string; categoryId?: string; excludeId?: string; limit?: number }): Promise<PublicListingCard[]> {
  if (!opts.supplierId && !opts.categoryId) return [];
  const { data, error } = await db().rpc('public_listings', {
    p_supplier_id: opts.supplierId ?? null, p_category_id: opts.categoryId ?? null, p_exclude_id: opts.excludeId ?? null, p_limit: opts.limit ?? 12,
  });
  if (error) { console.error('[public-catalog] listings unavailable', error.message); return []; }
  return all(cardRow, data, 'listing card');
}

/** Every public listing and supplier, for the sitemap. Errors are thrown so a broken sitemap isn't cached as empty. */
export async function getSitemapEntries(): Promise<SitemapEntry[]> {
  const { data, error } = await db().rpc('public_sitemap_entries', { p_limit: 45_000 });
  if (error) throw new Error(`Could not build the sitemap: ${error.message}`);
  return all(sitemapRow, data, 'sitemap');
}

export const BROWSE_PAGE_SIZE = 24;
const browseRow = cardRow.extend({ total: z.number().int() });

/** One page of the public catalogue, newest first (migration 038). Errors are thrown: this is the page's main content. */
export async function getBrowseListings(page: number): Promise<{ listings: PublicListingCard[]; total: number }> {
  const offset = (Math.max(1, Math.floor(page)) - 1) * BROWSE_PAGE_SIZE;
  const { data, error } = await db().rpc('public_browse_listings', { p_limit: BROWSE_PAGE_SIZE, p_offset: offset });
  if (error) throw new Error(`Could not load the catalogue: ${error.message}`);
  const rows = all(browseRow, data, 'browse');
  return { listings: rows.map(({ total: _total, ...card }) => card), total: rows[0]?.total ?? 0 };
}
