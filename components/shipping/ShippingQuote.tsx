'use client';

import { useId, useState, useTransition } from 'react';
import clsx from 'clsx';
import { AlertCircle, Loader2, PackageSearch, Plane, ShieldCheck, Truck } from 'lucide-react';
import { countryName, formatUSD } from '@/lib/format';
import type { ShippingComparison } from '@/lib/shipping/dhl';

type Option = 'standard' | 'dhl';
const money = (cents: number, currency: string) => (currency === 'USD' ? formatUSD(cents, true)
  : new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(cents / 100));
const day = (iso: string | null) => (iso && !Number.isNaN(Date.parse(iso)) ? new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : null);

/**
 * Shipping options at checkout: SokoGlobal's consolidated logistics (what this checkout charges —
 * the Guaranteed Landed Cost) and a live DHL Express Air estimate to compare. Choosing DHL only
 * switches the breakdown shown here; payment always uses the guaranteed total from Postgres.
 */
export default function ShippingQuote({ target, destinationCountry, suggestedWeightKg, guaranteed, configured, className }: {
  target: { kind: 'group' | 'order'; id: string };
  destinationCountry: string;
  suggestedWeightKg: number | null;
  guaranteed: { goods: number; freight: number; customs: number; escrowFee: number };
  /** DHL credentials are set on the server. */
  configured: boolean;
  className?: string;
}) {
  const uid = useId();
  const [option, setOption] = useState<Option>('standard');
  const [form, setForm] = useState({ destinationCity: '', destinationPostalCode: '', weightKg: String(suggestedWeightKg ?? 10), lengthCm: '40', widthCm: '30', heightCm: '30' });
  const [result, setResult] = useState<ShippingComparison | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const quote = () => start(async () => {
    setError(null); setErrors({});
    const res = await fetch('/api/shipping/rates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...target, ...form }) })
      .catch(() => null);
    const json = await res?.json().catch(() => null) as (ShippingComparison & { error?: string; errors?: Record<string, string> }) | null;
    if (!res || !json) { setError('Could not reach the quote service. Check your connection.'); return; }
    if (json.errors) { setErrors(json.errors); return; }
    if (!res.ok) { setError(json.error ?? 'DHL could not quote this shipment.'); return; }
    setResult(json);
  });

  const totals = result?.totals;
  const usd = totals?.currency === 'USD';
  const dutiesKnown = totals && totals.dutiesCents !== null && totals.taxesCents !== null;
  const field = (k: keyof typeof form, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div>
      <label htmlFor={`${uid}-${k}`} className="label text-[11px]">{label}</label>
      <input id={`${uid}-${k}`} value={form[k]} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} disabled={pending}
        aria-invalid={!!errors[k] || undefined} className="input py-1.5 text-sm" {...props} />
      {errors[k] && <p className="mt-1 text-[11px] text-red-600">{errors[k]}</p>}
    </div>
  );

  return (
    <section aria-labelledby={`${uid}-title`} className={clsx('glass-card p-5 sm:p-6', className)}>
      <h2 id={`${uid}-title`} className="eyebrow">Shipping</h2>
      <div role="radiogroup" aria-label="Shipping option" className="segmented mt-3">
        {([['standard', 'Standard logistics', Truck], ['dhl', 'DHL Express Air', Plane]] as const).map(([v, label, Icon]) => (
          <button key={v} type="button" role="radio" aria-checked={option === v} onClick={() => setOption(v)} className="segment flex-1 py-1.5 text-xs">
            <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
          </button>
        ))}
      </div>

      {option === 'standard' ? (
        <dl className="mt-4 space-y-2 text-sm text-neutral-600">
          <Row label="Goods value" value={formatUSD(guaranteed.goods, true)} />
          <Row label="Consolidated air freight" value={formatUSD(guaranteed.freight, true)} />
          <Row label="Customs duties & taxes" value={formatUSD(guaranteed.customs, true)} />
          {guaranteed.escrowFee > 0 && <Row label="Escrow protection fee" value={formatUSD(guaranteed.escrowFee, true)} />}
          <Row strong label="Guaranteed landed cost" value={formatUSD(guaranteed.goods + guaranteed.freight + guaranteed.customs + guaranteed.escrowFee, true)} />
          <p className="flex items-start gap-1.5 pt-1 text-xs text-neutral-500"><ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden /> Fixed price, door to door. This is what you pay.</p>
        </dl>
      ) : !configured ? (
        <p className="mt-4 rounded-2xl border px-3 py-3 text-sm tone-muted">Live DHL Express quotes aren&apos;t switched on yet. Your order ships with standard logistics at the guaranteed price.</p>
      ) : (
        <div className="mt-4 space-y-3">
          <form onSubmit={(e) => { e.preventDefault(); quote(); }} className="grid grid-cols-2 gap-2.5">
            <div className="col-span-2">{field('destinationCity', `Delivery city (${countryName(destinationCountry)})`, { autoComplete: 'address-level2', placeholder: 'e.g. Nairobi' })}</div>
            {field('destinationPostalCode', 'Postal code (optional)', { autoComplete: 'postal-code' })}
            {field('weightKg', 'Total weight (kg)', { inputMode: 'decimal' })}
            <div className="col-span-2 grid grid-cols-3 gap-2">
              {field('lengthCm', 'L (cm)', { inputMode: 'numeric' })}
              {field('widthCm', 'W (cm)', { inputMode: 'numeric' })}
              {field('heightCm', 'H (cm)', { inputMode: 'numeric' })}
            </div>
            <button type="submit" disabled={pending} className="btn-primary col-span-2 rounded-full py-2 text-sm">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <PackageSearch className="h-4 w-4" aria-hidden />} {result ? 'Update DHL quote' : 'Get DHL quote'}
            </button>
          </form>
          {error && <p role="alert" className="flex items-start gap-1.5 text-sm text-red-600"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{error}</p>}

          {result?.groups && totals && (
            <div aria-live="polite" className="glass-inset space-y-2 p-3 text-sm text-neutral-600">
              {result.groups.map((g) => (
                <p key={g.originCountry} className="text-xs text-neutral-500">
                  {g.productName} from {g.originCity}, {countryName(g.originCountry)}: <span className="font-medium tabular-nums text-neutral-900">{money(g.freightCents, g.currency)}</span>
                  {g.transitDays !== null && ` · ${g.transitDays} day${g.transitDays === 1 ? '' : 's'}`}
                  {day(g.estimatedDelivery) && ` · by ${day(g.estimatedDelivery)}`}
                </p>
              ))}
              <dl className="space-y-2 border-t border-black/[0.06] pt-2 dark:border-snow/[0.08]">
                <Row label="Goods value" value={formatUSD(guaranteed.goods, true)} />
                <Row label="DHL Express freight" value={totals.currency ? money(totals.freightCents, totals.currency) : 'See each shipment above'} />
                <Row label="Duties & import taxes" value={dutiesKnown && totals.currency ? money(totals.dutiesCents! + totals.taxesCents!, totals.currency) : 'Not estimated'} />
                {usd && dutiesKnown && (
                  <Row strong label="Estimated total" value={formatUSD(guaranteed.goods + totals.freightCents + totals.dutiesCents! + totals.taxesCents! + guaranteed.escrowFee, true)} />
                )}
              </dl>
              {!dutiesKnown && <p className="text-xs text-neutral-500">DHL needs a customs (HS) code on the listing to estimate duties; budget about {formatUSD(guaranteed.customs, true)} as in our guaranteed price.</p>}
            </div>
          )}
          <p className="text-xs text-neutral-500">
            An estimate to compare carriers. This checkout ships with standard logistics and charges the guaranteed landed cost.
          </p>
        </div>
      )}
    </section>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={clsx('flex justify-between gap-3', strong && 'border-t border-black/[0.06] pt-2 font-medium text-neutral-900 dark:border-snow/[0.08]')}>
      <dt>{label}</dt><dd className="text-right tabular-nums text-neutral-900">{value}</dd>
    </div>
  );
}
