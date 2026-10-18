'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { BadgeCheck, Film, Lock, ShieldCheck, Timer, X } from 'lucide-react';
import type { TrialProductView } from '@/lib/types';
import { countryName, flag, formatUSD } from '@/lib/format';
import { lineTotals } from '@/lib/cart';
import ProductGallery from './ProductGallery';

const EXIT_MS = 160;   // matches the fade-out / scale-out animations

/**
 * Saleor-style Quick View for a Trial Batch. Native <dialog> (focus trap, Esc,
 * top layer), portalled to <body> so hover styles of the card underneath don't
 * leak in. Adds backdrop-click close, enter/exit animation and a background
 * scroll lock that compensates for the scrollbar so the page doesn't shift.
 *
 * `actions` is the card's own payment block, so the modal triggers exactly the
 * same M-Pesa / card checkout handlers as the card.
 */
export default function ProductQuickView({ product, quantity = 1, onClose, actions }: {
  product: TrialProductView;
  /** Trial Batches selected on the card; the breakdown is shown for this many. */
  quantity?: number;
  onClose: () => void;
  actions: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [closing, setClosing] = useState(false);
  const images = product.image_urls?.length ? product.image_urls : product.image_url ? [product.image_url] : [];

  const requestClose = useCallback(() => {
    if (closing) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setClosing(true);
    window.setTimeout(() => { dialogRef.current?.close(); onClose(); }, reduce ? 0 : EXIT_MS);
  }, [closing, onClose]);

  // Open on mount.
  useEffect(() => {
    const d = dialogRef.current;
    if (d && !d.open) d.showModal();
  }, []);

  // Lock background scroll while open; restore the exact previous styles on close.
  useEffect(() => {
    const html = document.documentElement;
    const prev = { overflow: html.style.overflow, paddingRight: html.style.paddingRight };
    const gap = window.innerWidth - html.clientWidth;
    html.style.overflow = 'hidden';
    if (gap > 0) html.style.paddingRight = `${gap}px`;
    return () => { html.style.overflow = prev.overflow; html.style.paddingRight = prev.paddingRight; };
  }, []);

  const totals = lineTotals({
    goods_cents: product.goods_cents, freight_cents: product.freight_cents, customs_cents: product.customs_cents,
    landed_cost_cents: product.landed_cost_cents, trial_units: product.trial_units,
  }, quantity);
  const lines = [
    { label: `Product · ${totals.units} units`, value: totals.goods_cents },
    { label: 'Consolidated air freight', value: totals.freight_cents },
    { label: 'Customs clearance & duties', value: totals.customs_cents },
  ];

  return createPortal(
    <dialog ref={dialogRef} aria-labelledby={`qv-title-${product.id}`}
      onCancel={(e) => { e.preventDefault(); requestClose(); }}
      onClick={(e) => { if (e.target === e.currentTarget) requestClose(); }}
      className={clsx(
        'm-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-4xl overflow-hidden rounded-lg border border-neutral-200 bg-white p-0 shadow-overlay',
        'backdrop:bg-neutral-950/50 backdrop:backdrop-blur-[2px]',
        closing ? 'motion-safe:animate-scale-out backdrop:motion-safe:animate-fade-out'
          : 'motion-safe:animate-scale-in backdrop:motion-safe:animate-fade-in',
      )}>
      <div className="relative grid max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain md:grid-cols-2 md:overflow-hidden">
        <button type="button" onClick={requestClose} aria-label="Close quick view"
          className="absolute right-3 top-3 z-10 grid h-9 w-9 place-items-center rounded-full bg-white/90 text-neutral-900 ring-1 ring-black/5 backdrop-blur transition hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900">
          <X className="h-4 w-4" />
        </button>

        {/* Gallery */}
        <div className="group relative bg-neutral-100 md:min-h-[32rem]">
          <ProductGallery images={images} media={product.media} alt={product.title} category={product.category} className="aspect-square md:aspect-auto md:h-full" arrows />
          {product.has_swatch_video && (
            <span className="pill pointer-events-none absolute left-3 top-3 border-transparent bg-neutral-900/80 text-white">
              <Film className="h-3.5 w-3.5" /> Swatch video
            </span>
          )}
        </div>

        {/* Details */}
        <div className="flex flex-col p-6 sm:p-8 md:max-h-[calc(100dvh-2rem)] md:overflow-y-auto">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="pill">$500 Trial Batch</span>
            {product.is_demo && <span className="pill border-amber-200 bg-amber-50 text-amber-800">Sample</span>}
          </div>
          <h2 id={`qv-title-${product.id}`} className="mt-4 pr-8 text-2xl font-semibold leading-tight text-neutral-900">{product.title}</h2>
          {product.brand && <p className="mt-1 text-sm text-neutral-500">{product.brand}</p>}

          <dl className="mt-5 grid grid-cols-2 gap-4 border-y border-neutral-200 py-4 text-sm">
            <div>
              <dt className="eyebrow">Supplier</dt>
              <dd className="mt-1 flex items-center gap-1.5 font-medium text-neutral-900">
                {product.supplier_name}
                {product.supplier_verified && <BadgeCheck className="h-4 w-4 text-emerald-600" aria-label="KYC verified" />}
              </dd>
            </div>
            <div>
              <dt className="eyebrow">Ships from</dt>
              <dd className="mt-1 font-medium text-neutral-900">{flag(product.origin_country)} {countryName(product.origin_country)}</dd>
            </div>
            <div>
              <dt className="eyebrow">Unit price</dt>
              <dd className="mt-1 font-medium tabular-nums text-neutral-900">{formatUSD(product.unit_price_cents, true)}</dd>
            </div>
            <div>
              <dt className="eyebrow">Lead time</dt>
              <dd className="mt-1 flex items-center gap-1 font-medium text-neutral-900">
                <Timer className="h-3.5 w-3.5 text-neutral-400" />
                {product.lead_time_days ? `${product.lead_time_days}–${product.lead_time_days + 4} days` : 'On request'}
              </dd>
            </div>
          </dl>

          {/* Guaranteed Landed Cost breakdown */}
          <section className="mt-5 rounded-lg border border-neutral-200 bg-neutral-50 p-5" aria-label="Guaranteed Landed Cost">
            <dl className="space-y-2 text-sm">
              {lines.map((l) => (
                <div key={l.label} className="flex justify-between text-neutral-600">
                  <dt>{l.label}</dt><dd className="tabular-nums text-neutral-900">{formatUSD(l.value, true)}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-3 flex items-end justify-between border-t border-neutral-200 pt-3">
              <div>
                <p className="flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-neutral-900">
                  <Lock className="h-3 w-3" /> Guaranteed Landed Cost
                </p>
                <p className="text-xs text-neutral-500">Delivered to your door · no surprise fees</p>
              </div>
              <p className="text-right text-2xl font-semibold tabular-nums text-neutral-900">
                {formatUSD(totals.landed_cost_cents, true)}
                {totals.quantity > 1 && <span className="block text-xs font-normal text-neutral-500">{totals.quantity} × {formatUSD(product.landed_cost_cents, true)}</span>}
              </p>
            </div>
          </section>

          <div className="mt-6">{actions}</div>
          <p className="mt-4 flex items-center gap-1.5 text-xs text-neutral-500">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" /> Paid into escrow — released to the supplier only after you verify the goods.
          </p>
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
