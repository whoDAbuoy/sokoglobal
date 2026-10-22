'use client';

import { startTransition, useActionState, useEffect, useId, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { AlertCircle, Loader2, Plus, Send, Trash2, Undo2 } from 'lucide-react';
import { submitQuote, withdrawQuote, type QuoteFormState } from '@/app/supplier/rfqs/actions';
import { MAX_TIERS, type PriceTier } from '@/lib/rfq';

export interface QuoteDefaults {
  quoteId?: string; productId?: string; unitPriceKes?: number; moq?: number; leadTimeDays?: number | null; termsNote?: string | null;
  tiers?: PriceTier[]; allowed?: string[];
}

/**
 * Supplier's private quote for one RFQ: which listing, unit price in KES,
 * MOQ, optional bulk tiers, validity and the payment terms they accept.
 */
export default function QuoteForm({ rfqId, products, defaults = {}, buyerQuantity }: {
  rfqId: string; products: { id: string; title: string }[]; defaults?: QuoteDefaults; buyerQuantity: number;
}) {
  const uid = useId();
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const [state, action, pending] = useActionState<QuoteFormState, FormData>(submitQuote, null);
  const [tierRows, setTierRows] = useState(Math.max(1, defaults.tiers?.length ?? 0));
  const [withdrawing, startWithdraw] = useTransition();

  useEffect(() => {
    if (state?.ok) { toast.success(state.message); ref.current?.close(); }
  }, [state]);

  const err = (k: string) => state?.errors?.[k];
  const a11y = (k: string) => ({ 'aria-invalid': !!err(k) || undefined, 'aria-describedby': err(k) ? `${uid}-${k}-err` : undefined });
  const msg = (k: string) => err(k) && <p id={`${uid}-${k}-err`} className="mt-1 text-xs text-red-600">{err(k)}</p>;
  const revising = !!defaults.quoteId;

  function withdraw() {
    if (!defaults.quoteId || !window.confirm('Withdraw your quote? The buyer will no longer see it.')) return;
    startWithdraw(async () => {
      const r = await withdrawQuote(defaults.quoteId!);
      if (!r.ok) { toast.error(r.message ?? 'Could not withdraw'); return; }
      toast.success('Quote withdrawn.');
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={() => ref.current?.showModal()} disabled={!products.length} className={revising ? 'btn-secondary px-3 py-1.5 text-sm' : 'btn-primary px-3 py-1.5 text-sm'}
        title={products.length ? undefined : 'You need a live listing in this category to quote'}>
        <Send className="h-3.5 w-3.5" aria-hidden /> {revising ? 'Revise quote' : 'Send quote'}
      </button>
      {revising && (
        <button type="button" onClick={withdraw} disabled={withdrawing} className="btn-secondary px-3 py-1.5 text-sm">
          {withdrawing ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Undo2 className="h-3.5 w-3.5" aria-hidden />} Withdraw
        </button>
      )}

      <dialog ref={ref} aria-labelledby={`${uid}-t`} onCancel={(e) => { if (pending) e.preventDefault(); }}
        className="w-[calc(100%-2rem)] max-w-lg rounded-lg border border-neutral-200 p-0 text-neutral-900 shadow-overlay frost-panel frost-backdrop dark:border-snow/10">
        <form onSubmit={(e) => { e.preventDefault(); const data = new FormData(e.currentTarget); startTransition(() => action(data)); }}>
          <input type="hidden" name="rfqId" value={rfqId} />
          <div className="px-6 pb-2 pt-6">
            <h2 id={`${uid}-t`} className="text-base font-semibold">{revising ? 'Revise your quote' : 'Send a private quote'}</h2>
            <p className="mt-1 text-sm text-neutral-600">Only this buyer sees it. Prices are per unit in KES, delivered to the buyer&apos;s location.</p>
          </div>
          <fieldset disabled={pending} className="max-h-[60vh] space-y-4 overflow-y-auto px-6 py-4">
            <div>
              <label htmlFor={`${uid}-p`} className="label">Your listing</label>
              <select id={`${uid}-p`} name="productId" required defaultValue={defaults.productId ?? products[0]?.id ?? ''} className="input" {...a11y('productId')}>
                {products.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
              {msg('productId')}
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label htmlFor={`${uid}-price`} className="label">Unit price (KES)</label>
                <input id={`${uid}-price`} name="unitPriceKes" required inputMode="decimal" defaultValue={defaults.unitPriceKes ?? ''} className="input tabular-nums" {...a11y('unitPriceKes')} />
                {msg('unitPriceKes')}
              </div>
              <div>
                <label htmlFor={`${uid}-moq`} className="label">MOQ</label>
                <input id={`${uid}-moq`} name="moq" required inputMode="numeric" defaultValue={defaults.moq ?? buyerQuantity} className="input tabular-nums" {...a11y('moq')} />
                {msg('moq')}
              </div>
              <div>
                <label htmlFor={`${uid}-lead`} className="label">Lead time (days)</label>
                <input id={`${uid}-lead`} name="leadTimeDays" inputMode="numeric" defaultValue={defaults.leadTimeDays ?? ''} className="input tabular-nums" {...a11y('leadTimeDays')} />
                {msg('leadTimeDays')}
              </div>
            </div>

            <fieldset>
              <legend className="label">Bulk price tiers <span className="font-normal text-neutral-500">(optional)</span></legend>
              <div className="space-y-2">
                {Array.from({ length: tierRows }, (_, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input name={`tierQty${i}`} inputMode="numeric" aria-label={`Tier ${i + 1} minimum quantity`} placeholder="From qty"
                      defaultValue={defaults.tiers?.[i]?.min_qty ?? ''} className="input tabular-nums" />
                    <input name={`tierPrice${i}`} inputMode="decimal" aria-label={`Tier ${i + 1} unit price in KES`} placeholder="KES / unit"
                      defaultValue={defaults.tiers?.[i]?.unit_price_kes ?? ''} className="input tabular-nums" />
                    {i === tierRows - 1 && tierRows > 1 && (
                      <button type="button" onClick={() => setTierRows((n) => n - 1)} aria-label="Remove last tier" className="rounded-md p-2 text-neutral-500 hover:text-red-700">
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {tierRows < MAX_TIERS && (
                <button type="button" onClick={() => setTierRows((n) => n + 1)} className="mt-2 inline-flex items-center gap-1 text-sm text-blue-700 hover:underline dark:text-blue-400">
                  <Plus className="h-3.5 w-3.5" aria-hidden /> Add tier
                </button>
              )}
              {err('priceTiers') && <p className="mt-1 text-xs text-red-600">{err('priceTiers')}</p>}
            </fieldset>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor={`${uid}-valid`} className="label">Quote valid for</label>
                <select id={`${uid}-valid`} name="validDays" defaultValue="7" className="input" {...a11y('validDays')}>
                  {[3, 7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>{d} days</option>)}
                </select>
                {msg('validDays')}
              </div>
              <fieldset>
                <legend className="label">Payment terms you accept</legend>
                {(['full', 'milestone_30_70'] as const).map((s) => (
                  <label key={s} className="flex items-center gap-2 text-sm text-neutral-800">
                    <input type="checkbox" name="allowed" value={s} defaultChecked={defaults.allowed ? defaults.allowed.includes(s) : true} />
                    {s === 'full' ? 'Paid in full upfront' : '30% upfront / 70% on dispatch'}
                  </label>
                ))}
                {msg('allowedStructures')}
                <p className="mt-1 text-xs text-neutral-500">Trade credit terms are coming later.</p>
              </fieldset>
            </div>
            <div>
              <label htmlFor={`${uid}-terms`} className="label">Terms &amp; notes <span className="font-normal text-neutral-500">(optional)</span></label>
              <textarea id={`${uid}-terms`} name="termsNote" rows={3} maxLength={2000} defaultValue={defaults.termsNote ?? ''}
                placeholder="Incoterms, packaging, sample policy…" className="input" {...a11y('termsNote')} />
              {msg('termsNote')}
            </div>
          </fieldset>

          {state && !state.ok && <p role="alert" className="mx-6 mb-2 flex items-start gap-1.5 text-sm text-red-600"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{state.message}</p>}
          <div className="flex justify-end gap-3 border-t border-neutral-200 bg-neutral-50 px-6 py-4">
            <button type="button" onClick={() => ref.current?.close()} disabled={pending} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={pending} className="btn-primary">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />} {revising ? 'Update quote' : 'Send quote'}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
