'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, CreditCard, Loader2, Lock } from 'lucide-react';
import { confirmCardPayment, openCardForm, type CardSession } from '@/lib/payments/paystack-client';

/**
 * Bank Card (Visa / Mastercard) payment. Collects the name on the card, then
 * opens Paystack's secure card form for number / expiry / CVC (PCI-compliant
 * iframe — card data never touches SokoGlobal). On success the charge is
 * verified server-side immediately and the page shows "confirming payment".
 */
export default function BankCardPanel({ endpoint, amountLabel, returnPath, defaultName, extraBody, disabled }: {
  /** Our route that starts the card payment: POST { billingName, ...extraBody } → { card }. */
  endpoint: string;
  amountLabel: string;
  /** Page to land on after a successful charge (status=processing is appended). */
  returnPath: string;
  defaultName?: string;
  /** More fields for the route (e.g. which RFQ add-ons). */
  extraBody?: Record<string, unknown>;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(defaultName ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function pay(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...extraBody, billingName: name }),
      });
      const json = await res.json();
      if (!res.ok || !json.card) throw new Error(json.error ?? 'Could not start the card payment');
      const session = json.card as CardSession;
      const result = await openCardForm(session);
      if (result === 'cancelled') { setNotice('Card window closed — you were not charged.'); return; }
      await confirmCardPayment(session.reference);
      router.replace(`${returnPath}${returnPath.includes('?') ? '&' : '?'}status=processing`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the card payment');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={pay} className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm font-medium text-neutral-900">
          <CreditCard className="h-4 w-4" /> Bank Card
        </p>
        <span className="flex items-center gap-1.5" aria-label="Visa and Mastercard accepted">
          <span className="rounded border border-neutral-200 bg-white px-1.5 py-0.5 text-[10px] font-bold italic tracking-tight text-[#1a1f71]">VISA</span>
          <span className="flex items-center rounded border border-neutral-200 bg-white px-1.5 py-1" title="Mastercard">
            <span className="h-2.5 w-2.5 rounded-full bg-[#eb001b]" /><span className="-ml-1 h-2.5 w-2.5 rounded-full bg-[#f79e1b] opacity-90" />
          </span>
        </span>
      </div>

      <div>
        <label htmlFor="card-name" className="label text-xs">Name on card</label>
        <input id="card-name" required minLength={2} maxLength={120} autoComplete="cc-name" value={name}
          onChange={(e) => setName(e.target.value)} placeholder="As printed on the card" className="input" />
      </div>
      <p className="text-xs text-neutral-500">
        Card number, expiry and CVC are entered in Paystack&apos;s secure form next — SokoGlobal never sees your card details.
      </p>

      <button type="submit" disabled={busy || disabled || name.trim().length < 2} className="btn-primary w-full">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />} Pay {amountLabel} by card
      </button>
      {notice && <p role="status" className="text-sm text-neutral-600">{notice}</p>}
      {error && <p className="flex items-start gap-1.5 text-sm text-red-600"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p>}
    </form>
  );
}
