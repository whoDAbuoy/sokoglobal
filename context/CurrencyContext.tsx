'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '@/context/AuthContext';
import {
  CURRENCY_COOKIE, DEFAULT_CURRENCY, FALLBACK_RATES, formatCurrency, formatUsdCents, getDefaultCurrencyForCountry,
  type CurrencyCode, type ExchangeRates,
} from '@/lib/currency';

interface CurrencyState {
  currency: CurrencyCode;
  rates: ExchangeRates;
  ratesUpdatedAt: string | null;
  /** True once the visitor picked a currency; until then it follows their profile country. */
  pinned: boolean;
  /** The visitor's explicit choice: saved in a cookie and kept across sessions and profile changes. */
  setCurrency: (c: CurrencyCode) => void;
  /** Follow a profile country's default currency, unless the visitor has pinned one. */
  followCountry: (countryCode: string | null | undefined) => void;
  /** USD cents (the escrow ledger) in the selected currency. */
  formatUsd: (cents: number, opts?: { compact?: boolean }) => string;
  /** KES amount (RFQ prices) in the selected currency. */
  formatKes: (amountKes: number, opts?: { compact?: boolean }) => string;
}

const CurrencyContext = createContext<CurrencyState | undefined>(undefined);

/**
 * Display currency for every price on the page. The server reads the same
 * cookie and profile country (lib/currency-server.ts), so the first render
 * already matches and switching needs no reload. Charges are unaffected: they
 * are computed in Postgres from USD.
 */
export function CurrencyProvider({ initialCurrency, pinned: initialPinned, rates, ratesUpdatedAt, children }: {
  initialCurrency: CurrencyCode; pinned: boolean; rates: ExchangeRates; ratesUpdatedAt: string | null; children: ReactNode;
}) {
  const [currency, setState] = useState<CurrencyCode>(initialCurrency);
  const [pinned, setPinned] = useState(initialPinned);

  const setCurrency = useCallback((c: CurrencyCode) => {
    setState(c);
    setPinned(true);
    document.cookie = `${CURRENCY_COOKIE}=${c}; path=/; max-age=31536000; samesite=lax${location.protocol === 'https:' ? '; secure' : ''}`;
  }, []);

  const followCountry = useCallback((countryCode: string | null | undefined) => {
    if (!pinned) setState(getDefaultCurrencyForCountry(countryCode));
  }, [pinned]);

  const value = useMemo<CurrencyState>(() => ({
    currency, pinned, rates, ratesUpdatedAt, setCurrency, followCountry,
    formatUsd: (cents, opts) => formatUsdCents(cents, currency, rates, opts),
    formatKes: (kes, opts) => formatCurrency(kes, currency, rates, opts),
  }), [currency, pinned, rates, ratesUpdatedAt, setCurrency, followCountry]);

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

const FALLBACK: CurrencyState = {
  currency: DEFAULT_CURRENCY, pinned: false, rates: FALLBACK_RATES, ratesUpdatedAt: null,
  setCurrency: () => undefined, followCountry: () => undefined,
  formatUsd: (cents, opts) => formatUsdCents(cents, DEFAULT_CURRENCY, FALLBACK_RATES, opts),
  formatKes: (kes, opts) => formatCurrency(kes, DEFAULT_CURRENCY, FALLBACK_RATES, opts),
};

/** Outside the provider (e.g. global-error) prices render in USD. */
export function useCurrency(): CurrencyState {
  return useContext(CurrencyContext) ?? FALLBACK;
}

/**
 * Keeps an unpinned currency in step with the signed-in profile, so signing in
 * or out (a client-side navigation, no new server render) switches prices to
 * the right country default. Render inside both providers.
 */
export function CurrencyCountrySync() {
  const { profile, loading } = useAuth();
  const { followCountry } = useCurrency();
  const country = profile?.country_code ?? null;
  useEffect(() => {
    if (!loading) followCountry(country);
  }, [loading, country, followCountry]);
  return null;
}
