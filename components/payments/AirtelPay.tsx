'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, CheckCircle2, Loader2, Smartphone } from 'lucide-react';

type Payment = { status: 'pending' | 'succeeded' | 'failed' | 'review'; amount: number; currency: string; message: string | null };

const POLL_MS = 4_000;
const GIVE_UP_MS = 3 * 60_000;

/**
 * Airtel Money: send a PIN prompt to the buyer's phone, then poll until Airtel confirms (migration 028).
 * `endpoint` is /api/orders/:id/gateway or /api/checkout/:id/gateway.
 */
export default function AirtelPay({ endpoint }: { endpoint: string }) {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [phase, setPhase] = useState<'form' | 'sending' | 'waiting' | 'done'>('form');
  const [payment, setPayment] = useState<Payment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const waitingSince = useRef(0);

  const check = useCallback(async () => {
    const res = await fetch(endpoint, { cache: 'no-store' });
    if (!res.ok) return null;
    const { payment: p } = await res.json() as { payment: Payment | null };
    setPayment(p);
    return p;
  }, [endpoint]);

  useEffect(() => {
    void check().then((p) => { if (p?.status === 'pending') { waitingSince.current = Date.now(); setPhase('waiting'); } });
  }, [check]);

  useEffect(() => {
    if (phase !== 'waiting') return;
    const t = setInterval(async () => {
      const p = await check();
      if (!p || p.status === 'pending') {
        if (Date.now() - waitingSince.current > GIVE_UP_MS) {
          setError('We haven’t heard back from Airtel Money yet. If you paid, this page will update shortly — don’t pay again.');
          setPhase('form');
        }
        return;
      }
      if (p.status === 'succeeded') { setPhase('done'); router.refresh(); return; }
      setError(p.message);
      setPhase(p.status === 'review' ? 'done' : 'form');
    }, POLL_MS);
    return () => clearInterval(t);
  }, [phase, check, router]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setPhase('sending');
    setError(null);
    try {
      const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gateway: 'airtel_money', phone }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Could not send the Airtel Money prompt');
      setPayment({ status: 'pending', amount: json.amount, currency: json.currency, message: null });
      waitingSince.current = Date.now();
      setPhase('waiting');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the Airtel Money prompt');
      setPhase('form');
    }
  }

  if (phase === 'done') {
    return payment?.status === 'succeeded'
      ? <p role="status" className="flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" /> Airtel Money payment received — updating your order…</p>
      : <p role="status" className="flex items-start gap-2 text-sm text-neutral-700"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" /> {error}</p>;
  }

  if (phase === 'waiting') {
    return (
      <div role="status" className="flex items-start gap-3 rounded-xl border p-4 text-sm tone-danger">
        <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin" />
        <div>
          <p className="font-medium">Check your phone</p>
          <p>Enter your Airtel Money PIN to pay {payment ? `${payment.currency} ${payment.amount.toLocaleString('en-US')}` : 'the amount due'} into escrow. This page updates automatically.</p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={send} className="space-y-3">
      <label htmlFor="airtel-phone" className="label text-xs">Airtel Money number</label>
      <div className="flex flex-wrap gap-2">
        <input id="airtel-phone" type="tel" inputMode="tel" autoComplete="tel" required placeholder="0733 123 456"
          value={phone} onChange={(e) => setPhone(e.target.value)} className="input min-w-[12rem] flex-1" />
        <button type="submit" disabled={phase === 'sending'} className="btn-primary bg-red-600 hover:bg-red-700">
          {phase === 'sending' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Smartphone className="h-4 w-4" />} Send Airtel Money prompt
        </button>
      </div>
      <p className="text-xs text-neutral-500">Charged in local currency at today’s platform rate; the exact amount shows on the prompt before you enter your PIN.</p>
      {error && <p className="flex items-start gap-1.5 text-sm text-red-600"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p>}
    </form>
  );
}
