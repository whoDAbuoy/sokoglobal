'use client';

import { useId, useMemo, useState } from 'react';
import clsx from 'clsx';
import { Calculator } from 'lucide-react';
import { DUTY_BANDS, ORIGINS, estimateKenyaLanded, type OriginCode } from '@/lib/landed-estimate';
import { formatUSD } from '@/lib/format';

const toCents = (v: string) => { const n = Number(v.replace(/[^0-9.]/g, '')); return Number.isFinite(n) ? Math.round(n * 100) : 0; };

/**
 * Quick import-cost estimate into Kenya (EAC CET duty bands, IDF, RDL, VAT — lib/landed-estimate.ts).
 * Freight starts from the share seen on live listings from that origin, when there are any; the buyer can
 * overwrite it. Indicative only: Trial Batches already carry a guaranteed landed cost.
 */
export default function LandedCalculator({ freightShare, className }: { freightShare: Record<string, number>; className?: string }) {
  const uid = useId();
  const [origin, setOrigin] = useState<OriginCode>('CN');
  const [goods, setGoods] = useState('5000');
  const [freight, setFreight] = useState<string | null>(null);   // null = follow the suggestion
  const [band, setBand] = useState(0.25);
  const share = freightShare[origin];
  const suggested = share !== undefined ? String(Math.round((toCents(goods) * share) / 100)) : '';
  const freightValue = freight ?? suggested;
  const e = useMemo(() => estimateKenyaLanded({ goodsCents: toCents(goods), freightCents: toCents(freightValue), origin, dutyRate: band }),
    [goods, freightValue, origin, band]);
  const eac = ORIGINS.find((o) => o.code === origin)?.eac;

  const rows: [string, number][] = [
    ['Goods + freight (CIF)', e.cifCents], [eac ? 'Import duty (EAC origin)' : `Import duty (${Math.round(band * 100)} %)`, e.dutyCents],
    ['IDF 3.5 % + RDL 2 %', e.idfCents + e.rdlCents], ['VAT 16 %', e.vatCents],
  ];

  return (
    <section aria-labelledby={`${uid}-t`} className={clsx('sx-card p-5', className)}>
      <h2 id={`${uid}-t`} className="sx-card-title flex items-center gap-2"><Calculator className="h-4 w-4 text-[#8fd3cc]" aria-hidden /> Landed cost estimator</h2>
      <p className="mt-1 text-xs text-neutral-500">Into Kenya · EAC tariff · indicative</p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label htmlFor={`${uid}-o`} className="label">Shipping from</label>
          <select id={`${uid}-o`} className="input" value={origin} onChange={(ev) => { setOrigin(ev.target.value as OriginCode); setFreight(null); }}>
            {ORIGINS.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={`${uid}-g`} className="label">Goods (USD)</label>
          <input id={`${uid}-g`} className="input tabular-nums" inputMode="decimal" value={goods} onChange={(ev) => setGoods(ev.target.value)} />
        </div>
        <div>
          <label htmlFor={`${uid}-f`} className="label">Freight (USD)</label>
          <input id={`${uid}-f`} className="input tabular-nums" inputMode="decimal" value={freightValue} placeholder="0"
            onChange={(ev) => setFreight(ev.target.value)} aria-describedby={share !== undefined ? `${uid}-fh` : undefined} />
        </div>
        {share !== undefined && freight === null && (
          <p id={`${uid}-fh`} className="col-span-2 -mt-1 text-[11px] text-neutral-500">Pre-filled from live listings from this origin ({Math.round(share * 100)} % of goods).</p>
        )}
        <div className="col-span-2">
          <label htmlFor={`${uid}-b`} className="label">Duty band</label>
          <select id={`${uid}-b`} className="input" value={band} onChange={(ev) => setBand(Number(ev.target.value))} disabled={eac}>
            {DUTY_BANDS.map((b) => <option key={b.rate} value={b.rate}>{b.label}</option>)}
          </select>
        </div>
      </div>
      <dl className="mt-4 space-y-1.5 text-sm">
        {rows.map(([l, v]) => (
          <div key={l} className="flex justify-between gap-3 text-neutral-600"><dt>{l}</dt><dd className="tabular-nums text-neutral-900">{formatUSD(v, true)}</dd></div>
        ))}
        <div className="flex items-baseline justify-between gap-3 border-t border-snow/[0.08] pt-2">
          <dt className="font-medium text-neutral-900">Estimated landed</dt>
          <dd className="text-lg font-semibold tabular-nums text-[#8fd3cc]">{formatUSD(e.totalCents, true)}</dd>
        </div>
      </dl>
      <p className="mt-3 text-[11px] leading-snug text-neutral-500">Excise, exemptions and KRA valuation are not included. Trial Batches already show a guaranteed landed cost.</p>
    </section>
  );
}
