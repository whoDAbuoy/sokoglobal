'use client';

import { useId, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import clsx from 'clsx';
import { AlertCircle, CheckCircle2, Loader2, X } from 'lucide-react';
import { acceptQuote, closeRfq, rejectQuote } from '@/app/dashboard/rfqs/actions';
import { useCurrency } from '@/context/CurrencyContext';
import { MILESTONE_MIN_CENTS, PAYMENT_STRUCTURE_LABEL, milestoneSplit, type PaymentStructure } from '@/lib/milestone';
import { quoteOrderLine, type PriceTier } from '@/lib/rfq';
import { formatUSD } from '@/lib/format';
import { escrowFeeCents, formatRate } from '@/lib/pricing';

/**
 * Accept a quote: shows exactly what will be ordered (MOQ, tier price, USD
 * escrow amount at today's rate, deposit split) and lets the buyer pick one of
 * the payment options the supplier offered. Postgres prices the order again.
 */
export function AcceptQuoteButton({ quoteId, supplierName, rfqQuantity, unit, quote, allowed, kycApproved, escrowFeeRate = 0 }: {
  quoteId: string; supplierName: string; rfqQuantity: number; unit: string;
  quote: { unit_price_kes: number; price_tiers: PriceTier[]; moq: number }; allowed: PaymentStructure[]; kycApproved: boolean;
  /** platform_settings.escrow_fee_percent (migration 026): added to the order total when the quote becomes an order. */
  escrowFeeRate?: number;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const uid = useId();
  const router = useRouter();
  const { rates, formatKes, formatUsd, currency } = useCurrency();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const line = quoteOrderLine(rfqQuantity, quote, rates.USD);
  const milestoneOk = kycApproved && line.goodsCents >= MILESTONE_MIN_CENTS;
  const options = allowed.filter((s) => s === 'full' || s === 'milestone_30_70');
  const [structure, setStructure] = useState<PaymentStructure>(options.includes('milestone_30_70') && milestoneOk ? 'milestone_30_70' : 'full');
  const feeCents = escrowFeeCents(line.goodsCents, escrowFeeRate);
  const escrowCents = line.goodsCents + feeCents;
  const split = escrowCents > 0 ? milestoneSplit(escrowCents) : null;

  function confirm() {
    setError(null);
    start(async () => {
      const r = await acceptQuote(quoteId, structure);
      if (!r.ok) { setError(r.message); return; }
      toast.success('Quote accepted — your order is ready to pay.');
      ref.current?.close();
      router.push(`/dashboard/orders/${r.orderId}`);
    });
  }

  return (
    <>
      <button type="button" onClick={() => ref.current?.showModal()} className="btn-primary px-3 py-1.5 text-sm">
        <CheckCircle2 className="h-4 w-4" aria-hidden /> Accept quote
      </button>
      <dialog ref={ref} aria-labelledby={`${uid}-t`} onCancel={(e) => { if (pending) e.preventDefault(); }}
        className="w-[calc(100%-2rem)] max-w-md rounded-lg border border-neutral-200 p-0 text-neutral-900 shadow-overlay frost-panel frost-backdrop dark:border-snow/10">
        <div className="px-6 pb-4 pt-6">
          <h2 id={`${uid}-t`} className="text-base font-semibold">Accept {supplierName}&apos;s quote?</h2>
          <dl className="mt-4 space-y-2 text-sm text-neutral-600">
            <div className="flex justify-between gap-3"><dt>Quantity</dt><dd className="tabular-nums text-neutral-900">{line.quantity.toLocaleString('en-US')} {unit}</dd></div>
            {line.raisedToMoq && <p className="text-xs text-amber-700">Raised to the supplier&apos;s minimum order of {quote.moq.toLocaleString('en-US')}.</p>}
            <div className="flex justify-between gap-3"><dt>Unit price</dt><dd className="tabular-nums text-neutral-900">{formatKes(line.unitPriceKes)}</dd></div>
            <div className="flex justify-between gap-3 border-t border-neutral-200 pt-2"><dt>Quoted total</dt><dd className="tabular-nums text-neutral-900">{formatKes(line.totalKes)}</dd></div>
            {feeCents > 0 && <div className="flex justify-between gap-3"><dt>Escrow protection fee ({formatRate(escrowFeeRate)})</dt><dd className="tabular-nums text-neutral-900">≈ {formatUSD(feeCents, true)}</dd></div>}
            <div className="flex justify-between gap-3 font-medium text-neutral-900"><dt>Held in escrow (USD)</dt><dd className="tabular-nums">≈ {formatUSD(escrowCents, true)}</dd></div>
          </dl>
          <p className="mt-2 text-xs text-neutral-500">Converted at today&apos;s rate when you accept; the order is then fixed in USD.{currency !== 'USD' && currency !== 'KES' ? ` About ${formatUsd(escrowCents)}.` : ''}</p>

          <fieldset className="mt-5" disabled={pending}>
            <legend className="text-sm font-medium text-neutral-900">Payment terms offered</legend>
            <div className="mt-2 space-y-2">
              {options.map((s) => {
                const blocked = s === 'milestone_30_70' && !milestoneOk;
                return (
                  <label key={s} className={clsx('flex cursor-pointer items-start gap-2.5 rounded-md border p-3 text-sm',
                    structure === s ? 'border-blue-500 ring-1 ring-blue-500' : 'border-neutral-200', blocked && 'cursor-not-allowed opacity-60')}>
                    <input type="radio" name={`${uid}-s`} value={s} checked={structure === s} disabled={blocked} onChange={() => setStructure(s)} className="mt-0.5" />
                    <span>
                      <span className="font-medium text-neutral-900">{PAYMENT_STRUCTURE_LABEL[s]}</span>
                      {s === 'milestone_30_70' && split && <span className="block text-xs text-neutral-600">{formatUSD(split.depositCents, true)} now · {formatUSD(split.balanceCents, true)} when dispatched</span>}
                      {blocked && <span className="block text-xs text-neutral-500">{kycApproved ? `Needs an order of at least ${formatUSD(MILESTONE_MIN_CENTS)}.` : 'Needs a verified business.'}</span>}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          {error && <p role="alert" className="mt-3 flex items-start gap-1.5 text-sm text-red-600"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p>}
        </div>
        <div className="flex justify-end gap-3 border-t border-neutral-200 bg-neutral-50 px-6 py-4">
          <button type="button" onClick={() => ref.current?.close()} disabled={pending} className="btn-secondary">Cancel</button>
          <button type="button" onClick={confirm} disabled={pending || !options.length} className="btn-primary">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />} Accept &amp; create order
          </button>
        </div>
      </dialog>
    </>
  );
}

function useAction(run: () => Promise<{ ok: boolean; message?: string }>, done: string) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return [pending, () => start(async () => {
    const r = await run();
    if (!r.ok) { toast.error(r.message ?? 'Something went wrong'); return; }
    toast.success(done);
    router.refresh();
  })] as const;
}

export function RejectQuoteButton({ quoteId }: { quoteId: string }) {
  const [pending, go] = useAction(() => rejectQuote(quoteId), 'Quote declined.');
  return (
    <button type="button" onClick={go} disabled={pending} className="btn-secondary px-3 py-1.5 text-sm">
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <X className="h-3.5 w-3.5" aria-hidden />} Decline
    </button>
  );
}

export function CloseRfqButton({ rfqId }: { rfqId: string }) {
  const [pending, go] = useAction(() => closeRfq(rfqId), 'Request closed.');
  return (
    <button type="button" disabled={pending} className="text-sm text-neutral-600 underline-offset-4 hover:text-neutral-900 hover:underline"
      onClick={() => { if (window.confirm('Close this request? Pending quotes will be declined.')) go(); }}>
      {pending ? 'Closing…' : 'Close request'}
    </button>
  );
}
