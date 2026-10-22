'use client';

import { useId, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { AlertCircle, AlertTriangle, Loader2, Trash2 } from 'lucide-react';
import { deleteRfq } from '@/app/dashboard/rfqs/actions';

/** "Delete RFQ" with a confirmation dialog. Postgres RLS decides whether the caller may delete it. */
export default function DeleteRfqButton({ rfqId, title, quoteCount = 0, redirectTo }: {
  rfqId: string; title: string; quoteCount?: number;
  /** Where to go after deleting (e.g. from the detail page); otherwise the current page refreshes. */
  redirectTo?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const uid = useId();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function confirm() {
    setError(null);
    start(async () => {
      const r = await deleteRfq(rfqId);
      if (!r.ok) { setError(r.message); return; }
      ref.current?.close();
      toast.success('Request deleted.');
      if (redirectTo) router.push(redirectTo); else router.refresh();
    });
  }

  return (
    <>
      <button type="button" onClick={() => { setError(null); ref.current?.showModal(); }}
        className="inline-flex items-center gap-1 text-sm text-neutral-600 transition-colors hover:text-red-700">
        <Trash2 className="h-3.5 w-3.5" aria-hidden /> Delete RFQ
      </button>
      <dialog ref={ref} aria-labelledby={`${uid}-t`} onCancel={(e) => { if (pending) e.preventDefault(); }}
        className="w-[calc(100%-2rem)] max-w-md rounded-lg border border-neutral-200 p-0 text-neutral-900 shadow-overlay frost-panel frost-backdrop dark:border-snow/10">
        <div className="flex items-start gap-3 px-6 pb-5 pt-6">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-red-200 bg-red-50 dark:border-red-500/30 dark:bg-red-500/10">
            <AlertTriangle className="h-4 w-4 text-red-600" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 id={`${uid}-t`} className="text-base font-semibold">Delete <span className="break-words">“{title}”</span>?</h2>
            <p className="mt-1 text-sm text-neutral-600">
              The request is removed for good{quoteCount > 0 ? `, together with the ${quoteCount} quote${quoteCount === 1 ? '' : 's'} suppliers sent` : ''}. This cannot be undone.
            </p>
            {error && <p role="alert" className="mt-3 flex items-start gap-1.5 text-sm text-red-600"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p>}
          </div>
        </div>
        <div className="flex justify-end gap-3 border-t border-neutral-200 bg-neutral-50 px-6 py-4">
          <button type="button" onClick={() => ref.current?.close()} disabled={pending} className="btn-secondary">Cancel</button>
          <button type="button" onClick={confirm} disabled={pending} className="btn-primary bg-red-600 hover:bg-red-700 focus-visible:ring-red-600">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Trash2 className="h-4 w-4" aria-hidden />} Delete
          </button>
        </div>
      </dialog>
    </>
  );
}
