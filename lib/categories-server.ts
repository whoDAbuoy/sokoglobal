import 'server-only';
import { unstable_cache, revalidateTag } from 'next/cache';
import { createClient } from '@supabase/supabase-js';
import type { CategoryRow } from '@/lib/catalog';

export const CATEGORIES_TAG = 'categories';

/**
 * The category tree, shared across requests. Categories are public ("categories: everyone reads",
 * migration 015) and change only when an admin saves one, so they are read with the anon key (no
 * cookies, no user) and cached for 5 minutes; saving a category clears the cache at once
 * (revalidateCategories). Errors are thrown, not cached: callers treat them as "catalogue unavailable".
 * Inactive categories are included; callers that only want active ones filter on is_active.
 */
const loadCategories = unstable_cache(async (): Promise<CategoryRow[]> => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Supabase is not configured');
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await db.from('categories')
    .select('id, parent_id, slug, name, description, icon, sort_order, is_active, attribute_schema, legacy_category, requires_compliance')
    .abortSignal(AbortSignal.timeout(3000)).retry(false);
  if (error) throw new Error(error.message);
  return (data ?? []) as CategoryRow[];
}, ['catalog-categories'], { revalidate: 300, tags: [CATEGORIES_TAG] });

/** All categories, or null when they can't be read (table missing before migration 015, or a network error). */
export async function getCategories(): Promise<CategoryRow[] | null> {
  try {
    return await loadCategories();
  } catch (err) {
    console.warn('[categories] unavailable:', err instanceof Error ? err.message : err);
    return null;
  }
}

export function revalidateCategories() {
  revalidateTag(CATEGORIES_TAG);
}
