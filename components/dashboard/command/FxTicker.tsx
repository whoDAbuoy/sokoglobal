'use client';

import clsx from 'clsx';
import { ArrowRightLeft } from 'lucide-react';
import { useCurrency } from '@/context/CurrencyContext';
import type { CurrencyCode } from '@/lib/currency';

/** Pairs shown against the Kenyan shilling (rates are KES per one unit, from the platform's rate table). */
const PAIRS: CurrencyCode[] = ['USD', 'EUR', 'GBP', 'ZAR', 'NGN', 'UGX', 'TZS'];
const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: n >= 100 ? 2 : n >= 1 ? 3 : 4 });

/**
 * Indicative FX: each currency → KES from the same rate table the price switcher uses (exchange_rates,
 * migrations 021 / 029). Display only; escrow is always charged in USD.
 */
export default function FxTicker({ className }: { className?: string }) {
  const { rates, ratesUpdatedAt, currency } = useCurrency();
  const updated = ratesUpdatedAt ? new Date(ratesUpdatedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi' }) + ' EAT' : null;
  return (
    <section aria-labelledby="fx-title" className={clsx('sx-card p-5', className)}>
      <div className="sx-card-head">
        <h2 id="fx-title" className="sx-card-title flex items-center gap-2"><ArrowRightLeft className="h-4 w-4 text-[#8fd3cc]" aria-hidden /> FX rates</h2>
        <span className="sx-pill sx-pill-muted">Indicative</span>
      </div>
      <ul className="mt-4 divide-y divide-snow/[0.06]">
        {PAIRS.map((c) => (
          <li key={c} className={clsx('flex items-center justify-between py-2 text-sm', c === currency && 'text-[#8fd3cc]')}>
            <span className="font-medium">{c} <span className="text-neutral-500">→ KES</span></span>
            <span className="tabular-nums text-neutral-900">{fmt(rates[c])}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-neutral-500">{updated ? `Updated ${updated}` : 'Platform reference rates'} · escrow is charged in USD</p>
    </section>
  );
}
