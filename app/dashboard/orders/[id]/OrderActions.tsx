'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, CheckCircle2, Loader2, PackageCheck, ShieldCheck } from 'lucide-react';
import type { EscrowStatus } from '@/lib/types';
import BankCardPanel from '@/components/payments/BankCardPanel';
import MpesaPay from './MpesaPay';

const MPESA_ENABLED = process.env.NEXT_PUBLIC_MPESA_ENABLED === 'true';

export default function OrderActions({ orderId, status, returnStatus, payWith, amountLabel = 'now', buyerName, mpesaOverLimit = false }: {
  orderId: string; status: EscrowStatus; returnStatus: string | null; payWith?: string | null;
  /** Formatted order total, e.g. "$579.00". */
  amountLabel?: string;
  buyerName?: string;
  /** Total is above the M-Pesa per-payment limit → Bank Card only. */
  mpesaOverLimit?: boolean;
}) {
  const mpesaAvailable = MPESA_ENABLED && !mpesaOverLimit;
  // M-Pesa is the default when available, unless the buyer chose card or is returning from card checkout.
  const [method, setMethod] = useState<'card' | 'mpesa'>(
    mpesaAvailable && payWith !== 'card' && !returnStatus ? 'mpesa' : 'card',
  );
  const router = useRouter();
  const [busy, setBusy] = useState<'confirm' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const awaitingWebhook = status === 'pending_payment' && (returnStatus === 'processing' || returnStatus === 'successful');

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
      <div role="status" className="mt-6 flex items-center gap-3 rounded-xl bg-brand-50 p-4 text-sm text-brand-900 ring-1 ring-neutral-200">
        <Loader2 className="h-5 w-5 animate-spin" />
        Payment received — we&apos;re confirming it with the escrow account. This usually takes under a minute.
      </div>
    );
  }

  if (status === 'pending_payment') {
    return (
      <div className="card mt-6 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-medium text-slate-900">{returnStatus === 'failed' || returnStatus === 'cancelled' ? 'Payment didn’t go through' : 'Awaiting payment'}</p>
            <p className="text-sm text-slate-500">Your money goes into escrow, not to the supplier.</p>
          </div>
          {mpesaAvailable && (
            <div role="radiogroup" aria-label="Payment method" className="inline-flex rounded-lg bg-slate-100 p-1 text-sm font-medium">
              {(['mpesa', 'card'] as const).map((m) => (
                <button key={m} type="button" role="radio" aria-checked={method === m} onClick={() => setMethod(m)}
                  className={method === m ? 'rounded-md bg-white px-3 py-1.5 text-slate-900 shadow-sm' : 'px-3 py-1.5 text-slate-500 hover:text-slate-800'}>
                  {m === 'card' ? 'Bank Card (Visa / Mastercard)' : 'M-Pesa'}
                </button>
              ))}
            </div>
          )}
        </div>
        {MPESA_ENABLED && mpesaOverLimit && (
          <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            This total is above M-Pesa&apos;s KES 250,000 per-payment limit. Please pay by <strong>Bank Card (Visa / Mastercard)</strong>.
          </p>
        )}
        <div className="mt-4">
          {method === 'mpesa'
            ? <MpesaPay orderId={orderId} onSwitchToCard={() => setMethod('card')} />
            : <BankCardPanel endpoint={`/api/orders/${orderId}/checkout`} amountLabel={amountLabel} returnPath={`/dashboard/orders/${orderId}`} defaultName={buyerName} />}
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
      <p className="mt-6 flex items-center gap-2 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800 ring-1 ring-emerald-600/20">
        <CheckCircle2 className="h-5 w-5" /> Delivery verified. Escrow released to the supplier — thank you for trading safely.
      </p>
    );
  }
  return null;
}
