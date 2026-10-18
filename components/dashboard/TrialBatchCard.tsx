'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, BadgeCheck, CheckCircle2, Eye, Film, Loader2, Lock, ShieldCheck, Smartphone, Timer } from 'lucide-react';
import type { TrialProductView } from '@/lib/types';
import { countryName, flag, formatUSD } from '@/lib/format';
import ProductGallery from './ProductGallery';
import ProductQuickView from './ProductQuickView';

const MPESA_ENABLED = process.env.NEXT_PUBLIC_MPESA_ENABLED === 'true';

export default function TrialBatchCard({ product }: { product: TrialProductView }) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [method, setMethod] = useState<'card' | 'mpesa'>('card');
  const [error, setError] = useState<string | null>(null);
  const [quickView, setQuickView] = useState(false);

  async function startTrial(pay: 'card' | 'mpesa') {
    setState('loading');
    setMethod(pay);
    setError(null);
    try {
      const res = await fetch('/api/orders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId: product.id, method: pay }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Could not start trial');
      // M-Pesa: the order page collects the phone number and sends the STK prompt.
      if (pay === 'mpesa') { router.push(`/dashboard/orders/${json.order.id}?pay=mpesa`); return; }
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
  const images = product.image_urls?.length ? product.image_urls : product.image_url ? [product.image_url] : [];

  // Payment block — rendered in the card and in the Quick View, so both use the same checkout handlers and state.
  const actions = (
    <>
      {state === 'done' ? (
        <p className="flex items-center justify-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 py-2.5 text-sm font-medium text-emerald-700">
          <CheckCircle2 className="h-4 w-4" /> Redirecting to secure checkout…
        </p>
      ) : (
        <div className="space-y-2">
          {/* M-Pesa is the primary method when enabled; card checkout is the fallback. */}
          {MPESA_ENABLED && (
            <button type="button" onClick={() => void startTrial('mpesa')} disabled={state === 'loading' || product.is_demo}
              className="btn-primary w-full bg-emerald-600 hover:bg-emerald-700" title={product.is_demo ? 'Sample listing — run supabase/seed.sql to enable' : undefined}>
              {state === 'loading' && method === 'mpesa' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Smartphone className="h-4 w-4" />}
              Pay with M-Pesa
            </button>
          )}
          <button type="button" onClick={() => void startTrial('card')} disabled={state === 'loading' || product.is_demo}
            className={`${MPESA_ENABLED ? 'btn-secondary' : 'btn-primary'} w-full`} title={product.is_demo ? 'Sample listing — run supabase/seed.sql to enable' : undefined}>
            {state === 'loading' && method === 'card' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            {MPESA_ENABLED ? 'Pay by card / bank' : 'Start trial with escrow'}
          </button>
        </div>
      )}
      {error && <p className="mt-2 flex items-start gap-1.5 text-xs text-red-600"><AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />{error}</p>}
    </>
  );

  return (
    <article className="group flex flex-col">
      {/* Clicking the photos opens the Quick View; swiping scrolls the gallery (touch swipes don't produce clicks). */}
      <div className="relative cursor-pointer overflow-hidden rounded-lg" onClick={() => setQuickView(true)}>
        <ProductGallery images={images} alt={product.title} category={product.category} className="aspect-square" arrows="hover" />
        <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-1.5">
          <span className="pill border-transparent bg-white/95 text-neutral-900">$500 Trial Batch</span>
          {product.is_demo && <span className="pill border-amber-200 bg-amber-50 text-amber-800">Sample</span>}
        </div>
        {product.has_swatch_video && (
          <span className="pill pointer-events-none absolute bottom-3 left-3 border-transparent bg-neutral-900/80 text-white">
            <Film className="h-3.5 w-3.5" /> Swatch video
          </span>
        )}
        <button type="button" onClick={(e) => { e.stopPropagation(); setQuickView(true); }}
          className="pill absolute right-3 top-3 border-transparent bg-white/95 text-neutral-900 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
          <Eye className="h-3.5 w-3.5" /> Quick view
        </button>
      </div>

      <div className="flex flex-1 flex-col pt-4">
        <p className="flex items-center gap-1.5 text-xs text-neutral-500">
          {flag(product.origin_country)} {product.supplier_name}
          {product.supplier_verified && (
            <span className="inline-flex items-center gap-0.5 text-emerald-700"><BadgeCheck className="h-3.5 w-3.5" />Verified</span>
          )}
        </p>
        <h3 className="mt-1 text-base font-medium leading-snug text-neutral-900">
          <button type="button" onClick={() => setQuickView(true)} className="text-left underline-offset-4 hover:underline focus:outline-none focus-visible:underline">
            {product.title}
          </button>
        </h3>

        {/* Guaranteed Landed Cost breakdown — the core trust element */}
        <div className="mt-4 border-t border-neutral-200 pt-3">
          <dl className="space-y-1 text-sm">
            {lines.map((l) => (
              <div key={l.label} className="flex justify-between text-neutral-500">
                <dt>{l.label}</dt><dd className="tabular-nums">{formatUSD(l.value, true)}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-2.5 flex items-center justify-between border-t border-dashed border-neutral-200 pt-2.5">
            <div>
              <p className="flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-neutral-900">
                <Lock className="h-3 w-3" /> Guaranteed Landed Cost
              </p>
              <p className="text-xs text-neutral-500">Delivered to your door · no surprise fees</p>
            </div>
            <p className="text-lg font-semibold tabular-nums text-neutral-900">{formatUSD(product.landed_cost_cents, true)}</p>
          </div>
        </div>

        <p className="mt-3 flex items-center gap-1.5 text-xs text-neutral-500">
          <Timer className="h-3.5 w-3.5" />
          {product.lead_time_days ? `${product.lead_time_days}–${product.lead_time_days + 4} days` : 'Lead time on request'} from {countryName(product.origin_country)}
        </p>

        <div className="mt-auto pt-5">{actions}</div>
      </div>

      {quickView && <ProductQuickView product={product} onClose={() => setQuickView(false)} actions={actions} />}
    </article>
  );
}
