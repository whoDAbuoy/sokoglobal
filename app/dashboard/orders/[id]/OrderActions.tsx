'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, CheckCircle2, Clock, Loader2, PackageCheck, ShieldCheck } from 'lucide-react';
import type { EscrowStatus } from '@/lib/types';
import type { PaymentStep } from '@/lib/milestone';
import type { PaymentMethod } from '@/lib/payment-methods';
import PaymentMethods, { type ManualContext } from '@/components/payments/PaymentMethods';
import GatewayReturn from '@/components/payments/GatewayReturn';

const PAY_COPY: Record<'pay_full' | 'pay_deposit' | 'pay_balance', { title: string; note: string }> = {
  pay_full: { title: 'Awaiting payment', note: 'Your money goes into escrow, not to the supplier.' },
  pay_deposit: { title: 'Pay the 30% deposit', note: 'The deposit is held in escrow. The 70% balance is due once the supplier dispatches.' },
  pay_balance: { title: 'Your order is on its way — pay the 70% balance', note: 'The balance joins your deposit in escrow; the supplier is paid only after you verify the goods.' },
};

export default function OrderActions({ orderId, status, step, returnStatus, payWith, amountLabel = 'now', balanceLabel, buyerName, methods, manual, gatewayReturn }: {
  orderId: string; status: EscrowStatus; returnStatus: string | null; payWith?: string | null;
  /** What is payable now (lib/milestone.ts paymentStep). */
  step: PaymentStep;
  /** Formatted amount due now, e.g. "$579.00". */
  amountLabel?: string;
  /** Formatted milestone balance, shown while waiting for dispatch. */
  balanceLabel?: string;
  buyerName?: string;
  /** Methods switched on, configured and within limits for this amount (lib/payment-settings-server.ts). */
  methods: PaymentMethod[];
  /** SWIFT / crypto context, including an open transfer. */
  manual?: ManualContext;
  /** Back from DPO Pay / PayPal: confirm with the gateway now. */
  gatewayReturn?: { gateway: 'dpo' | 'paypal'; token: string } | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<'confirm' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const payable = step.kind === 'pay_full' || step.kind === 'pay_deposit' || step.kind === 'pay_balance';
  const awaitingWebhook = payable && (returnStatus === 'processing' || returnStatus === 'successful');

  // Returning from checkout: poll briefly while the webhook confirms the payment.
  useEffect(() => {
    if (!awaitingWebhook) return;
    let n = 0;
    const t = setInterval(() => { n += 1; router.refresh(); if (n >= 12) clearInterval(t); }, 5000);
    return () => clearInterval(t);
  }, [awaitingWebhook, router]);

  async function call(kind: 'confirm') {
    setBusy(kind);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/confirm`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Something went wrong');
      setConfirmed(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(null);
    }
  }

  if (awaitingWebhook) {
    return (
      <div role="status" className="glass-card mt-6 flex items-center gap-3 p-4 text-sm text-neutral-800">
        {gatewayReturn && <GatewayReturn gateway={gatewayReturn.gateway} token={gatewayReturn.token} />}
        <Loader2 className="h-5 w-5 animate-spin" />
        Payment received — we&apos;re confirming it with the escrow account. This usually takes under a minute.
      </div>
    );
  }

  if (step.kind === 'balance_waiting') {
    return (
      <div className="card mt-6 flex items-start gap-3 p-5">
        <Clock className="mt-0.5 h-5 w-5 shrink-0 text-cyan-600" aria-hidden />
        <div>
          <p className="font-medium text-slate-900">Deposit held in escrow — the supplier is preparing your order</p>
          <p className="mt-1 text-sm text-slate-600">
            The remaining 70%{balanceLabel ? ` (${balanceLabel})` : ''} becomes payable as soon as it is dispatched. We&apos;ll notify you with the waybill.
          </p>
        </div>
      </div>
    );
  }

  if (payable) {
    const copy = PAY_COPY[step.kind];
    return (
      <div className="glass-card mt-6 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-medium text-slate-900">{returnStatus === 'failed' || returnStatus === 'cancelled' ? 'Payment didn’t go through' : copy.title}</p>
            <p className="text-sm text-slate-500">{copy.note}</p>
          </div>
        </div>
        <div className="mt-4">
          <PaymentMethods target={{ kind: 'order', id: orderId }} methods={methods} preferred={payWith} amountLabel={amountLabel} buyerName={buyerName} manual={manual} />
        </div>
      </div>
    );
  }

  if (status === 'delivered_pending_verification' && !confirmed) {
    return (
      <div className="card mt-6 p-5">
        <p className="flex items-center gap-2 font-medium text-slate-900"><PackageCheck className="h-5 w-5 text-brand-700" /> Your goods have arrived</p>
        <p className="mt-1 text-sm text-slate-600">
          Inspect quantity, sizes/shades and condition. Confirming releases payment to the supplier and cannot be undone.
          If something is wrong, open a dispute from the support button instead — funds stay frozen.
        </p>
        <button type="button" onClick={() => void call('confirm')} disabled={busy !== null} className="btn-primary mt-4">
          {busy === 'confirm' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Goods verified — release payment
        </button>
        {error && <p className="mt-2 flex items-center gap-1.5 text-sm text-red-600"><AlertCircle className="h-4 w-4" />{error}</p>}
      </div>
    );
  }

  if (confirmed || status === 'released') {
    return (
      <p className="mt-6 flex items-center gap-2 rounded-2xl border p-4 text-sm tone-escrow">
        <CheckCircle2 className="h-5 w-5" /> Delivery verified. Escrow released to the supplier — thank you for trading safely.
      </p>
    );
  }
  return null;
}
