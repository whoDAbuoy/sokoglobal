'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import type { PaymentMethod } from '@/lib/payment-methods';
import PaymentMethods from '@/components/payments/PaymentMethods';
import GatewayReturn from '@/components/payments/GatewayReturn';

/**
 * Pay a whole cart once with any online method that is switched on (M-Pesa, Airtel Money, card,
 * DPO Pay, PayPal — migration 028). Wire and crypto are per order, so they are not offered for carts.
 */
export default function CheckoutActions({ checkoutId, returnStatus, amountLabel = 'now', buyerName, methods, gatewayReturn }: {
  checkoutId: string;
  returnStatus: string | null;
  /** Formatted amount still to pay, e.g. "$1,258.00". */
  amountLabel?: string;
  buyerName?: string;
  /** Methods switched on, configured and within limits for this amount. */
  methods: PaymentMethod[];
  /** Back from DPO Pay / PayPal: confirm with the gateway now. */
  gatewayReturn?: { gateway: 'dpo' | 'paypal'; token: string } | null;
}) {
  const router = useRouter();
  const awaitingWebhook = returnStatus === 'processing' || returnStatus === 'successful';

  // Returning from a hosted payment page: poll briefly while the confirmation lands.
  useEffect(() => {
    if (!awaitingWebhook) return;
    let n = 0;
    const t = setInterval(() => { n += 1; router.refresh(); if (n >= 12) clearInterval(t); }, 5000);
    return () => clearInterval(t);
  }, [awaitingWebhook, router]);

  if (awaitingWebhook) {
    return (
      <div role="status" className="glass-card mt-6 flex items-center gap-3 p-4 text-sm text-neutral-800">
        {gatewayReturn && <GatewayReturn gateway={gatewayReturn.gateway} token={gatewayReturn.token} />}
        <Loader2 className="h-5 w-5 animate-spin" />
        Payment received — we&apos;re confirming it with the escrow account. This usually takes under a minute.
      </div>
    );
  }

  return (
    <div className="glass-card mt-6 p-5 sm:p-6">
      <div>
        <p className="font-medium text-neutral-900">{returnStatus === 'failed' || returnStatus === 'cancelled' ? 'Payment didn’t go through' : 'Pay for your cart'}</p>
        <p className="text-sm text-neutral-500">One payment. Each Trial Batch is held in its own escrow until you verify it.</p>
      </div>
      <div className="mt-4">
        <PaymentMethods target={{ kind: 'group', id: checkoutId }} methods={methods} amountLabel={amountLabel} buyerName={buyerName} />
      </div>
    </div>
  );
}
