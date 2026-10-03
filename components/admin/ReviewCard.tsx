'use client';

import { useActionState, useState } from 'react';
import Image from 'next/image';
import clsx from 'clsx';
import {
  AlertTriangle, BadgeCheck, CheckCircle2, Clock, Film, Loader2, Lock, Shirt, Sparkles, Undo2,
} from 'lucide-react';
import { approveProduct, rejectProduct, type ReviewState } from '@/app/admin/actions';
import { TRIAL_BATCH_MIN_CENTS, countryName, flag, formatUSD } from '@/lib/format';
import type { MediaType, ProductCategory } from '@/lib/types';

export interface PendingProduct {
  id: string;
  title: string;
  brand: string | null;
  category: ProductCategory;
  description: string | null;
  origin_country: string;
  attributes: Record<string, unknown>;
  unit_price_cents: number;
  trial_units: number;
  trial_goods_cents: number;
  lead_time_days: number | null;
  updated_at: string;
  supplier: { company_name: string; full_name: string; country_code: string; kyc_verified: boolean } | null;
  media: { id: string; media_type: MediaType; public_url: string; captured_at: string | null; width: number | null; height: number | null }[];
}

const toCents = (v: string) => {
  const n = Number.parseFloat(v.replace(/,/g, ''));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : 0;
};

function hoursSince(iso: string) {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000));
}

export default function ReviewCard({ product }: { product: PendingProduct }) {
  const [approveState, approveAction, approving] = useActionState<ReviewState, FormData>(approveProduct, null);
  const [rejectState, rejectAction, rejecting] = useActionState<ReviewState, FormData>(rejectProduct, null);
  const [freight, setFreight] = useState('');
  const [customs, setCustoms] = useState('');

  const images = product.media.filter((m) => m.media_type === 'image');
  const videos = product.media.filter((m) => m.media_type === 'swatch_video');
  const [active, setActive] = useState(images[0]?.id ?? null);
  const activeImage = images.find((i) => i.id === active) ?? images[0];

  const landed = product.trial_goods_cents + toCents(freight) + toCents(customs);
  const meetsMinimum = landed >= TRIAL_BATCH_MIN_CENTS;
  const quoted = freight.trim() !== '' && customs.trim() !== '';
  const waited = hoursSince(product.updated_at);
  const busy = approving || rejecting;
  const state = rejectState ?? approveState;

  const warnings = [
    !product.supplier?.kyc_verified && 'Supplier has not passed KYC verification.',
    images.length < 3 && `Only ${images.length} photo(s) — 3 required.`,
    product.category === 'beauty' && videos.length === 0 && 'Beauty product without a swatch video.',
  ].filter(Boolean) as string[];

  const variants = (product.attributes.shade_range ?? product.attributes.sizes) as string[] | string | undefined;
  const CategoryIcon = product.category === 'beauty' ? Sparkles : Shirt;

  return (
    <article className="card overflow-hidden">
      <div className="grid lg:grid-cols-[22rem_1fr_20rem]">
        {/* Visual proof */}
        <div className="border-b border-slate-100 bg-slate-50 p-4 lg:border-b-0 lg:border-r">
          <div className="relative aspect-square overflow-hidden rounded-xl bg-slate-200">
            {activeImage ? (
              <Image src={activeImage.public_url} alt={product.title} fill sizes="352px" className="object-cover" />
            ) : (
              <div className="grid h-full place-items-center text-sm text-slate-500">No photos uploaded</div>
            )}
          </div>
          {activeImage && (
            <p className="mt-2 text-[11px] text-slate-500">
              {activeImage.width}×{activeImage.height}px · captured{' '}
              {activeImage.captured_at ? new Date(activeImage.captured_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'unknown'}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {images.map((img) => (
              <button key={img.id} type="button" onClick={() => setActive(img.id)} aria-label="Show photo"
                className={clsx('relative h-14 w-14 overflow-hidden rounded-lg ring-2', img.id === activeImage?.id ? 'ring-brand-700' : 'ring-transparent hover:ring-slate-300')}>
                <Image src={img.public_url} alt="" fill sizes="56px" className="object-cover" />
              </button>
            ))}
          </div>
          {videos.map((v) => (
            <div key={v.id} className="mt-3">
              <p className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-600"><Film className="h-3.5 w-3.5" /> Swatch video</p>
              <video src={v.public_url} controls preload="metadata" className="w-full rounded-lg bg-black" />
            </div>
          ))}
        </div>

        {/* Product & supplier details */}
        <div className="p-5">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 font-medium capitalize text-slate-700">
              <CategoryIcon className="h-3.5 w-3.5" /> {product.category}
            </span>
            <span className={clsx('inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-medium',
              waited >= 24 ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-600')}>
              <Clock className="h-3.5 w-3.5" /> Waiting {waited < 1 ? '<1' : waited}h
            </span>
          </div>
          <h3 className="mt-2 text-lg font-semibold text-slate-900">{product.title}</h3>
          {product.brand && <p className="text-sm text-slate-500">{product.brand}</p>}

          <div className="mt-3 flex items-center gap-2 text-sm text-slate-700">
            <span>{flag(product.supplier?.country_code ?? product.origin_country)}</span>
            <span className="font-medium">{product.supplier?.company_name ?? 'Unknown supplier'}</span>
            {product.supplier?.kyc_verified
              ? <span className="inline-flex items-center gap-0.5 text-xs text-brand-700"><BadgeCheck className="h-3.5 w-3.5" /> KYC verified</span>
              : <span className="text-xs text-amber-700">KYC pending</span>}
          </div>

          {product.description && <p className="mt-3 line-clamp-4 text-sm leading-relaxed text-slate-600">{product.description}</p>}

          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
            <Detail label="Unit price" value={formatUSD(product.unit_price_cents, true)} />
            <Detail label="Trial units" value={String(product.trial_units)} />
            <Detail label="Goods value" value={formatUSD(product.trial_goods_cents, true)} />
            <Detail label="Ships from" value={countryName(product.origin_country)} />
            <Detail label="Lead time" value={product.lead_time_days ? `${product.lead_time_days} days` : '—'} />
            <Detail label={product.category === 'beauty' ? 'Shades' : 'Sizes'}
              value={Array.isArray(variants) ? variants.join(', ') || '—' : variants ?? '—'} />
          </dl>

          {warnings.length > 0 && (
            <ul className="mt-4 space-y-1.5 rounded-lg bg-amber-50 p-3 text-xs text-amber-800 ring-1 ring-amber-600/20">
              {warnings.map((w) => <li key={w} className="flex items-start gap-1.5"><AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />{w}</li>)}
            </ul>
          )}
        </div>

        {/* Quote & decision */}
        <form className="flex flex-col border-t border-slate-100 bg-white p-5 lg:border-l lg:border-t-0">
          <input type="hidden" name="productId" value={product.id} />
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Logistics quote</p>

          <MoneyInput id={`freight-${product.id}`} name="freight" label="Consolidated air freight" value={freight} onChange={setFreight} />
          <MoneyInput id={`customs-${product.id}`} name="customs" label="Customs clearance & duties" value={customs} onChange={setCustoms} />

          <div className={clsx('mt-4 rounded-xl p-3 ring-1', meetsMinimum ? 'bg-brand-50/60 ring-brand-100' : 'bg-red-50 ring-red-200')}>
            <dl className="space-y-1 text-xs text-slate-600">
              <div className="flex justify-between"><dt>Goods</dt><dd className="tabular-nums">{formatUSD(product.trial_goods_cents, true)}</dd></div>
              <div className="flex justify-between"><dt>Freight</dt><dd className="tabular-nums">{formatUSD(toCents(freight), true)}</dd></div>
              <div className="flex justify-between"><dt>Customs</dt><dd className="tabular-nums">{formatUSD(toCents(customs), true)}</dd></div>
            </dl>
            <div className="mt-2 flex items-end justify-between border-t border-slate-200/70 pt-2">
              <span className="flex items-center gap-1 text-[11px] font-semibold uppercase text-brand-800"><Lock className="h-3 w-3" /> Landed cost</span>
              <span className="text-lg font-semibold tabular-nums text-slate-900">{formatUSD(landed, true)}</span>
            </div>
            {!meetsMinimum && quoted && (
              <p className="mt-1 text-[11px] text-red-700">Below the {formatUSD(TRIAL_BATCH_MIN_CENTS)} Trial Batch minimum.</p>
            )}
          </div>

          <label htmlFor={`notes-${product.id}`} className="label mt-4 text-xs">Notes (required to send back)</label>
          <textarea id={`notes-${product.id}`} name="notes" rows={2} maxLength={2000} className="input text-xs"
            placeholder="e.g. Quote valid 30 days. / Please re-shoot photos in daylight." />

          {state && (
            <p role="status" className={clsx('mt-3 flex items-start gap-1.5 text-xs', state.ok ? 'text-emerald-700' : 'text-red-600')}>
              {state.ok ? <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0" /> : <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />}
              {state.message}
            </p>
          )}

          <div className="mt-auto flex gap-2 pt-4">
            <button formAction={rejectAction} disabled={busy} className="btn-secondary flex-1 px-3">
              {rejecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />} Send back
            </button>
            <button formAction={approveAction} disabled={busy || !quoted || !meetsMinimum} className="btn-primary flex-1 px-3">
              {approving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Approve & go live
            </button>
          </div>
        </form>
      </div>
    </article>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="truncate font-medium text-slate-900">{value}</dd>
    </div>
  );
}

function MoneyInput({ id, name, label, value, onChange }: {
  id: string; name: string; label: string; value: string; onChange: (v: string) => void;
}) {
  return (
    <div className="mt-3">
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-slate-700">{label}</label>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">$</span>
        <input id={id} name={name} inputMode="decimal" required pattern="^\d{1,6}(\.\d{1,2})?$" placeholder="0.00"
          value={value} onChange={(e) => onChange(e.target.value)} className="input py-2 pl-7 tabular-nums" />
      </div>
    </div>
  );
}
