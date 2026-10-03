'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, ArrowLeft, Info, Loader2, Shirt, Sparkles } from 'lucide-react';
import clsx from 'clsx';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/context/AuthContext';
import { TRIAL_BATCH_MIN_CENTS, formatUSD, friendlyError } from '@/lib/format';
import type { ProductCategory } from '@/lib/types';

export default function NewProductPage() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const supabase = createClient();

  const [category, setCategory] = useState<ProductCategory>('beauty');
  const [title, setTitle] = useState('');
  const [brand, setBrand] = useState('');
  const [description, setDescription] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [trialUnits, setTrialUnits] = useState('');
  const [leadTime, setLeadTime] = useState('10');
  const [variants, setVariants] = useState(''); // shades (beauty) or sizes (clothing)
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unitCents = Math.round(Number(unitPrice) * 100) || 0;
  const units = Number.parseInt(trialUnits, 10) || 0;
  const goodsCents = unitCents * units;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    setError(null);
    if (goodsCents <= 0) return setError('Enter a unit price and trial quantity.');

    setSubmitting(true);
    const list = variants.split(',').map((v) => v.trim()).filter(Boolean);
    const { data, error } = await supabase
      .from('products')
      .insert({
        supplier_id: user.id,
        category,
        title: title.trim(),
        brand: brand.trim() || null,
        description: description.trim() || null,
        origin_country: profile?.country_code ?? 'US',
        attributes: category === 'beauty' ? { shade_range: list } : { sizes: list },
        unit_price_cents: unitCents,
        trial_units: units,
        trial_goods_cents: goodsCents,
        lead_time_days: Number.parseInt(leadTime, 10) || null,
      })
      .select('id')
      .single();
    setSubmitting(false);

    if (error) return setError(friendlyError(error.message));
    router.push(`/supplier/products/${data.id}`);
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <Link href="/supplier" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="h-4 w-4" /> Catalogue</Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">New Trial Batch listing</h1>
      <p className="mt-1 text-sm text-slate-500">Step 1 of 2 — details. Next you&apos;ll upload real photos{category === 'beauty' && ' and a swatch video'}.</p>

      <form onSubmit={submit} className="card mt-6 space-y-5 p-6">
        <div className="grid grid-cols-2 gap-3">
          {([['beauty', 'Beauty & Cosmetics', Sparkles], ['clothing', 'Clothing & Apparel', Shirt]] as const).map(([value, label, Icon]) => (
            <button key={value} type="button" onClick={() => setCategory(value)}
              className={clsx('flex items-center gap-2 rounded-xl border p-3 text-sm font-medium transition',
                category === value ? 'border-brand-700 bg-brand-50 text-brand-900 ring-1 ring-brand-700' : 'border-slate-200 text-slate-600 hover:border-slate-300')}>
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>

        <div>
          <label className="label" htmlFor="title">Product title</label>
          <input id="title" required minLength={3} maxLength={140} className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="brand">Brand</label>
            <input id="brand" className="input" value={brand} onChange={(e) => setBrand(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="variants">{category === 'beauty' ? 'Shades (comma-separated)' : 'Sizes (comma-separated)'}</label>
            <input id="variants" className="input" value={variants} onChange={(e) => setVariants(e.target.value)}
              placeholder={category === 'beauty' ? 'Espresso, Cocoa, Mahogany' : 'S, M, L, XL'} />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="desc">Description</label>
          <textarea id="desc" rows={4} maxLength={5000} className="input" value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder={category === 'beauty' ? 'Key ingredients (INCI), skin types, shelf life, certifications…' : 'Materials, fit, care instructions…'} />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="price">Unit price (USD)</label>
            <input id="price" type="number" min="0.01" step="0.01" required className="input" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="units">Trial units</label>
            <input id="units" type="number" min="1" step="1" required className="input" value={trialUnits} onChange={(e) => setTrialUnits(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="lead">Lead time (days)</label>
            <input id="lead" type="number" min="1" max="120" className="input" value={leadTime} onChange={(e) => setLeadTime(e.target.value)} />
          </div>
        </div>

        <div className="flex items-start gap-2.5 rounded-lg bg-brand-50 px-4 py-3 text-sm text-brand-900 ring-1 ring-brand-100">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Goods value: <strong>{formatUSD(goodsCents, true)}</strong>. Our logistics team adds consolidated freight and customs to
            create the buyer&apos;s Guaranteed Landed Cost (min {formatUSD(TRIAL_BATCH_MIN_CENTS)}). You&apos;re paid the goods value from escrow on verified delivery.
          </p>
        </div>

        {error && <p role="alert" className="flex items-start gap-2 rounded-lg bg-red-50 px-3.5 py-3 text-sm text-red-700"><AlertCircle className="mt-0.5 h-4 w-4" />{error}</p>}

        <button type="submit" disabled={submitting} className="btn-primary w-full">
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />} Save & continue to photos
        </button>
      </form>
    </main>
  );
}
