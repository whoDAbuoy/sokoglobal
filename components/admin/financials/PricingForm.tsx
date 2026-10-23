'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Save } from 'lucide-react';
import { savePricing } from '@/app/admin/financials/actions';
import { PRICING_BOUNDS, formatRate, isPriceField, pricingToInput, type PlatformPricing, type PricingInput, type PricingKey } from '@/lib/pricing';

const SECTIONS: { id: string; title: string; note: string; fields: { key: PricingKey; help: string }[] }[] = [
  {
    id: 'plans', title: 'Subscription & plan prices',
    note: 'Gold Supplier is bought one month at a time by card. The Gold commission applies to orders placed while a supplier is Gold.',
    fields: [
      { key: 'supplier_gold_monthly_price', help: 'Charged per month (USD).' },
      { key: 'supplier_gold_commission_rate', help: 'Taken from the goods value at payout for Gold suppliers.' },
      { key: 'default_supplier_commission_rate', help: 'Taken from the goods value at payout for everyone else.' },
    ],
  },
  {
    id: 'rfq', title: 'RFQ & service fees',
    note: 'Paid by buyers when they post or promote a request for quote.',
    fields: [
      { key: 'featured_rfq_price', help: 'Pins a request to the top of supplier feeds while it collects quotes.' },
      { key: 'white_glove_sourcing_fee', help: 'Opens a support ticket so the ops team matches vetted factory quotes.' },
    ],
  },
  {
    id: 'margins', title: 'Escrow, FX & logistics margins',
    note: 'Escrow fee and FX spread are paid by buyers at checkout; each order keeps the rates it was placed with.',
    fields: [
      { key: 'escrow_fee_percent', help: 'Added to goods + freight + customs on new orders (not Trend Pools).' },
      { key: 'fx_spread_percent', help: 'Added to the exchange rate on M-Pesa (KES) and non-USD card charges.' },
      { key: 'early_payout_discount_fee', help: 'Taken from the goods value when a supplier takes an instant early payout.' },
      { key: 'logistics_markup_percent', help: 'Added to the carrier freight an admin enters when approving a listing.' },
    ],
  },
];

/** Super-admin pricing editor. Prices in USD, rates as percentages; Postgres validates and audits every save. */
export default function PricingForm({ pricing, updatedAt }: { pricing: PlatformPricing; updatedAt: string | null }) {
  const router = useRouter();
  const initial = pricingToInput(pricing);
  const [values, setValues] = useState<PricingInput>(initial);
  const [errors, setErrors] = useState<Partial<Record<PricingKey, string>>>({});
  const [pending, start] = useTransition();
  const dirty = (Object.keys(values) as PricingKey[]).some((k) => values[k] !== initial[k]);

  const save = () => start(async () => {
    const r = await savePricing(values);
    setErrors(r.errors ?? {});
    (r.ok ? toast.success : toast.error)(r.message);
    if (r.ok) router.refresh();
  });

  return (
    <form onSubmit={(e) => { e.preventDefault(); save(); }} className="space-y-6">
      {SECTIONS.map((s) => (
        <fieldset key={s.id} disabled={pending} className="card p-5">
          <legend className="sr-only">{s.title}</legend>
          <h2 className="font-semibold text-neutral-900">{s.title}</h2>
          <p className="mt-1 text-sm text-neutral-600">{s.note}</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {s.fields.map(({ key, help }) => {
              const price = isPriceField(key);
              const b = PRICING_BOUNDS[key];
              const err = errors[key];
              return (
                <div key={key}>
                  <label htmlFor={`pricing-${key}`} className="label">{b.label} {price ? '($)' : '(%)'}</label>
                  <div className="relative">
                    {price && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-neutral-500">$</span>}
                    <input id={`pricing-${key}`} inputMode="decimal" value={values[key]}
                      onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
                      aria-invalid={!!err || undefined} aria-describedby={`pricing-${key}-help`}
                      className={`input tabular-nums ${price ? 'pl-7' : 'pr-8'}`} />
                    {!price && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-neutral-500">%</span>}
                  </div>
                  <p id={`pricing-${key}-help`} className={`mt-1 text-xs ${err ? 'text-red-600' : 'text-neutral-600'}`}>
                    {err ?? `${help} ${price ? `$${b.min}–$${b.max.toLocaleString('en-US')}` : `${formatRate(b.min)}–${formatRate(b.max)}`}.`}
                  </p>
                </div>
              );
            })}
          </div>
        </fieldset>
      ))}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-neutral-600">
          Changes apply to new orders, charges and listing approvals; nothing already priced changes. Every save is written to the audit log.
          {updatedAt && ` Last change ${new Date(updatedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}.`}
        </p>
        <button type="submit" disabled={pending || !dirty} className="btn-primary px-4 py-2">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />} Save pricing
        </button>
      </div>
    </form>
  );
}
