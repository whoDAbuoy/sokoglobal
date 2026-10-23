'use client';

import { useState } from 'react';
import { AlertCircle, ExternalLink, Loader2 } from 'lucide-react';

const COPY = {
  dpo: { button: 'Continue to DPO Pay', note: 'Pay by card or mobile money on DPO Pay’s secure page. You’ll come straight back here.' },
  paypal: { button: 'Pay with PayPal', note: 'Log in to PayPal to pay with your balance or a linked card. You’ll come straight back here.' },
} as const;

/**
 * DPO Pay / PayPal: our route starts the payment (amount from Postgres) and returns the gateway's
 * hosted page; the buyer pays there and returns with ?status=processing&gw=… for confirmation.
 */
export default function GatewayRedirect({ gateway, endpoint, amountLabel }: { gateway: 'dpo' | 'paypal'; endpoint: string; amountLabel: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gateway }) });
      const json = await res.json() as { redirectUrl?: string; error?: string };
      if (!res.ok || !json.redirectUrl) throw new Error(json.error ?? 'Could not start the payment');
      window.location.assign(json.redirectUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the payment');
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-neutral-600">{COPY[gateway].note}</p>
      <button type="button" onClick={() => void go()} disabled={busy} className="btn-primary w-full">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ExternalLink className="h-4 w-4" aria-hidden />} {COPY[gateway].button} · {amountLabel}
      </button>
      {error && <p role="alert" className="flex items-start gap-1.5 text-sm text-red-600"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p>}
    </div>
  );
}
