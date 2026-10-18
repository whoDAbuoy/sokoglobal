import clsx from 'clsx';
import { formatUSD } from '@/lib/format';
import type { OrderCounts } from './orderStages';

export interface ProductCounts {
  live: number;
  pending: number;
  draft: number;
  archived: number;
  removed: number;
}

/** Summary row: catalogue status counts + order/escrow metrics across all of a supplier's products. */
export default function SupplierStats({ products, orders }: { products: ProductCounts; orders: OrderCounts }) {
  const catalogue: { label: string; value: number; dot: string }[] = [
    { label: 'Live', value: products.live, dot: 'bg-emerald-500' },
    { label: 'Pending review', value: products.pending, dot: 'bg-amber-400' },
    { label: 'Draft', value: products.draft, dot: 'bg-neutral-300' },
  ];
  if (products.archived > 0) catalogue.push({ label: 'Archived', value: products.archived, dot: 'bg-neutral-400' });
  if (products.removed > 0) catalogue.push({ label: 'Removed', value: products.removed, dot: 'bg-red-500' });

  const orderStats: { label: string; value: string; accent?: string }[] = [
    { label: 'Total orders', value: String(orders.total) },
    { label: 'Awaiting payment', value: String(orders.awaiting), accent: orders.awaiting ? 'text-amber-700' : undefined },
    { label: 'In escrow', value: String(orders.escrow) },
    { label: 'Completed', value: String(orders.completed), accent: orders.completed ? 'text-emerald-700' : undefined },
  ];

  return (
    <section className="mt-8 grid gap-4 lg:grid-cols-[2fr_3fr]">
      <div className="card p-5">
        <p className="eyebrow">Catalogue</p>
        <dl className="mt-3 grid grid-cols-3 gap-y-4 sm:grid-cols-[repeat(auto-fit,minmax(5.5rem,1fr))]">
          {catalogue.map((s) => (
            <div key={s.label}>
              <dd className="text-2xl font-semibold tabular-nums text-neutral-900">{s.value}</dd>
              <dt className="mt-0.5 flex items-center gap-1.5 text-xs text-neutral-500">
                <span className={clsx('h-1.5 w-1.5 rounded-full', s.dot)} aria-hidden />
                {s.label}
              </dt>
            </div>
          ))}
        </dl>
      </div>

      <div className="card p-5">
        <div className="flex items-baseline justify-between gap-4">
          <p className="eyebrow">Orders</p>
          <p className="text-xs text-neutral-500">
            Held in escrow{' '}
            <span className="text-base font-semibold tabular-nums text-neutral-900">{formatUSD(orders.escrowCents)}</span>
          </p>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-y-4 sm:grid-cols-4">
          {orderStats.map((s) => (
            <div key={s.label}>
              <dd className={clsx('text-2xl font-semibold tabular-nums', s.accent ?? 'text-neutral-900')}>{s.value}</dd>
              <dt className="mt-0.5 text-xs text-neutral-500">{s.label}</dt>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
