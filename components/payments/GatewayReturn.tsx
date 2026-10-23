'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Back from DPO Pay (TransactionToken) or PayPal (token): ask our server to confirm the payment with
 * the gateway right away (PayPal is captured then), instead of waiting for the webhook. Best-effort;
 * the page's own refresh loop shows the result.
 */
export default function GatewayReturn({ gateway, token }: { gateway: 'dpo' | 'paypal'; token: string }) {
  const router = useRouter();
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    void fetch('/api/payments/gateway/confirm', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gateway, token }),
    }).then(() => router.refresh()).catch(() => undefined);
  }, [gateway, token, router]);
  return null;
}
