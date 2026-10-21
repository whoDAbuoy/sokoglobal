'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import { AlertCircle, Info, Loader2, Plus, ShieldAlert, Trash2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { TRIAL_BATCH_MIN_CENTS, formatUSD, friendlyError } from '@/lib/format';
import {
  UNITS, buildCategoryTree, categoryPath, effectiveSchema, requiresCompliance, slugKey, validateListing,
  type AttributeField, type CategoryNode, type CategoryRow, type PriceTier,
} from '@/lib/catalog';

const toCents = (v: string) => {
  const s = v.replace(/[,\s$]/g, '');
  return /^\d{1,8}(\.\d{1,2})?$/.test(s) ? Math.round(Number(s) * 100) : 0;
};

/**
 * Listing form for any commodity: cascading category picker, the category's
 * attribute fields (inherited down the tree), free-form custom attributes,
 * SKU / MOQ / unit and volume price tiers. Validated here with the same rules
 * the database enforces, then inserted as a draft under the supplier's RLS.
 */
export default function NewListingForm({ categories, supplierId, defaultOrigin, minTrialCents = TRIAL_BATCH_MIN_CENTS }: { categories: CategoryRow[]; supplierId: string; defaultOrigin: string; minTrialCents?: number }) {
  const router = useRouter();
  const tree = useMemo(() => buildCategoryTree(categories.filter((c) => c.is_active)), [categories]);
  const [path, setPath] = useState<string[]>([]);              // selected ids, root → leaf
  const categoryId = path[path.length - 1] ?? '';
  const schema = useMemo(() => (categoryId ? effectiveSchema(categories, categoryId) : []), [categories, categoryId]);
  const leafRow = categories.find((c) => c.id === categoryId);

  const [title, setTitle] = useState('');
  const [brand, setBrand] = useState('');
  const [sku, setSku] = useState('');
  const [description, setDescription] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [trialUnits, setTrialUnits] = useState('');
  const [moq, setMoq] = useState('');
  const [unit, setUnit] = useState('unit');
  const [leadTime, setLeadTime] = useState('14');
  const [origin, setOrigin] = useState(defaultOrigin);
  const [attrs, setAttrs] = useState<Record<string, string | string[]>>({});
  const [custom, setCustom] = useState<{ label: string; value: string }[]>([]);
  const [tiers, setTiers] = useState<{ qty: string; price: string }[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const unitCents = toCents(unitPrice);
  const units = Number.parseInt(trialUnits, 10) || 0;
  const goodsCents = unitCents * units;
  const levels: CategoryNode[][] = [tree];
  for (const id of path) {
    const node = levels[levels.length - 1].find((n) => n.id === id);
    if (node?.children.length) levels.push(node.children);
  }

  const choose = (depth: number, id: string) => { setPath([...path.slice(0, depth), ...(id ? [id] : [])]); setErrors({}); };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setServerError(null);
    const priceTiers: PriceTier[] = tiers.filter((t) => t.qty || t.price).map((t) => ({ min_qty: Number.parseInt(t.qty, 10), unit_price_cents: toCents(t.price) }));
    const attributes: Record<string, unknown> = { ...attrs };
    for (const c of custom) if (c.label.trim() && c.value.trim()) attributes[slugKey(c.label)] = c.value.trim();
    const v = validateListing({
      categoryId, title, brand, description, sku, moq, unitOfMeasure: unit, unitPriceCents: unitCents, trialUnits: units,
      leadTimeDays: leadTime, originCountry: origin, attributes, priceTiers,
    }, categories);
    if (!v.ok) { setErrors(v.errors); return; }
    setErrors({});
    setSubmitting(true);
    const { data, error } = await createClient().from('products').insert({ ...v.value, supplier_id: supplierId }).select('id').single();
    setSubmitting(false);
    if (error) return setServerError(/products_supplier_sku_uniq/.test(error.message) ? `You already have a listing with SKU ${v.value.sku}.` : friendlyError(error.message));
    router.push(`/supplier/products/${data.id}`);
  }

  const err = (k: string) => errors[k] && <p className="mt-1 text-xs text-rose-700 dark:text-rose-400">{errors[k]}</p>;

  return (
    <form onSubmit={submit} noValidate className="mt-6 space-y-6">
      <section className="card space-y-4 p-6">
        <h2 className="font-semibold text-neutral-900">Category</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {levels.map((options, depth) => (
            <div key={depth}>
              <label htmlFor={`cat-${depth}`} className="label">{depth === 0 ? 'Sector' : depth === 1 ? 'Category' : 'Sub-category'}</label>
              <select id={`cat-${depth}`} value={path[depth] ?? ''} onChange={(e) => choose(depth, e.target.value)} className="input">
                <option value="">{depth === 0 ? 'Choose a sector…' : 'Any (use the level above)'}</option>
                {options.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
              </select>
            </div>
          ))}
        </div>
        {err('category')}
        {leafRow && (
          <p className="text-xs text-neutral-600">
            {categoryPath(categories, categoryId).map((c) => c.name).join(' › ')}{leafRow.description ? ` — ${leafRow.description}` : ''}
          </p>
        )}
        {categoryId && requiresCompliance(categories, categoryId) && (
          <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm text-amber-900">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            This category is regulated. Have permits, safety data sheets or assay certificates ready; our team checks them before the listing goes live.
            Only legal goods that may be exported from the origin and imported to the buyer&apos;s country can be listed.
          </p>
        )}
      </section>

      <section className="card space-y-4 p-6">
        <h2 className="font-semibold text-neutral-900">Product</h2>
        <div>
          <label className="label" htmlFor="title">Product title</label>
          <input id="title" maxLength={140} className="input" value={title} onChange={(e) => setTitle(e.target.value)} aria-invalid={!!errors.title} />
          {err('title')}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className="label" htmlFor="brand">Brand / producer</label><input id="brand" className="input" value={brand} onChange={(e) => setBrand(e.target.value)} /></div>
          <div><label className="label" htmlFor="sku">SKU</label><input id="sku" className="input font-mono" maxLength={64} value={sku} onChange={(e) => setSku(e.target.value)} placeholder="e.g. VAN-A-17" />{err('sku')}</div>
        </div>
        <div>
          <label className="label" htmlFor="desc">Description</label>
          <textarea id="desc" rows={4} maxLength={5000} className="input" value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder="Specification, origin, certifications, packing, shelf life…" />
          {err('description')}
        </div>
      </section>

      {schema.length > 0 && (
        <section className="card p-6">
          <h2 className="font-semibold text-neutral-900">Specifications</h2>
          <p className="mt-0.5 text-xs text-neutral-600">Buyers filter the catalogue by these. Fields marked * are required for this category.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {schema.map((f) => <AttributeInput key={f.key} field={f} value={attrs[f.key]} error={errors[`attr.${f.key}`]}
              onChange={(v) => setAttrs((a) => ({ ...a, [f.key]: v }))} />)}
          </div>
          <div className="mt-5">
            <p className="label">Other attributes</p>
            {custom.map((c, i) => (
              <div key={i} className="mt-2 flex gap-2">
                <input aria-label={`Attribute ${i + 1} name`} className="input" placeholder="Name, e.g. Grade size" value={c.label}
                  onChange={(e) => setCustom(custom.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                <input aria-label={`Attribute ${i + 1} value`} className="input" placeholder="Value" value={c.value}
                  onChange={(e) => setCustom(custom.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
                <button type="button" onClick={() => setCustom(custom.filter((_, j) => j !== i))} aria-label="Remove attribute" className="btn-secondary px-2.5"><Trash2 className="h-4 w-4" aria-hidden /></button>
              </div>
            ))}
            {Object.entries(errors).filter(([k]) => k.startsWith('attr.') && !schema.some((f) => `attr.${f.key}` === k)).map(([k, m]) => <p key={k} className="mt-1 text-xs text-rose-700 dark:text-rose-400">{m}</p>)}
            {custom.length < 15 && (
              <button type="button" onClick={() => setCustom([...custom, { label: '', value: '' }])} className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:underline dark:text-cyan-300">
                <Plus className="h-4 w-4" aria-hidden /> Add attribute
              </button>
            )}
          </div>
        </section>
      )}

      <section className="card space-y-4 p-6">
        <h2 className="font-semibold text-neutral-900">Pricing &amp; supply</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <div><label className="label" htmlFor="price">Unit price (USD)</label><input id="price" inputMode="decimal" className="input tabular-nums" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} />{err('unit_price')}</div>
          <div>
            <label className="label" htmlFor="uom">Unit of measure</label>
            <input id="uom" list="uom-list" maxLength={24} className="input" value={unit} onChange={(e) => setUnit(e.target.value)} />
            <datalist id="uom-list">{UNITS.map((u) => <option key={u} value={u} />)}</datalist>
            {err('unit_of_measure')}
          </div>
          <div><label className="label" htmlFor="moq">Minimum order (MOQ)</label><input id="moq" inputMode="numeric" className="input tabular-nums" value={moq} onChange={(e) => setMoq(e.target.value)} placeholder="optional" />{err('moq')}</div>
          <div><label className="label" htmlFor="units">Trial batch units</label><input id="units" inputMode="numeric" className="input tabular-nums" value={trialUnits} onChange={(e) => setTrialUnits(e.target.value)} />{err('trial_units')}</div>
          <div><label className="label" htmlFor="lead">Lead time (days)</label><input id="lead" inputMode="numeric" className="input tabular-nums" value={leadTime} onChange={(e) => setLeadTime(e.target.value)} />{err('lead_time')}</div>
          <div><label className="label" htmlFor="origin">Ships from (country code)</label><input id="origin" maxLength={2} className="input uppercase" value={origin} onChange={(e) => setOrigin(e.target.value.toUpperCase())} />{err('origin_country')}</div>
        </div>

        <div>
          <p className="label">Volume price tiers</p>
          <p className="text-xs text-neutral-600">Lower unit prices for larger orders. Each tier starts at a higher quantity and costs no more per unit than the one before.</p>
          {tiers.map((t, i) => (
            <div key={i} className="mt-2 grid grid-cols-[1fr_1fr_auto] gap-2">
              <input aria-label={`Tier ${i + 1} minimum quantity`} inputMode="numeric" className="input tabular-nums" placeholder={`From qty (${unit})`} value={t.qty}
                onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} />
              <input aria-label={`Tier ${i + 1} unit price in USD`} inputMode="decimal" className="input tabular-nums" placeholder="Unit price USD" value={t.price}
                onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} />
              <button type="button" onClick={() => setTiers(tiers.filter((_, j) => j !== i))} aria-label={`Remove tier ${i + 1}`} className="btn-secondary px-2.5"><Trash2 className="h-4 w-4" aria-hidden /></button>
            </div>
          ))}
          {err('price_tiers')}
          {tiers.length < 10 && (
            <button type="button" onClick={() => setTiers([...tiers, { qty: '', price: '' }])} className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:underline dark:text-cyan-300">
              <Plus className="h-4 w-4" aria-hidden /> Add tier
            </button>
          )}
        </div>

        <div className="flex items-start gap-2.5 rounded-lg bg-brand-50 px-4 py-3 text-sm text-brand-900 ring-1 ring-neutral-200">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>
            Trial batch goods value: <strong>{formatUSD(goodsCents, true)}</strong>. Our logistics team adds consolidated freight and customs to
            create the buyer&apos;s Guaranteed Landed Cost (min {formatUSD(minTrialCents)}). You&apos;re paid the goods value from escrow on verified delivery.
          </p>
        </div>
      </section>

      {(serverError || Object.keys(errors).length > 0) && (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-red-50 px-3.5 py-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{serverError ?? `Fix the ${Object.keys(errors).length} highlighted field${Object.keys(errors).length === 1 ? '' : 's'}.`}
        </p>
      )}
      <button type="submit" disabled={submitting} className="btn-primary w-full">
        {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Save draft & continue to photos
      </button>
      {leafRow && categoryPath(categories, categoryId).some((c) => c.legacy_category === 'beauty') && (
        <p className="text-center text-xs text-neutral-600">Beauty listings also need a standardized swatch video before review.</p>
      )}
    </form>
  );
}

function AttributeInput({ field: f, value, error, onChange }: {
  field: AttributeField; value: string | string[] | undefined; error?: string; onChange: (v: string | string[]) => void;
}) {
  const id = `attr-${f.key}`;
  const label = <label htmlFor={id} className="label">{f.label}{f.unit ? ` (${f.unit})` : ''}{f.required ? ' *' : ''}</label>;
  const msg = error && <p className="mt-1 text-xs text-rose-700 dark:text-rose-400">{error}</p>;
  if (f.type === 'multiselect') {
    const picked = Array.isArray(value) ? value : [];
    return (
      <fieldset className="sm:col-span-2">
        <legend className="label">{f.label}{f.required ? ' *' : ''}</legend>
        <div className="flex flex-wrap gap-2">
          {f.options?.map((o) => {
            const on = picked.includes(o);
            return (
              <label key={o} className={clsx('cursor-pointer rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                on ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-300 text-neutral-800 hover:border-neutral-900')}>
                <input type="checkbox" className="sr-only" checked={on} onChange={() => onChange(on ? picked.filter((p) => p !== o) : [...picked, o])} />{o}
              </label>
            );
          })}
        </div>
        {msg}
      </fieldset>
    );
  }
  if (f.type === 'select' || f.type === 'boolean') {
    const options = f.type === 'boolean' ? ['Yes', 'No'] : f.options ?? [];
    return (
      <div>{label}
        <select id={id} className="input" value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} aria-invalid={!!error}>
          <option value="">—</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>{msg}
      </div>
    );
  }
  return (
    <div>{label}
      <input id={id} className="input" inputMode={f.type === 'number' ? 'decimal' : undefined} aria-invalid={!!error}
        placeholder={f.type === 'list' ? 'Comma-separated' : undefined} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} />{msg}
    </div>
  );
}
