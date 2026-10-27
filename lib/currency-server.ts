import 'server-only';
import { cookies } from 'next/headers';
import { unstable_cache } from 'next/cache';
import { createClient } from '@supabase/supabase-js';
import { getSessionProfile } from '@/lib/supabase/server';
import {
  CURRENCY_COOKIE, getDefaultCurrencyForCountry, isCurrency, normalizeRates, type CurrencyCode, type ExchangeRates,
} from '@/lib/currency';

export interface CurrencyState {
  currency: CurrencyCode;
  /** True when the visitor picked `currency` in the switcher (cookie); false when it follows their profile country. */
  pinned: boolean;
  rates: ExchangeRates;
  ratesUpdatedAt: string | null;
}

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
  // Capped, no retries: this runs in the root layout, so a slow database must not hold every page (callers fall back to built-in rates).
  const { data, error } = await db.from('exchange_rates').select('currency_code, rate_to_kes, updated_at').abortSignal(AbortSignal.timeout(2000)).retry(false);
  if (error) throw new Error(error.message);
  const updatedAt = (data ?? []).map((r) => r.updated_at as string).sort().at(-1) ?? null;
  return { rows: data ?? [], updatedAt };
}, ['exchange-rates'], { revalidate: 600, tags: ['exchange-rates'] });

/**
 * Signed-in visitor's profiles.country_code, or null (signed out, or the lookup failed).
 * Reads the request's cached session (getSessionProfile), so the root layout and the page
 * share one auth check and one profile read instead of each making their own.
 */
async function profileCountry(): Promise<string | null> {
  try {
    return (await getSessionProfile()).profile?.country_code ?? null;
  } catch {
    return null;
  }
}

/**
 * The visitor's display currency and current rates. Never throws. Precedence:
 * the switcher's cookie, then the signed-in user's profile country, then USD.
 * The country default is not written to the cookie, so it keeps following the
 * profile until the visitor picks a currency themselves.
 */
export async function getCurrencyState(): Promise<CurrencyState> {
  const [store, loaded] = await Promise.all([
    cookies(),
    loadRates().catch((err: unknown) => {
      console.warn('[currency] exchange rates unavailable, using defaults:', err instanceof Error ? err.message : err);
      return { rows: null, updatedAt: null };
    }),
  ]);
  const rates = normalizeRates(loaded.rows);
  const chosen = store.get(CURRENCY_COOKIE)?.value?.trim().toUpperCase();
  if (isCurrency(chosen)) return { currency: chosen, pinned: true, rates, ratesUpdatedAt: loaded.updatedAt };
  // Only signed-in visitors have a profile; skip the auth round trip for everyone else.
  const signedIn = store.getAll().some((c) => c.name.startsWith('sb-') && c.name.includes('-auth-token'));
  const country = signedIn ? await profileCountry() : null;
  return { currency: getDefaultCurrencyForCountry(country), pinned: false, rates, ratesUpdatedAt: loaded.updatedAt };
}
