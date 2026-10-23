'use client';

import { useId, useRef, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Zap } from 'lucide-react';
import { requestEarlyPayout } from '@/app/supplier/orders/actions';
import { formatUSD } from '@/lib/format';
import { formatRate } from '@/lib/pricing';

export interface EarlyPayoutQuote {
  eligible: boolean; reason: string | null;
  gross_cents: number; commission_rate: number | null; commission_cents: number | null;
  fee_rate: number; fee_cents: number; net_cents: number | null;
}

/**
 * "Instant Early Payout": shows the breakdown from early_payout_quote() and asks
 * for confirmation. Postgres re-checks eligibility and fixes the fee when the
 * supplier confirms; the transfer then runs through the normal payout worker.
 */
export default function EarlyPayoutPanel({ orderId, quote }: { orderId: string; quote: EarlyPayoutQuote }) {
  const ref = useRef<HTMLDialogElement>(null);
  const uid = useId();
  const router = useRouter();
  const [pending, start] = useTransition();
  const rows: [string, string][] = [
    ['Goods value', formatUSD(quote.gross_cents, true)],
    ...(quote.commission_cents !== null
      ? [[`Platform commission (${formatRate(quote.commission_rate ?? 0)})`, `−${formatUSD(quote.commission_cents, true)}`] as [string, string]]
      : [['Platform commission', 'standard rate'] as [string, string]]),
    [`Early payout fee (${formatRate(quote.fee_rate)})`, `−${formatUSD(quote.fee_cents, true)}`],
  ];

  const confirm = () => start(async () => {
    const r = await requestEarlyPayout(orderId);
    (r.ok ? toast.success : toast.error)(r.message);
    ref.current?.close();
    if (r.ok) router.refresh();
  });

  return (
    <div>
      <dl className="space-y-2 text-sm text-neutral-600">
        {rows.map(([l, v]) => <div key={l} className="flex justify-between gap-3"><dt>{l}</dt><dd className="tabular-nums text-neutral-900">{v}</dd></div>)}
        {quote.net_cents !== null && (
          <div className="flex justify-between gap-3 border-t border-neutral-200 pt-2 font-semibold text-neutral-900"><dt>You receive now</dt><dd className="tabular-nums">{formatUSD(quote.net_cents, true)}</dd></div>
        )}
      </dl>
      {quote.eligible ? (
        <button type="button" onClick={() => ref.current?.showModal()} className="btn-primary mt-4 w-full">
          <Zap className="h-4 w-4" aria-hidden /> Get paid now
        </button>
      ) : (
        <p className="mt-4 rounded-md border px-3 py-2 text-sm tone-muted">{quote.reason}</p>
      )}
      <dialog ref={ref} aria-labelledby={`${uid}-t`} onCancel={(e) => { if (pending) e.preventDefault(); }}
        className="w-[calc(100%-2rem)] max-w-md rounded-lg border border-neutral-200 p-0 text-neutral-900 shadow-overlay frost-panel frost-backdrop dark:border-snow/10">
        <div className="px-6 pb-4 pt-6">
          <h2 id={`${uid}-t`} className="text-base font-semibold">Take an instant early payout?</h2>
          <p className="mt-2 text-sm text-neutral-600">
            SokoGlobal pays you now instead of after the buyer confirms delivery, for a {formatRate(quote.fee_rate)} fee
            ({formatUSD(quote.fee_cents, true)}). The buyer&apos;s escrow protection doesn&apos;t change. This can&apos;t be undone.
          </p>
          {quote.net_cents !== null && <p className="mt-3 text-sm font-medium text-neutral-900">You receive {formatUSD(quote.net_cents, true)} (before any currency conversion to your payout account).</p>}
        </div>
        <div className="flex justify-end gap-3 border-t border-neutral-200 bg-neutral-50 px-6 py-4">
          <button type="button" onClick={() => ref.current?.close()} disabled={pending} className="btn-secondary">Cancel</button>
          <button type="button" onClick={confirm} disabled={pending} className="btn-primary">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Zap className="h-4 w-4" aria-hidden />} Pay me now
          </button>
        </div>
      </dialog>
    </div>
  );
}
