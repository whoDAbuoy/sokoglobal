'use client';

import { useActionState } from 'react';
import clsx from 'clsx';
import { Loader2, Save } from 'lucide-react';
import { saveCategory, type CategoryState } from '@/app/admin/categories/actions';

export interface CategoryFormValues {
  id?: string; name: string; slug: string; parent_id: string | null; description: string | null; icon: string | null;
  sort_order: number; is_active: boolean; requires_compliance: boolean; legacy_category: string; attribute_schema: unknown;
}

const EXAMPLE = '[{"key":"grade","label":"Grade","type":"select","options":["A","B"],"facet":true},{"key":"harvest_year","label":"Harvest year","type":"number","facet":true}]';

export default function CategoryForm({ value, parents }: { value?: CategoryFormValues; parents: { id: string; label: string }[] }) {
  const [state, action, pending] = useActionState<CategoryState, FormData>(saveCategory, null);
  const v = value;
  const p = v?.id ?? 'new';
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      {v?.id && <input type="hidden" name="id" value={v.id} />}
      <div><label htmlFor={`n-${p}`} className="label">Name</label><input id={`n-${p}`} name="name" required maxLength={80} defaultValue={v?.name} className="input" /></div>
      <div><label htmlFor={`s-${p}`} className="label">Slug (URL)</label><input id={`s-${p}`} name="slug" maxLength={60} defaultValue={v?.slug} placeholder="auto from name" className="input font-mono" /></div>
      <div>
        <label htmlFor={`p-${p}`} className="label">Parent</label>
        <select id={`p-${p}`} name="parent_id" defaultValue={v?.parent_id ?? ''} className="input">
          <option value="">— Top level —</option>
          {parents.filter((x) => x.id !== v?.id).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor={`l-${p}`} className="label">Listing rules</label>
        <select id={`l-${p}`} name="legacy_category" defaultValue={v?.legacy_category ?? 'general'} className="input">
          <option value="general">General commodity</option>
          <option value="beauty">Beauty (swatch video required)</option>
          <option value="clothing">Apparel</option>
        </select>
      </div>
      <div className="sm:col-span-2"><label htmlFor={`d-${p}`} className="label">Description</label><input id={`d-${p}`} name="description" maxLength={500} defaultValue={v?.description ?? ''} className="input" /></div>
      <div><label htmlFor={`i-${p}`} className="label">Icon name (lucide)</label><input id={`i-${p}`} name="icon" maxLength={40} defaultValue={v?.icon ?? ''} placeholder="e.g. sprout" className="input" /></div>
      <div><label htmlFor={`o-${p}`} className="label">Sort order</label><input id={`o-${p}`} name="sort_order" type="number" defaultValue={v?.sort_order ?? 0} className="input" /></div>
      <div className="sm:col-span-2">
        <label htmlFor={`a-${p}`} className="label">Attribute fields (JSON)</label>
        <textarea id={`a-${p}`} name="attribute_schema" rows={4} defaultValue={JSON.stringify(v?.attribute_schema ?? [], null, 0)} className="input font-mono text-xs" placeholder={EXAMPLE} />
        <p className="mt-1 text-xs text-neutral-600">Types: text, number, select, multiselect, list, boolean. Add <code className="font-mono">&quot;facet&quot;:true</code> to make a buyer filter, <code className="font-mono">&quot;required&quot;:true</code> to require it. Children inherit these fields.</p>
      </div>
      <label className="flex items-center gap-2 text-sm text-neutral-800"><input type="checkbox" name="is_active" defaultChecked={v?.is_active ?? true} /> Accepting new listings</label>
      <label className="flex items-center gap-2 text-sm text-neutral-800"><input type="checkbox" name="requires_compliance" defaultChecked={v?.requires_compliance ?? false} /> Regulated (documents checked at review)</label>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button disabled={pending} className="btn-primary px-4 py-2">{pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />} {v?.id ? 'Save' : 'Create category'}</button>
        {state && <p role="status" className={clsx('text-sm', state.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400')}>{state.message}</p>}
      </div>
    </form>
  );
}
