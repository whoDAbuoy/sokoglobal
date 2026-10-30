'use client';

import { createClient } from '@/lib/supabase/client';

const SEEN_KEY = 'sg-tracked';

/**
 * Records that this buyer viewed (opened Quick View) or saved a listing, for the trending ranking on
 * /dashboard/pools (track_product_interaction, migration 043). Fire-and-forget: never blocks or surfaces
 * an error. The database keeps one row per buyer, listing, kind and day; this also skips repeats within the tab.
 */
export function trackInteraction(productId: string, kind: 'view' | 'save') {
  const key = `${kind}:${productId}`;
  try {
    const seen = new Set<string>(JSON.parse(sessionStorage.getItem(SEEN_KEY) ?? '[]'));
    if (seen.has(key)) return;
    seen.add(key);
    sessionStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-200)));
  } catch { /* storage blocked: the database still de-duplicates per day */ }
  void createClient().rpc('track_product_interaction', { p_product_id: productId, p_kind: kind }).then(() => undefined, () => undefined);
}
