'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, CheckCircle2, CreditCard, Loader2, PackageCheck, ShieldCheck } from 'lucide-react';
import type { EscrowStatus } from '@/lib/types';
import MpesaPay from './MpesaPay';

const MPESA_ENABLED = process.env.NEXT_PUBLIC_MPESA_ENABLED === 'true';

export default function OrderActions({ orderId, status, returnStatus, payWith }: {
  orderId: string; status: EscrowStatus; returnStatus: string | null; payWith?: string | null;
}) {
  // M-Pesa is the default when enabled, unless the buyer chose card or is returning from card checkout.
  const [method, setMethod] = useState<'card' | 'mpesa'>(
    MPESA_ENABLED && payWith !== 'card' && !returnStatus ? 'mpesa' : 'card',
  );
  const router = useRouter();
  const [busy, setBusy] = useState<'pay' | 'confirm' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const awaitingWebhook = status === 'pending_payment' && returnStatus === 'successful';

  // Returning from checkout: poll briefly while the webhook confirms the payment.
  useEffect(() => {
    if (!awaitingWebhook) return;
    let n = 0;
    const t = setInterval(() => { n += 1; router.refresh(); if (n >= 12) clearInterval(t); }, 5000);
    return () => clearInterval(t);
  }, [awaitingWebhook, router]);

  async function call(kind: 'pay' | 'confirm') {
    setBusy(kind);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/${kind === 'pay' ? 'checkout' : 'confirm'}`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Something went wrong');
      if (kind === 'pay' && json.paymentLink) { window.location.assign(json.paymentLink); return; }
      if (kind === 'confirm') setConfirmed(true);
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
        Payment received by Flutterwave — we&apos;re confirming it with the escrow account. This usually takes under a minute.
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
          {MPESA_ENABLED && (
            <div role="radiogroup" aria-label="Payment method" className="inline-flex rounded-lg bg-slate-100 p-1 text-sm font-medium">
              {(['mpesa', 'card'] as const).map((m) => (
                <button key={m} type="button" role="radio" aria-checked={method === m} onClick={() => setMethod(m)}
                  className={method === m ? 'rounded-md bg-white px-3 py-1.5 text-slate-900 shadow-sm' : 'px-3 py-1.5 text-slate-500 hover:text-slate-800'}>
                  {m === 'card' ? 'Card / bank' : 'M-Pesa'}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="mt-4">
          {method === 'mpesa' ? <MpesaPay orderId={orderId} /> : (
            <>
              <button type="button" onClick={() => void call('pay')} disabled={busy !== null} className="btn-primary">
                {busy === 'pay' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />} Pay securely
              </button>
              {error && <p className="mt-2 flex w-full items-center gap-1.5 text-sm text-red-600"><AlertCircle className="h-4 w-4" />{error}</p>}
            </>
          )}
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
