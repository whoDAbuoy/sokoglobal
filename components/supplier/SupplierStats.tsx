import clsx from 'clsx';
import { Archive, BadgeCheck, Ban, Clock, FileEdit, Lock, Package, Store, Wallet, type LucideIcon } from 'lucide-react';
import { formatUSD } from '@/lib/format';
import type { payoutSummary, releaseSplit } from '@/lib/supplier-pipeline';
import GlowCard from '@/components/portal/GlowCard';
import PayoutDial from './PayoutDial';
import type { OrderCounts } from './orderStages';

export interface ProductCounts {
  live: number;
  pending: number;
  draft: number;
  archived: number;
  removed: number;
}

type Metric = { label: string; value: string; icon: LucideIcon; tone: string; sub?: string };

/**
 * Supplier summary: colourful metric tiles (catalogue + orders), the payout
 * dial and the escrow release bar.
 */
export default function SupplierStats({ products, orders, payouts, release }: {
  products: ProductCounts;
  orders: OrderCounts;
  payouts?: ReturnType<typeof payoutSummary>;
  release?: ReturnType<typeof releaseSplit>;
}) {
  const catalogue: Metric[] = [
    { label: 'Live', value: String(products.live), icon: Store, tone: 'tone-escrow' },
    { label: 'Pending review', value: String(products.pending), icon: Clock, tone: 'tone-pending' },
    { label: 'Draft', value: String(products.draft), icon: FileEdit, tone: 'tone-muted' },
  ];
  if (products.archived > 0) catalogue.push({ label: 'Archived', value: String(products.archived), icon: Archive, tone: 'tone-muted' });
  if (products.removed > 0) catalogue.push({ label: 'Removed', value: String(products.removed), icon: Ban, tone: 'tone-danger' });

  const orderStats: Metric[] = [
    { label: 'Total orders', value: String(orders.total), icon: Package, tone: 'tone-active' },
    { label: 'Awaiting payment', value: String(orders.awaiting), icon: Clock, tone: 'tone-pending' },
    { label: 'In escrow', value: String(orders.escrow), icon: Lock, tone: 'tone-transit', sub: formatUSD(orders.escrowCents) },
    { label: 'Completed', value: String(orders.completed), icon: BadgeCheck, tone: 'tone-escrow' },
  ];

  return (
    <section aria-label="Summary" className="mt-8 space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {orderStats.map((m) => <Tile key={m.label} m={m} />)}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr_1fr]">
        <GlowCard className="card p-5">
          <p className="eyebrow">Catalogue</p>
          <dl className="mt-4 grid grid-cols-3 gap-3">
            {catalogue.map(({ label, value, icon: Icon, tone }) => (
              <div key={label}>
                <dd className="flex items-center gap-2 text-2xl font-semibold tabular-nums text-neutral-900">
                  <span className={clsx('grid h-7 w-7 place-items-center rounded-md border', tone)}><Icon className="h-3.5 w-3.5" aria-hidden /></span>
                  {value}
                </dd>
                <dt className="mt-1 text-xs text-neutral-500">{label}</dt>
              </div>
            ))}
          </dl>
        </GlowCard>

        <GlowCard className="card p-5">
          <div className="flex items-center justify-between">
            <p className="eyebrow">Payouts</p>
            <Wallet className="h-4 w-4 text-cyan-600 dark:text-cyan-400" aria-hidden />
          </div>
          {payouts && payouts.total > 0 ? (
            <div className="mt-3 grid grid-cols-[1fr_auto] items-center gap-4">
              <PayoutDial pct={payouts.paidPct} value={formatUSD(payouts.by.succeeded)} caption="paid out" label="Share of payout value received" />
              <ul className="space-y-1.5 text-xs text-neutral-600">
                <li className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden /> {payouts.count.succeeded} paid</li>
                <li className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-cyan-500" aria-hidden /> {payouts.count.processing} processing</li>
                {payouts.count.on_hold > 0 && <li className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden /> {payouts.count.on_hold} on hold</li>}
                {payouts.count.failed > 0 && <li className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-rose-500" aria-hidden /> {payouts.count.failed} failed</li>}
              </ul>
            </div>
          ) : (
            <p className="mt-4 text-sm text-neutral-500">Payouts start when buyers confirm delivery and escrow is released.</p>
          )}
        </GlowCard>

        <GlowCard className="card p-5">
          <p className="eyebrow">Escrow release</p>
          {release && release.released + release.held + release.awaiting > 0 ? (
            <>
              <p className="mt-3 text-2xl font-semibold tabular-nums text-neutral-900">{Math.round(release.releasedPct)}%<span className="ml-1.5 text-sm font-normal text-neutral-500">released</span></p>
              <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-neutral-100" role="img"
                aria-label={`Released ${release.releasedPct}%, held in escrow ${release.heldPct}%, awaiting payment ${release.awaitingPct}%`}>
                <span className="h-full bg-emerald-500 transition-[width] duration-700" style={{ width: `${release.releasedPct}%` }} />
                <span className="h-full bg-cyan-500 transition-[width] duration-700" style={{ width: `${release.heldPct}%` }} />
                <span className="h-full bg-amber-400 transition-[width] duration-700" style={{ width: `${release.awaitingPct}%` }} />
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <div><dt className="flex items-center gap-1 text-neutral-500"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />Released</dt><dd className="font-semibold tabular-nums text-neutral-900">{formatUSD(release.released)}</dd></div>
                <div><dt className="flex items-center gap-1 text-neutral-500"><span className="h-1.5 w-1.5 rounded-full bg-cyan-500" aria-hidden />Held</dt><dd className="font-semibold tabular-nums text-neutral-900">{formatUSD(release.held)}</dd></div>
                <div><dt className="flex items-center gap-1 text-neutral-500"><span className="h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden />Unpaid</dt><dd className="font-semibold tabular-nums text-neutral-900">{formatUSD(release.awaiting)}</dd></div>
              </dl>
            </>
          ) : (
            <p className="mt-4 text-sm text-neutral-500">No order value yet.</p>
          )}
        </GlowCard>
      </div>
    </section>
  );
}

function Tile({ m }: { m: Metric }) {
  const Icon = m.icon;
  return (
    <GlowCard className="card p-4">
      <div className="flex items-center justify-between">
        <span className={clsx('grid h-9 w-9 place-items-center rounded-lg border', m.tone)}><Icon className="h-4 w-4" aria-hidden /></span>
        {m.sub && <span className="text-xs font-medium tabular-nums text-neutral-500">{m.sub}</span>}
      </div>
      <p className="mt-3 text-2xl font-semibold tabular-nums text-neutral-900">{m.value}</p>
      <p className="text-xs text-neutral-500">{m.label}</p>
    </GlowCard>
  );
}
