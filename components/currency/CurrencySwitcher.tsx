'use client';

import { useId } from 'react';
import { ChevronDown, Coins } from 'lucide-react';
import { useCurrency } from '@/context/CurrencyContext';
import { CURRENCIES, CURRENCY_LABEL, parseCurrency } from '@/lib/currency';

/** Header display-currency picker (KES · USD · UGX · TZS · RWF). Prices switch instantly; charges do not change. */
export default function CurrencySwitcher() {
  const { currency, setCurrency, ratesUpdatedAt } = useCurrency();
  const id = useId();
  const asOf = ratesUpdatedAt ? new Date(ratesUpdatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : null;
  return (
    <div className="relative mr-0.5 sm:mr-1">
      <label htmlFor={id} className="sr-only">Display currency</label>
      <Coins className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" strokeWidth={1.75} aria-hidden />
      <select id={id} value={currency} onChange={(e) => setCurrency(parseCurrency(e.target.value))}
        title={`Show prices in another currency${asOf ? ` (rates as of ${asOf})` : ''}. You are always charged the escrow amount.`}
        className="h-8 cursor-pointer appearance-none rounded-md border border-neutral-300 bg-transparent py-1 pl-7 pr-6 text-sm font-medium text-neutral-900 transition-colors hover:border-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
        {CURRENCIES.map((c) => <option key={c} value={c} aria-label={`${c}, ${CURRENCY_LABEL[c]}`}>{c}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-500" aria-hidden />
    </div>
  );
}
