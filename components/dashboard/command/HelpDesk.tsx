'use client';

import Link from 'next/link';
import clsx from 'clsx';
import { CircleHelp, Headphones, LifeBuoy, ShieldAlert } from 'lucide-react';
import { openSupport } from '@/lib/support-events';

/** Escrow & dispute help desk shortcuts: they open the floating support widget, or the orders list where disputes start. */
export default function HelpDesk({ className }: { className?: string }) {
  const cls = 'press flex w-full items-center gap-3 rounded-2xl border border-snow/10 bg-snow/[0.03] p-3 text-left text-sm transition-colors hover:border-snow/25 hover:bg-snow/[0.06] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5a9895]';
  return (
    <section aria-labelledby="helpdesk-title" className={clsx('sx-card p-5', className)}>
      <h2 id="helpdesk-title" className="sx-card-title flex items-center gap-2"><LifeBuoy className="h-4 w-4 text-[#8fd3cc]" aria-hidden /> Escrow help desk</h2>
      <div className="mt-4 space-y-2">
        <button type="button" onClick={() => openSupport({ tab: 'chat' })} className={cls}>
          <Headphones className="h-4 w-4 shrink-0 text-[#8fd3cc]" aria-hidden />
          <span><span className="block font-medium text-neutral-900">Talk to trade support</span><span className="block text-xs text-neutral-500">Live chat about any order</span></span>
        </button>
        <Link href="/dashboard/orders" className={cls}>
          <ShieldAlert className="h-4 w-4 shrink-0 text-amber-300" aria-hidden />
          <span><span className="block font-medium text-neutral-900">Raise a dispute</span><span className="block text-xs text-neutral-500">From the order, before you release funds</span></span>
        </Link>
        <button type="button" onClick={() => openSupport({ tab: 'help' })} className={cls}>
          <CircleHelp className="h-4 w-4 shrink-0 text-[#8fd3cc]" aria-hidden />
          <span><span className="block font-medium text-neutral-900">How escrow works</span><span className="block text-xs text-neutral-500">FAQ: payments, releases, refunds</span></span>
        </button>
      </div>
    </section>
  );
}
