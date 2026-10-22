'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import {
  CURRENCY_COOKIE, DEFAULT_CURRENCY, FALLBACK_RATES, formatCurrency, formatUsdCents, type CurrencyCode, type ExchangeRates,
} from '@/lib/currency';

interface CurrencyState {
  currency: CurrencyCode;
  rates: ExchangeRates;
  ratesUpdatedAt: string | null;
  setCurrency: (c: CurrencyCode) => void;
  /** USD cents (the escrow ledger) in the selected currency. */
  formatUsd: (cents: number, opts?: { compact?: boolean }) => string;
  /** KES amount (RFQ prices) in the selected currency. */
  formatKes: (amountKes: number, opts?: { compact?: boolean }) => string;
}

const CurrencyContext = createContext<CurrencyState | undefined>(undefined);

/**
 * Display currency for every price on the page. The server reads the same
 * cookie (lib/currency-server.ts), so the first render already matches and
 * switching needs no reload. Charges are unaffected: they are computed in
 * Postgres from USD.
 */
export function CurrencyProvider({ initialCurrency, rates, ratesUpdatedAt, children }: {
  initialCurrency: CurrencyCode; rates: ExchangeRates; ratesUpdatedAt: string | null; children: ReactNode;
}) {
  const [currency, setState] = useState<CurrencyCode>(initialCurrency);

  const setCurrency = useCallback((c: CurrencyCode) => {
    setState(c);
    document.cookie = `${CURRENCY_COOKIE}=${c}; path=/; max-age=31536000; samesite=lax${location.protocol === 'https:' ? '; secure' : ''}`;
  }, []);

  const value = useMemo<CurrencyState>(() => ({
    currency, rates, ratesUpdatedAt, setCurrency,
    formatUsd: (cents, opts) => formatUsdCents(cents, currency, rates, opts),
    formatKes: (kes, opts) => formatCurrency(kes, currency, rates, opts),
  }), [currency, rates, ratesUpdatedAt, setCurrency]);

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

const FALLBACK: CurrencyState = {
  currency: DEFAULT_CURRENCY, rates: FALLBACK_RATES, ratesUpdatedAt: null, setCurrency: () => undefined,
  formatUsd: (cents, opts) => formatUsdCents(cents, DEFAULT_CURRENCY, FALLBACK_RATES, opts),
  formatKes: (kes, opts) => formatCurrency(kes, DEFAULT_CURRENCY, FALLBACK_RATES, opts),
};

/** Outside the provider (e.g. global-error) prices render in USD. */
export function useCurrency(): CurrencyState {
  return useContext(CurrencyContext) ?? FALLBACK;
}
