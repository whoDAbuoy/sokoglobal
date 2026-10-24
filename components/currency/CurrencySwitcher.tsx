'use client';

import { useId } from 'react';
import { ChevronDown, Coins } from 'lucide-react';
import { useCurrency } from '@/context/CurrencyContext';
import { CURRENCIES, CURRENCY_LABEL, parseCurrency } from '@/lib/currency';

/**
 * Header display-currency picker. Until the visitor picks one it shows their
 * profile country's currency. Prices switch instantly; charges do not change.
 */
export default function CurrencySwitcher() {
  const { currency, pinned, setCurrency, ratesUpdatedAt } = useCurrency();
  const id = useId();
  const asOf = ratesUpdatedAt ? new Date(ratesUpdatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : null;
  return (
    <div className="relative shrink-0">
      <label htmlFor={id} className="sr-only">Display currency</label>
      <Coins className="pointer-events-none absolute left-2.5 top-1/2 hidden h-4 w-4 sm:block -translate-y-1/2 text-neutral-500" strokeWidth={1.75} aria-hidden />
      <select id={id} value={currency} onChange={(e) => setCurrency(parseCurrency(e.target.value))}
        title={`${pinned ? 'Show prices in another currency' : 'Prices follow your country; pick a currency to change them'}${asOf ? ` (rates as of ${asOf})` : ''}. You are always charged the escrow amount.`}
        className="nav-chip cursor-pointer appearance-none pl-3 pr-7 sm:pl-8 tabular-nums [&>option]:bg-white [&>option]:text-neutral-900">
        {CURRENCIES.map((c) => <option key={c} value={c} aria-label={`${c}, ${CURRENCY_LABEL[c]}`}>{c}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-500" aria-hidden />
    </div>
  );
}
