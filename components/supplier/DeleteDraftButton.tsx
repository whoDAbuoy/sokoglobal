'use client';

import { useRef, useTransition } from 'react';
import clsx from 'clsx';
import { toast } from 'sonner';
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react';
import { deleteDraft } from '@/app/supplier/products/actions';

/**
 * Trash button + confirmation for one of the supplier's drafts (migration 027).
 * `onOptimisticRemove` runs inside the transition, so a parent useOptimistic list
 * hides the card at once and gets it back if the delete is refused.
 */
export default function DeleteDraftButton({ productId, title, onOptimisticRemove, className }: {
  productId: string; title: string; onOptimisticRemove?: () => void; className?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [pending, startTransition] = useTransition();

  const confirm = () => startTransition(async () => {
    dialogRef.current?.close();
    onOptimisticRemove?.();
    const r = await deleteDraft(productId);
    if (r.ok) toast.success(`“${title}” deleted`);
    else toast.error('Could not delete draft', { description: r.message });
  });

  return (
    <>
      <button type="button" onClick={() => dialogRef.current?.showModal()} disabled={pending} aria-label={`Delete draft “${title}”`}
        className={clsx('inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium text-neutral-600 transition-colors hover:bg-red-50 hover:text-red-700 disabled:opacity-50', className)}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Trash2 className="h-4 w-4" aria-hidden />} Delete
      </button>

      <dialog ref={dialogRef} aria-labelledby={`draft-del-${productId}`}
        className="w-[calc(100%-2rem)] max-w-md rounded-lg border border-neutral-200 p-0 text-neutral-900 shadow-overlay frost-panel frost-backdrop dark:border-snow/10">
        <div className="flex items-start gap-3 px-6 pb-5 pt-6">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-red-200 bg-red-50">
            <AlertTriangle className="h-4 w-4 text-red-600" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 id={`draft-del-${productId}`} className="text-base font-semibold text-neutral-900">
              Delete <span className="break-words">“{title}”</span>?
            </h2>
            <p className="mt-1 text-sm text-neutral-600">Are you sure you want to delete this draft? This cannot be undone.</p>
            <p className="mt-2 text-xs text-neutral-500">Its photos and videos are deleted too.</p>
          </div>
        </div>
        <div className="flex justify-end gap-3 border-t border-neutral-200 bg-neutral-50 px-6 py-4">
          <button type="button" onClick={() => dialogRef.current?.close()} className="btn-secondary" autoFocus>Cancel</button>
          <button type="button" onClick={confirm} className="btn-primary bg-red-600 hover:bg-red-700 focus-visible:ring-red-600">
            <Trash2 className="h-4 w-4" aria-hidden /> Delete draft
          </button>
        </div>
      </dialog>
    </>
  );
}
