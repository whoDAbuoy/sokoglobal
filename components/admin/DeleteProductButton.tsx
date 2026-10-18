'use client';

import { useRef, useState, useTransition } from 'react';
import clsx from 'clsx';
import { toast } from 'sonner';
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react';
import { removeProduct } from '@/app/admin/actions';

const MIN_REASON = 10; // mirrors admin_remove_product()

/**
 * "Delete" trigger + confirmation modal. Uses the native <dialog> (focus trap,
 * Esc to close, inert background) so no UI library is needed.
 *
 * `hasHistory`: true → the product has orders/pools and will be archived;
 * false → it will be hard-deleted; undefined → copy covers both.
 * `onOptimisticRemove` runs inside the transition, so a parent useOptimistic
 * list can hide the row immediately and gets it back if the action fails.
 */
export default function DeleteProductButton({ productId, title, hasHistory, onOptimisticRemove, className }: {
  productId: string;
  title: string;
  hasHistory?: boolean;
  onOptimisticRemove?: () => void;
  className?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState('');
  const [pending, startTransition] = useTransition();
  const valid = reason.trim().length >= MIN_REASON;

  function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || pending) return;
    startTransition(async () => {
      onOptimisticRemove?.();
      const r = await removeProduct(productId, reason.trim());
      if (r.ok) {
        dialogRef.current?.close();
        setReason('');
        toast.success(`“${title}” removed`, { description: r.message });
      } else {
        toast.error('Could not delete product', { description: r.message });
      }
    });
  }

  return (
    <>
      <button type="button" onClick={() => dialogRef.current?.showModal()}
        className={clsx('inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50', className)}>
        <Trash2 className="h-4 w-4" aria-hidden /> Delete
      </button>

      <dialog ref={dialogRef} aria-labelledby={`del-title-${productId}`}
        onCancel={(e) => { if (pending) e.preventDefault(); }}
        className="w-[calc(100%-2rem)] max-w-md rounded-2xl p-0 shadow-xl backdrop:bg-slate-900/50">
        <form onSubmit={confirm} className="p-6">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-red-50">
              <AlertTriangle className="h-5 w-5 text-red-600" aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 id={`del-title-${productId}`} className="text-base font-semibold text-slate-900">
                Delete <span className="break-words">“{title}”</span>?
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Are you sure you want to permanently delete this object? This action cannot be undone.
              </p>
              <p className="mt-2 text-xs text-slate-500">
                {hasHistory === true && 'This product has order history, so it will be archived instead: hidden everywhere, open Trend Pools cancelled and refunded, escrow records kept.'}
                {hasHistory === false && 'The product, its photos and videos will be permanently erased.'}
                {hasHistory === undefined && 'Products with order history are archived instead, so escrow and payout records stay intact.'}
              </p>
            </div>
          </div>

          <label htmlFor={`del-reason-${productId}`} className="label mt-5 text-xs">Reason (audit log, shown to the supplier)</label>
          <textarea id={`del-reason-${productId}`} rows={3} maxLength={2000} required value={reason}
            onChange={(e) => setReason(e.target.value)} className="input text-sm"
            placeholder="e.g. Counterfeit branding reported by buyers — listing removed." />

          <div className="mt-5 flex justify-end gap-3">
            <button type="button" onClick={() => dialogRef.current?.close()} disabled={pending} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={!valid || pending}
              className="btn-primary bg-red-600 hover:bg-red-700 focus-visible:ring-red-600/30">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Delete
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
