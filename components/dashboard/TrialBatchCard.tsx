'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, BadgeCheck, CheckCircle2, Film, Loader2, Lock, ShieldCheck, Timer } from 'lucide-react';
import type { TrialProductView } from '@/lib/types';
import { countryName, flag, formatUSD } from '@/lib/format';
import ProductVisual from './ProductVisual';

export default function TrialBatchCard({ product }: { product: TrialProductView }) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function startTrial() {
    setState('loading');
    setError(null);
    try {
      const res = await fetch('/api/orders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId: product.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Could not start trial');
      // Hosted Flutterwave checkout; funds land in escrow, not with the supplier.
      if (json.paymentLink) { window.location.assign(json.paymentLink); return; }
      // Order saved but no link (provider hiccup) → order page offers "Pay now".
      router.push(`/dashboard/orders/${json.order.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start trial');
      setState('error');
    }
  }

  const lines = [
    { label: `Product · ${product.trial_units} units`, value: product.goods_cents },
    { label: 'Consolidated air freight', value: product.freight_cents },
    { label: 'Customs clearance & duties', value: product.customs_cents },
  ];

  return (
    <article className="card flex flex-col overflow-hidden">
      <div className="relative">
        <ProductVisual src={product.image_url} alt={product.title} category={product.category} className="aspect-[4/3]" />
        <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
          <span className="rounded-md bg-brand-900 px-2 py-0.5 text-xs font-semibold text-white">$500 Trial Batch</span>
          {product.is_demo && <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Sample</span>}
        </div>
        {product.has_swatch_video && (
          <span className="absolute bottom-3 left-3 inline-flex items-center gap-1 rounded-md bg-slate-900/75 px-2 py-0.5 text-xs font-medium text-white">
            <Film className="h-3.5 w-3.5" /> Swatch video
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-5">
        <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
          {flag(product.origin_country)} {product.supplier_name}
          {product.supplier_verified && (
            <span className="inline-flex items-center gap-0.5 text-brand-700"><BadgeCheck className="h-3.5 w-3.5" />Verified</span>
          )}
        </p>
        <h3 className="mt-1.5 font-semibold leading-snug text-slate-900">{product.title}</h3>

        {/* Guaranteed Landed Cost breakdown — the core trust element */}
        <div className="mt-4 rounded-xl border border-brand-100 bg-brand-50/50 p-4">
          <dl className="space-y-1.5 text-sm">
            {lines.map((l) => (
              <div key={l.label} className="flex justify-between text-slate-600">
                <dt>{l.label}</dt><dd className="tabular-nums">{formatUSD(l.value, true)}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-3 flex items-end justify-between border-t border-brand-100 pt-3">
            <div>
              <p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-brand-800">
                <Lock className="h-3 w-3" /> Guaranteed Landed Cost
              </p>
              <p className="text-xs text-slate-500">Delivered to your door · no surprise fees</p>
            </div>
            <p className="text-2xl font-semibold tabular-nums tracking-tight text-slate-900">{formatUSD(product.landed_cost_cents, true)}</p>
          </div>
        </div>

        <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-500">
          <Timer className="h-3.5 w-3.5" />
          {product.lead_time_days ? `${product.lead_time_days}–${product.lead_time_days + 4} days` : 'Lead time on request'} from {countryName(product.origin_country)}
        </p>

        <div className="mt-auto pt-5">
          {state === 'done' ? (
            <p className="flex items-center justify-center gap-2 rounded-lg bg-emerald-50 py-2.5 text-sm font-medium text-emerald-700 ring-1 ring-emerald-600/20">
              <CheckCircle2 className="h-4 w-4" /> Redirecting to secure checkout…
            </p>
          ) : (
            <button type="button" onClick={() => void startTrial()} disabled={state === 'loading' || product.is_demo}
              className="btn-primary w-full" title={product.is_demo ? 'Sample listing — run supabase/seed.sql to enable' : undefined}>
              {state === 'loading' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              Start trial with escrow
            </button>
          )}
          {error && <p className="mt-2 flex items-start gap-1.5 text-xs text-red-600"><AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />{error}</p>}
        </div>
      </div>
    </article>
  );
}
