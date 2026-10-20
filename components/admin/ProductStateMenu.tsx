'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, SlidersHorizontal, X } from 'lucide-react';
import { setProductState } from '@/app/admin/actions';
import { PRODUCT_STATES, PRODUCT_STATE_LABEL, type ProductStateOverride } from '@/lib/admin-overrides';

/** Super admin: move a listing to any catalogue state (audited, reason required). */
export default function ProductStateMenu({ productId, title, status, featured }: { productId: string; title: string; status: string; featured: boolean }) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const options = PRODUCT_STATES.filter((s) => (s === 'featured' ? status === 'live' && !featured : s === 'unfeatured' ? featured : true));
  const [state, setState] = useState<ProductStateOverride>(options[0]);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const apply = () => start(async () => {
    const res = await setProductState(productId, state, reason);
    if (!res.ok) { setError(res.message); return; }
    toast.success(res.message, { description: title });
    ref.current?.close();
    router.refresh();
  });

  return (
    <>
      <button type="button" onClick={() => { setError(null); setReason(''); ref.current?.showModal(); }} aria-label={`Change status of ${title}`}
        className="press inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-violet-800 hover:bg-violet-500/10 dark:text-violet-300">
        <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden /> Status
      </button>
      <dialog ref={ref} aria-labelledby={`ps-${productId}`}
        className="w-[calc(100%-2rem)] max-w-md rounded-[18px] border border-black/[0.06] p-0 text-left text-neutral-900 shadow-overlay frost-panel frost-backdrop dark:border-snow/10">
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <h2 id={`ps-${productId}`} className="text-base font-semibold">Override status: {title}</h2>
            <button type="button" onClick={() => ref.current?.close()} aria-label="Close" className="rounded-md p-1 text-neutral-500 hover:text-neutral-900"><X className="h-4 w-4" aria-hidden /></button>
          </div>
          <label htmlFor={`ps-s-${productId}`} className="label mt-4">New state</label>
          <select id={`ps-s-${productId}`} value={state} onChange={(e) => setState(e.target.value as ProductStateOverride)} className="input">
            {options.map((s) => <option key={s} value={s}>{PRODUCT_STATE_LABEL[s]}</option>)}
          </select>
          <p className="mt-2 text-xs text-neutral-600">Publishing still needs a freight &amp; customs quote and the trial minimum. Delisting hides the listing; orders already placed continue.</p>
          <label htmlFor={`ps-r-${productId}`} className="label mt-4">Reason (written to the audit log)</label>
          <textarea id={`ps-r-${productId}`} value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={1000} className="input" />
          {error && <p role="alert" className="mt-2 text-sm text-rose-700 dark:text-rose-400">{error}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={() => ref.current?.close()} className="btn-secondary px-3 py-2">Cancel</button>
            <button type="button" onClick={apply} disabled={pending || reason.trim().length < 5} className="btn-primary px-3 py-2">
              {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Apply
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
