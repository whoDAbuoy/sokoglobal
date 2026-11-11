'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import { AlertCircle, ArrowRight, CheckCircle2, Clock, Loader2, Plane, ShieldCheck, Users } from 'lucide-react';
import type { TrendPoolView } from '@/lib/types';
import { countryName, daysLeft, flag, formatUSD } from '@/lib/format';
import ProductVisual from './ProductVisual';
import { confirmCardPayment, openCardForm, type CardSession } from '@/lib/payments/paystack-client';

export default function TrendPoolCard({ pool }: { pool: TrendPoolView }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const remaining = pool.target_cents - pool.pledged_cents;
  const minCents = Math.min(pool.min_contribution_cents, remaining);
  const [amount, setAmount] = useState(String(minCents / 100));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState(pool.my_contribution_cents > 0);
  const paymentStatus = pool.my_payment_status ?? (joined ? 'pending_payment' : null);

  const pct = Math.min(100, Math.round((pool.pledged_cents / pool.target_cents) * 100));
  const days = daysLeft(pool.deadline);
  const isOpen = pool.status === 'open' && days > 0 && remaining > 0;
  const amountCents = Math.round(Number(amount) * 100) || 0;
  // Volumetric freight is split pro-rata to each boutique's share of the batch.
  const freightShare = Math.round((pool.freight_total_cents * amountCents) / pool.target_cents);
  const soloFreightEstimate = Math.round(freightShare * 2.6); // indicative: unconsolidated air freight ≈ 2.6× per kg

  async function join(e?: FormEvent) {
    e?.preventDefault();
    setError(null);
    if (!joined) {
      if (amountCents < minCents) return setError(`Minimum pledge is ${formatUSD(minCents)}`);
      if (amountCents > remaining) return setError(`Only ${formatUSD(remaining)} left in this pool`);
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/pools/${pool.id}/join`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amountCents }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Could not join pool');
      setJoined(true);
      setOpen(false);
      // Pledge is paid by Bank Card in Paystack's secure form and held in escrow.
      if (json.card) {
        const session = json.card as CardSession;
        const result = await openCardForm(session);
        if (result === 'cancelled') setError('Card window closed — your pledge is saved; you were not charged.');
        else await confirmCardPayment(session.reference);
        router.refresh();
        return;
      }
      if (json.error) setError(json.error);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join pool');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <article className="group flex flex-col" data-tour="pool-card">
      <div className="relative overflow-hidden rounded-lg transition duration-300 ease-out group-hover:-translate-y-1 group-hover:shadow-xl group-hover:shadow-blue-500/10">
        <ProductVisual src={pool.image_url} alt={pool.title} category={pool.category} className="aspect-[16/10]" />
        <div className="absolute left-3 top-3 flex gap-1.5">
          <span className="pill border-transparent bg-white/95 text-neutral-900">
            {flag(pool.origin_country)} → {flag(pool.destination_country)}
          </span>
          {pool.is_demo && <span className="pill border-amber-200 bg-amber-50 text-amber-800">Sample</span>}
        </div>
        {days <= 3 && isOpen && (
          <span className="pill absolute right-3 top-3 border-transparent bg-red-600 text-white">Closing soon</span>
        )}
      </div>

      <div className="flex flex-1 flex-col pt-4">
        <h3 className="text-base font-medium leading-snug text-neutral-900">{pool.title}</h3>
        {pool.description && <p className="mt-1 line-clamp-2 text-sm text-neutral-500">{pool.description}</p>}

        {/* Funding progress */}
        <div className="mt-4">
          <div className="flex items-baseline justify-between">
            <p className="text-sm font-semibold tabular-nums text-neutral-900">{pct}% Funded</p>
            <p className="text-xs tabular-nums text-neutral-500">{formatUSD(pool.pledged_cents)} of {formatUSD(pool.target_cents)}</p>
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-neutral-200" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className={clsx('h-full rounded-full transition-all', pct >= 100 ? 'bg-emerald-500' : 'bg-neutral-900')} style={{ width: `${pct}%` }} />
          </div>
        </div>

        <dl className="mt-4 grid grid-cols-3 divide-x divide-neutral-200 border-y border-neutral-200 text-center">
          <Stat icon={Users} label="Boutiques" value={`${pool.member_count}/${pool.max_members}`} />
          <Stat icon={Clock} label="Days left" value={String(days)} />
          <Stat icon={Plane} label="Ships to" value={countryName(pool.destination_country).split(' ')[0]} />
        </dl>

        <div className="mt-auto pt-5">
          {joined && paymentStatus === 'pending_payment' && pool.status !== 'expired' && days > 0 ? (
            <div className="space-y-2">
              <p className="text-center text-xs text-slate-600">Pledged {formatUSD(pool.my_contribution_cents)} · payment not received yet</p>
              <button type="button" onClick={() => void join()} disabled={submitting} className="btn-primary w-full">
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />} Complete payment <ArrowRight className="h-4 w-4" />
              </button>
              {error && <p className="flex items-start gap-1.5 text-xs text-red-600"><AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />{error}</p>}
            </div>
          ) : joined ? (
            <p className={clsx('flex items-center justify-center gap-2 rounded-md border py-2.5 text-sm font-medium',
              paymentStatus === 'funded' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-neutral-200 bg-neutral-50 text-neutral-600')}>
              <CheckCircle2 className="h-4 w-4" />
              {paymentStatus === 'funded' ? <>Paid · {formatUSD(pool.my_contribution_cents)} in escrow</>
                : paymentStatus === 'refunded' ? 'Pool expired · pledge refunded'
                : paymentStatus === 'cancelled' ? 'Pool expired · pledge cancelled'
                : "You're in this pool"}
            </p>
          ) : !isOpen ? (
            <p className="rounded-md border border-neutral-200 bg-neutral-50 py-2.5 text-center text-sm font-medium text-neutral-600">
              {pct >= 100 ? 'Fully funded — shipping soon' : 'Pool closed'}
            </p>
          ) : open ? (
            <form onSubmit={join} className="space-y-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
              <label htmlFor={`amt-${pool.id}`} className="label mb-0">Your pledge (USD)</label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">$</span>
                <input id={`amt-${pool.id}`} type="number" inputMode="decimal" min={minCents / 100} max={remaining / 100} step="10"
                  value={amount} onChange={(e) => setAmount(e.target.value)} className="input pl-7" />
              </div>
              <div className="space-y-1 text-xs text-slate-600">
                <p className="flex justify-between"><span>Your freight share</span><span className="font-medium text-slate-900">{formatUSD(freightShare, true)}</span></p>
                <p className="flex justify-between"><span>Est. shipping alone</span><span className="text-slate-400 line-through">{formatUSD(soloFreightEstimate)}</span></p>
              </div>
              {error && <p className="flex items-start gap-1.5 text-xs text-red-600"><AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />{error}</p>}
              <div className="flex gap-2">
                <button type="button" onClick={() => setOpen(false)} className="btn-secondary flex-1 py-2">Cancel</button>
                <button type="submit" disabled={submitting} className="btn-primary flex-1 py-2">
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" />} Pledge
                </button>
              </div>
              <p className="flex items-center gap-1 text-[11px] text-slate-500"><ShieldCheck className="h-3 w-3 text-emerald-600" />Held in escrow · refunded if the pool doesn&apos;t fill</p>
            </form>
          ) : (
            <button type="button" onClick={() => setOpen(true)} disabled={pool.is_demo} className="btn-primary w-full"
              title={pool.is_demo ? 'Sample pool — run supabase/seed.sql to enable' : undefined}>
              Join pool · from {formatUSD(minCents)} <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

function Stat({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: string }) {
  return (
    <div className="px-2 py-3">
      <Icon className="mx-auto h-3.5 w-3.5 text-neutral-400" strokeWidth={1.75} />
      <dd className="mt-1 truncate text-sm font-semibold text-neutral-900">{value}</dd>
      <dt className="text-[11px] uppercase tracking-wider text-neutral-500">{label}</dt>
    </div>
  );
}
