/**
 * Display currencies (pure). Escrow and every charge stay in USD cents
 * (schema.sql); this only changes how amounts are shown. Rates come from
 * public.exchange_rates (migration 021): rate_to_kes = KES per 1 unit, so KES
 * is the pivot for every conversion.
 */
export const CURRENCIES = ['USD', 'KES', 'NGN', 'ZAR', 'EUR', 'GBP', 'UGX', 'TZS', 'RWF'] as const;
export type CurrencyCode = (typeof CURRENCIES)[number];
/** KES per 1 unit of each currency. */
export type ExchangeRates = Record<CurrencyCode, number>;

export const CURRENCY_COOKIE = 'sg_currency';
/** Escrow currency, and what the site showed before the switcher existed. */
export const DEFAULT_CURRENCY: CurrencyCode = 'USD';

export const CURRENCY_LABEL: Record<CurrencyCode, string> = {
  USD: 'US dollar', KES: 'Kenyan shilling', NGN: 'Nigerian naira', ZAR: 'South African rand', EUR: 'Euro', GBP: 'British pound',
  UGX: 'Ugandan shilling', TZS: 'Tanzanian shilling', RWF: 'Rwandan franc',
};

/** Same starting values as the migration seeds (021, 029); used until the table answers. */
export const FALLBACK_RATES: ExchangeRates = {
  KES: 1, USD: 129.25, NGN: 0.0891, ZAR: 7.39, EUR: 150.0, GBP: 172.0, UGX: 0.0351, TZS: 0.0513, RWF: 0.0935,
};

/** Euro-area members (ISO-3166 alpha-2), plus 'EU' itself. */
const EUROZONE = ['EU', 'AT', 'BE', 'BG', 'HR', 'CY', 'EE', 'FI', 'FR', 'DE', 'GR', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PT', 'SK', 'SI', 'ES'];

/** profiles.country_code → the display currency a visitor from there sees until they pick one. */
export const COUNTRY_CURRENCY: Readonly<Record<string, CurrencyCode>> = {
  KE: 'KES', US: 'USD', NG: 'NGN', ZA: 'ZAR', GB: 'GBP', UG: 'UGX', TZ: 'TZS', RW: 'RWF',
  ...Object.fromEntries(EUROZONE.map((c) => [c, 'EUR' as const])),
};

/** Default display currency for a country; unknown or missing countries get the default (USD). */
export function getDefaultCurrencyForCountry(countryCode?: string | null): CurrencyCode {
  return COUNTRY_CURRENCY[(countryCode ?? '').trim().toUpperCase()] ?? DEFAULT_CURRENCY;
}

export const isCurrency = (v: unknown): v is CurrencyCode => typeof v === 'string' && (CURRENCIES as readonly string[]).includes(v);

/** Cookie / query value → a supported currency (anything else → the default). */
export function parseCurrency(v: unknown): CurrencyCode {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : '';
  return isCurrency(s) ? s : DEFAULT_CURRENCY;
}

/** exchange_rates rows → a complete rate table. Invalid or missing rows fall back to FALLBACK_RATES; KES is always 1. */
export function normalizeRates(rows: unknown): ExchangeRates {
  const rates: ExchangeRates = { ...FALLBACK_RATES };
  if (Array.isArray(rows)) {
    for (const r of rows as { currency_code?: unknown; rate_to_kes?: unknown }[]) {
      const code = typeof r?.currency_code === 'string' ? r.currency_code.trim().toUpperCase() : '';
      const rate = Number(r?.rate_to_kes);
      if (isCurrency(code) && Number.isFinite(rate) && rate > 0) rates[code] = rate;
    }
  }
  rates.KES = 1;
  return rates;
}

/** Amount in KES → amount in `to`. */
export function convertFromKes(amountKes: number, to: CurrencyCode, rates: ExchangeRates): number {
  return amountKes / rates[to];
}

/** USD cents (the escrow ledger) → KES. */
export function kesFromUsdCents(cents: number, rates: ExchangeRates): number {
  return (cents / 100) * rates.USD;
}

const formatters = new Map<string, Intl.NumberFormat>();
function formatter(currency: CurrencyCode, compact: boolean): Intl.NumberFormat {
  const key = `${currency}:${compact}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat('en-US', compact
      ? { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }
      : { style: 'currency', currency });
    formatters.set(key, f);
  }
  return f;
}

/**
 * Render a KES amount in the selected currency, e.g.
 * formatCurrency(12925, 'USD', rates) → "$100.00".
 */
export function formatCurrency(amountInKES: number, selectedCurrency: CurrencyCode, exchangeRates: ExchangeRates, opts: { compact?: boolean } = {}): string {
  const value = convertFromKes(Number.isFinite(amountInKES) ? amountInKES : 0, selectedCurrency, exchangeRates);
  return formatter(selectedCurrency, !!opts.compact).format(value);
}

/**
 * Render a USD-cent amount in the selected currency. USD is formatted straight
 * from cents (no round trip through KES), so it matches what is charged.
 */
export function formatUsdCents(cents: number, selectedCurrency: CurrencyCode, exchangeRates: ExchangeRates, opts: { compact?: boolean } = {}): string {
  if (selectedCurrency === 'USD') return formatter('USD', !!opts.compact).format(cents / 100);
  return formatCurrency(kesFromUsdCents(cents, exchangeRates), selectedCurrency, exchangeRates, opts);
}
