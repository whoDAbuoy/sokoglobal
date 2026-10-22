'use client';

import { startTransition, useActionState, useEffect, useId, useRef } from 'react';
import { toast } from 'sonner';
import { AlertCircle, Loader2, Send } from 'lucide-react';
import { createRfq, type RfqFormState } from '@/app/dashboard/rfqs/actions';
import { useCurrency } from '@/context/CurrencyContext';

export interface RfqPrefill { title?: string; quantity?: number; categoryId?: string | null; productId?: string | null; unitOfMeasure?: string | null }

/** Buyer's request for a custom volume quote. Target price is per unit, in KES. */
export default function RfqForm({ categories, prefill = {}, disabledReason }: {
  categories: { id: string; label: string }[]; prefill?: RfqPrefill; disabledReason?: string | null;
}) {
  const uid = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const { currency } = useCurrency();
  const [state, action, pending] = useActionState<RfqFormState, FormData>(createRfq, null);

  useEffect(() => {
    if (state?.ok) { toast.success(state.message); formRef.current?.reset(); }
  }, [state]);

  const err = (k: string) => state?.errors?.[k];
  const a11y = (k: string) => ({ 'aria-invalid': !!err(k) || undefined, 'aria-describedby': err(k) ? `${uid}-${k}-err` : undefined });
  const msg = (k: string) => err(k) && <p id={`${uid}-${k}-err`} className="mt-1 text-xs text-red-600">{err(k)}</p>;

  return (
    <form ref={formRef} className="card space-y-4 p-5"
      onSubmit={(e) => { e.preventDefault(); const data = new FormData(e.currentTarget); startTransition(() => action(data)); }}>
      <div>
        <h2 className="text-base font-semibold text-neutral-900">New request for quote</h2>
        <p className="mt-0.5 text-sm text-neutral-600">Verified suppliers in the category send private quotes. You choose one — or none.</p>
      </div>
      {disabledReason && <p className="rounded-md border px-3 py-2 text-sm tone-pending">{disabledReason}</p>}

      <fieldset disabled={!!disabledReason || pending} className="space-y-4">
        <input type="hidden" name="productId" value={prefill.productId ?? ''} />
        <div>
          <label htmlFor={`${uid}-title`} className="label">What do you need?</label>
          <input id={`${uid}-title`} name="title" required minLength={3} maxLength={140} defaultValue={prefill.title ?? ''}
            placeholder="e.g. 5,000 plain cotton T-shirts" className="input" {...a11y('title')} />
          {msg('title')}
        </div>
        <div>
          <label htmlFor={`${uid}-desc`} className="label">Specifications</label>
          <textarea id={`${uid}-desc`} name="description" required minLength={10} maxLength={4000} rows={4}
            placeholder="Grade, sizes or shades, packaging, certifications, delivery deadline…" className="input" {...a11y('description')} />
          {msg('description')}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={`${uid}-qty`} className="label">Quantity</label>
            <input id={`${uid}-qty`} name="quantity" required inputMode="numeric" pattern="[0-9,]+" defaultValue={prefill.quantity ? String(prefill.quantity) : ''}
              className="input tabular-nums" {...a11y('quantity')} />
            {msg('quantity')}
          </div>
          <div>
            <label htmlFor={`${uid}-unit`} className="label">Unit <span className="font-normal text-neutral-500">(optional)</span></label>
            <input id={`${uid}-unit`} name="unitOfMeasure" maxLength={24} defaultValue={prefill.unitOfMeasure ?? ''} placeholder="pieces, kg, cartons" className="input" {...a11y('unitOfMeasure')} />
            {msg('unitOfMeasure')}
          </div>
          <div>
            <label htmlFor={`${uid}-target`} className="label">Target price per unit, KES <span className="font-normal text-neutral-500">(optional)</span></label>
            <input id={`${uid}-target`} name="targetPriceKes" inputMode="decimal" pattern="[0-9,]+(\.[0-9]{1,2})?" placeholder="e.g. 410" className="input tabular-nums" {...a11y('targetPriceKes')} />
            {currency !== 'KES' && <p className="mt-1 text-xs text-neutral-500">Suppliers quote in KES; you&apos;ll see quotes in {currency} too.</p>}
            {msg('targetPriceKes')}
          </div>
          <div>
            <label htmlFor={`${uid}-dest`} className="label">Deliver to</label>
            <input id={`${uid}-dest`} name="deliveryLocation" required minLength={2} maxLength={160} placeholder="Town, country" className="input" {...a11y('deliveryLocation')} />
            {msg('deliveryLocation')}
          </div>
          <div>
            <label htmlFor={`${uid}-cat`} className="label">Category</label>
            <select id={`${uid}-cat`} name="categoryId" defaultValue={prefill.categoryId ?? ''} className="input" {...a11y('categoryId')}>
              <option value="">Any category</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
            {msg('categoryId')}
          </div>
          <div>
            <label htmlFor={`${uid}-exp`} className="label">Collect quotes for</label>
            <select id={`${uid}-exp`} name="expiresInDays" defaultValue="14" className="input" {...a11y('expiresInDays')}>
              {[3, 7, 14, 30, 60].map((d) => <option key={d} value={d}>{d} days</option>)}
            </select>
            {msg('expiresInDays')}
          </div>
        </div>
      </fieldset>

      {state && !state.ok && <p role="alert" className="flex items-start gap-1.5 text-sm text-red-600"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{state.message}</p>}
      <button type="submit" disabled={pending || !!disabledReason} className="btn-primary w-full">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />} Post request
      </button>
    </form>
  );
}
