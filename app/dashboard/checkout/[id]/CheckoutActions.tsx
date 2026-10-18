'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, CreditCard, Loader2 } from 'lucide-react';
import MpesaPay from '@/app/dashboard/orders/[id]/MpesaPay';

const MPESA_ENABLED = process.env.NEXT_PUBLIC_MPESA_ENABLED === 'true';

/** Pay a whole cart once: M-Pesa STK prompt (default) or Flutterwave card checkout. */
export default function CheckoutActions({ checkoutId, returnStatus }: { checkoutId: string; returnStatus: string | null }) {
  const router = useRouter();
  const [method, setMethod] = useState<'card' | 'mpesa'>(MPESA_ENABLED && !returnStatus ? 'mpesa' : 'card');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const awaitingWebhook = returnStatus === 'successful';

  // Returning from card checkout: poll briefly while the webhook confirms the payment.
  useEffect(() => {
    if (!awaitingWebhook) return;
    let n = 0;
    const t = setInterval(() => { n += 1; router.refresh(); if (n >= 12) clearInterval(t); }, 5000);
    return () => clearInterval(t);
  }, [awaitingWebhook, router]);

  async function payByCard() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/checkout/${checkoutId}/card`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Could not open card checkout');
      window.location.assign(json.paymentLink);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open card checkout');
      setBusy(false);
    }
  }

  if (awaitingWebhook) {
    return (
      <div role="status" className="mt-6 flex items-center gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-800">
        <Loader2 className="h-5 w-5 animate-spin" />
        Card payment received — we&apos;re confirming it with the escrow account. This usually takes under a minute.
      </div>
    );
  }

  return (
    <div className="card mt-6 p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="font-medium text-neutral-900">{returnStatus === 'failed' || returnStatus === 'cancelled' ? 'Payment didn’t go through' : 'Pay for your cart'}</p>
          <p className="text-sm text-neutral-500">One payment. Each Trial Batch is held in its own escrow until you verify it.</p>
        </div>
        {MPESA_ENABLED && (
          <div role="radiogroup" aria-label="Payment method" className="inline-flex rounded-md bg-neutral-100 p-1 text-sm font-medium">
            {(['mpesa', 'card'] as const).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={method === m} onClick={() => setMethod(m)}
                className={method === m ? 'rounded bg-white px-3 py-1.5 text-neutral-900 shadow-card' : 'px-3 py-1.5 text-neutral-500 hover:text-neutral-800'}>
                {m === 'card' ? 'Card / bank' : 'M-Pesa'}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="mt-4">
        {method === 'mpesa' ? <MpesaPay orderId={checkoutId} endpoint={`/api/checkout/${checkoutId}/mpesa`} /> : (
          <>
            <button type="button" onClick={() => void payByCard()} disabled={busy} className="btn-primary">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />} Pay securely by card
            </button>
            {error && <p className="mt-2 flex items-center gap-1.5 text-sm text-red-600"><AlertCircle className="h-4 w-4" />{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}
