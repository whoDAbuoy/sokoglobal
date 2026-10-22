'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import { AlertCircle, Check, Layers, Loader2, Wallet } from 'lucide-react';
import { chooseStructure } from '@/app/dashboard/orders/[id]/actions';
import { MILESTONE_MIN_CENTS, milestoneSplit, type PaymentStructure } from '@/lib/milestone';
import { formatUSD } from '@/lib/format';
import Price from '@/components/currency/Price';

/**
 * "Pay in full" vs "Milestone escrow (30% upfront / 70% on dispatch)" for an
 * unpaid order. The choice is saved in Postgres before any charge starts, so
 * the payment form below always charges the right leg.
 */
export default function PaymentStructureChooser({ orderId, totalCents, structure, eligible, kycApproved }: {
  orderId: string; totalCents: number; structure: PaymentStructure; eligible: boolean; kycApproved: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<PaymentStructure>(structure);
  const split = milestoneSplit(totalCents);

  function pick(next: PaymentStructure) {
    if (next === selected || pending) return;
    setError(null);
    setSelected(next);
    start(async () => {
      const r = await chooseStructure(orderId, next);
      if (!r.ok) { setError(r.message); setSelected(structure); return; }
      router.refresh();
    });
  }

  const options: { value: PaymentStructure; title: string; icon: typeof Wallet; body: React.ReactNode; disabled?: string }[] = [
    { value: 'full', title: 'Pay in full', icon: Wallet, body: <>Pay <Price cents={totalCents} /> now into escrow.</> },
    {
      value: 'milestone_30_70', title: 'Milestone escrow', icon: Layers,
      body: <><Price cents={split.depositCents} /> deposit now · <Price cents={split.balanceCents} /> when dispatched</>,
      disabled: eligible ? undefined
        : !kycApproved ? 'Available once your business is verified.'
        : `Available on orders from ${formatUSD(MILESTONE_MIN_CENTS)}.`,
    },
  ];

  return (
    <fieldset className="card mt-6 p-5" disabled={pending}>
      <legend className="sr-only">How do you want to pay?</legend>
      <p className="font-medium text-neutral-900">How do you want to pay?</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {options.map((o) => {
          const active = selected === o.value;
          return (
            <label key={o.value}
              className={clsx('relative flex cursor-pointer gap-3 rounded-lg border p-4 text-sm transition-colors',
                active ? 'border-blue-500 bg-blue-500/5 ring-1 ring-blue-500' : 'border-neutral-200 hover:border-neutral-400',
                o.disabled && 'cursor-not-allowed opacity-60 hover:border-neutral-200')}>
              <input type="radio" name="payment-structure" value={o.value} checked={active} disabled={!!o.disabled}
                onChange={() => pick(o.value)} className="sr-only" />
              <o.icon className="mt-0.5 h-5 w-5 shrink-0 text-blue-600 dark:text-cyan-400" aria-hidden />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 font-medium text-neutral-900">
                  {o.title} {active && (pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Check className="h-3.5 w-3.5 text-blue-600" aria-hidden />)}
                </span>
                <span className="mt-0.5 block text-neutral-600">{o.body}</span>
                {o.disabled && <span className="mt-1 block text-xs text-neutral-500">{o.disabled}</span>}
              </span>
            </label>
          );
        })}
      </div>
      {error && <p role="alert" className="mt-3 flex items-center gap-1.5 text-sm text-red-600"><AlertCircle className="h-4 w-4" />{error}</p>}
    </fieldset>
  );
}
