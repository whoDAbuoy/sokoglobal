'use client';

import { useId, useState } from 'react';
import { Megaphone, Sparkles, X } from 'lucide-react';
import { formatUSD } from '@/lib/format';
import { RFQ_ADDON_LABEL, type RfqAddon } from '@/lib/pricing';
import BankCardPanel from '@/components/payments/BankCardPanel';

export interface AddonPrices { featured: number; white_glove: number }

export const ADDON_HINT: Record<RfqAddon, string> = {
  featured: 'Pinned to the top of supplier feeds while your request collects quotes.',
  white_glove: 'Our sourcing team matches vetted factories and gets quotes for you.',
};
const ICON = { featured: Megaphone, white_glove: Sparkles } as const;

/**
 * Pay for RFQ add-ons by card. Prices are display copies of platform_settings;
 * POST /api/rfqs/:id/addons → begin_card_purchase() prices the charge in Postgres,
 * and the request is only featured / flagged once Paystack confirms it.
 */
export function AddonCheckout({ rfqId, available, prices, initial, defaultName, onClose }: {
  rfqId: string; available: readonly RfqAddon[]; prices: AddonPrices; initial?: readonly RfqAddon[]; defaultName?: string; onClose?: () => void;
}) {
  const uid = useId();
  const [chosen, setChosen] = useState<RfqAddon[]>(available.filter((a) => (initial ?? available).includes(a)));
  const total = chosen.reduce((n, a) => n + prices[a], 0);
  if (!available.length) return null;

  return (
    <div className="space-y-3 rounded-lg border border-neutral-200 p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold text-neutral-900">Boost this request</p>
        {onClose && <button type="button" onClick={onClose} aria-label="Close add-ons" className="text-neutral-500 hover:text-neutral-900"><X className="h-4 w-4" /></button>}
      </div>
      <fieldset className="space-y-2">
        <legend className="sr-only">Add-ons</legend>
        {available.map((a) => {
          const Icon = ICON[a];
          return (
            <label key={a} htmlFor={`${uid}-${a}`} className="flex cursor-pointer items-start gap-3 rounded-md border border-neutral-200 p-3 text-sm hover:border-neutral-400">
              <input id={`${uid}-${a}`} type="checkbox" checked={chosen.includes(a)} className="mt-0.5"
                onChange={(e) => setChosen((c) => (e.target.checked ? [...c, a] : c.filter((x) => x !== a)))} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2 font-medium text-neutral-900">
                  <span className="inline-flex items-center gap-1.5"><Icon className="h-4 w-4 text-neutral-500" aria-hidden />{RFQ_ADDON_LABEL[a]}</span>
                  <span className="tabular-nums">{formatUSD(prices[a], true)}</span>
                </span>
                <span className="mt-0.5 block text-xs text-neutral-600">{ADDON_HINT[a]}</span>
              </span>
            </label>
          );
        })}
      </fieldset>
      {chosen.length > 0
        ? <BankCardPanel endpoint={`/api/rfqs/${rfqId}/addons`} extraBody={{ addons: chosen }} amountLabel={formatUSD(total, true)}
            returnPath="/dashboard/rfqs" defaultName={defaultName} />
        : <p className="text-xs text-neutral-600">Choose at least one add-on.</p>}
    </div>
  );
}

/** "Promote" action on a live request the buyer owns. */
export default function RfqAddOnsButton(props: { rfqId: string; available: readonly RfqAddon[]; prices: AddonPrices; defaultName?: string }) {
  const [open, setOpen] = useState(false);
  if (!props.available.length) return null;
  return open
    ? <div className="w-full"><AddonCheckout {...props} onClose={() => setOpen(false)} /></div>
    : <button type="button" onClick={() => setOpen(true)} className="btn-secondary px-3 py-1.5 text-sm"><Megaphone className="h-3.5 w-3.5" aria-hidden /> Promote</button>;
}
