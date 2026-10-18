'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import MpesaPay from '@/app/dashboard/orders/[id]/MpesaPay';
import BankCardPanel from '@/components/payments/BankCardPanel';

const MPESA_ENABLED = process.env.NEXT_PUBLIC_MPESA_ENABLED === 'true';

/** Pay a whole cart once: M-Pesa STK prompt (default) or Bank Card (Visa / Mastercard) via Paystack. */
export default function CheckoutActions({ checkoutId, returnStatus, amountLabel = 'now', buyerName, mpesaOverLimit = false }: {
  checkoutId: string;
  returnStatus: string | null;
  /** Formatted amount still to pay, e.g. "$1,258.00". */
  amountLabel?: string;
  buyerName?: string;
  /** Total is above the M-Pesa per-payment limit → Bank Card only. */
  mpesaOverLimit?: boolean;
}) {
  const router = useRouter();
  const mpesaAvailable = MPESA_ENABLED && !mpesaOverLimit;
  const [method, setMethod] = useState<'card' | 'mpesa'>(mpesaAvailable && !returnStatus ? 'mpesa' : 'card');
  const awaitingWebhook = returnStatus === 'processing' || returnStatus === 'successful';

  // Returning from a card payment: poll briefly while Paystack's confirmation lands.
  useEffect(() => {
    if (!awaitingWebhook) return;
    let n = 0;
    const t = setInterval(() => { n += 1; router.refresh(); if (n >= 12) clearInterval(t); }, 5000);
    return () => clearInterval(t);
  }, [awaitingWebhook, router]);

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
        {mpesaAvailable && (
          <div role="radiogroup" aria-label="Payment method" className="inline-flex rounded-md bg-neutral-100 p-1 text-sm font-medium">
            {(['mpesa', 'card'] as const).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={method === m} onClick={() => setMethod(m)}
                className={method === m ? 'rounded bg-white px-3 py-1.5 text-neutral-900 shadow-card' : 'px-3 py-1.5 text-neutral-500 hover:text-neutral-800'}>
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
          ? <MpesaPay orderId={checkoutId} endpoint={`/api/checkout/${checkoutId}/mpesa`} onSwitchToCard={() => setMethod('card')} />
          : <BankCardPanel endpoint={`/api/checkout/${checkoutId}/card`} amountLabel={amountLabel} returnPath={`/dashboard/checkout/${checkoutId}`} defaultName={buyerName} />}
      </div>
    </div>
  );
}
