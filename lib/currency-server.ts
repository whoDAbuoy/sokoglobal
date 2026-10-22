import 'server-only';
import { cookies } from 'next/headers';
import { unstable_cache } from 'next/cache';
import { createClient } from '@supabase/supabase-js';
import { CURRENCY_COOKIE, normalizeRates, parseCurrency, type CurrencyCode, type ExchangeRates } from '@/lib/currency';

export interface CurrencyState { currency: CurrencyCode; rates: ExchangeRates; ratesUpdatedAt: string | null }

/**
 * exchange_rates is public and changes rarely, so it is read with the anon key
 * (no cookies, no user) and cached for 10 minutes across requests. Errors are
 * thrown, not cached; callers fall back to the built-in rates.
 */
const loadRates = unstable_cache(async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Supabase is not configured');
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await db.from('exchange_rates').select('currency_code, rate_to_kes, updated_at');
  if (error) throw new Error(error.message);
  const updatedAt = (data ?? []).map((r) => r.updated_at as string).sort().at(-1) ?? null;
  return { rows: data ?? [], updatedAt };
}, ['exchange-rates'], { revalidate: 600, tags: ['exchange-rates'] });

/** The visitor's display currency (cookie) and current rates. Never throws. */
export async function getCurrencyState(): Promise<CurrencyState> {
  const [store, loaded] = await Promise.all([
    cookies(),
    loadRates().catch((err: unknown) => {
      console.warn('[currency] exchange rates unavailable, using defaults:', err instanceof Error ? err.message : err);
      return { rows: null, updatedAt: null };
    }),
  ]);
  return { currency: parseCurrency(store.get(CURRENCY_COOKIE)?.value), rates: normalizeRates(loaded.rows), ratesUpdatedAt: loaded.updatedAt };
}
