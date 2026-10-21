'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import {
  ArrowDownWideNarrow, BadgeDollarSign, CalendarClock, Clock, Lock, MessageSquare, PackageCheck, Plane, Search, ShieldAlert,
  type LucideIcon,
} from 'lucide-react';
import { formatUSD } from '@/lib/format';
import { filterPipeline, laneCounts, laneOf, LANES, type PipelineLane, type PipelineOrder, type PipelineSort } from '@/lib/supplier-pipeline';

/** Unpaid orders never reach suppliers (RLS, migration 018), so the "Awaiting payment" lane is not shown. */
const SUPPLIER_LANES = LANES.filter((l) => l.id !== 'awaiting');

export interface FulfilmentOrder extends PipelineOrder {
  batches: number;
  current_status: string | null;
  eta_timestamp: string | null;
}

const LANE_ICON: Record<PipelineLane, LucideIcon> = {
  awaiting: Clock, escrow: Lock, transit: Plane, verify: PackageCheck, completed: BadgeDollarSign, issue: ShieldAlert,
};

/**
 * Live fulfilment pipeline: every order on the supplier's products as a status
 * card, filterable by lane, searchable and sortable. Read-only — escrow and
 * shipment states change through payments, logistics and buyer verification.
 */
export default function FulfilmentPipeline({ orders }: { orders: FulfilmentOrder[] }) {
  const [lane, setLane] = useState<PipelineLane | 'all'>('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<PipelineSort>('newest');
  const counts = useMemo(() => laneCounts(orders), [orders]);
  const shown = useMemo(() => filterPipeline(orders, lane, query, sort), [orders, lane, query, sort]);

  const chip = (active: boolean) => clsx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition active:scale-95',
    active ? 'border-blue-500 bg-blue-600 text-snow shadow-[0_6px_18px_-8px_rgb(59_130_246/0.8)]' : 'border-neutral-200 bg-white text-neutral-700 hover:border-neutral-400');

  return (
    <section id="pipeline" aria-labelledby="pipeline-title" className="scroll-mt-24">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="pipeline-title" className="text-lg font-semibold text-neutral-900">Fulfilment pipeline</h2>
          <p className="text-sm text-neutral-500">Every Trial Batch order on your products, from payment to payout.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" aria-hidden />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Product or order #" aria-label="Search orders" className="input w-52 py-2 pl-9" />
          </div>
          <label className="relative">
            <span className="sr-only">Sort orders</span>
            <ArrowDownWideNarrow className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" aria-hidden />
            <select value={sort} onChange={(e) => setSort(e.target.value as PipelineSort)} className="input w-auto py-2 pl-9">
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="value">Highest value</option>
            </select>
          </label>
        </div>
      </div>

      <div role="group" aria-label="Filter by stage" className="no-scrollbar mt-4 flex gap-2 overflow-x-auto pb-1">
        <button type="button" aria-pressed={lane === 'all'} onClick={() => setLane('all')} className={chip(lane === 'all')}>All <span className="tabular-nums opacity-70">{orders.length}</span></button>
        {SUPPLIER_LANES.map((l) => {
          const Icon = LANE_ICON[l.id];
          return (
            <button key={l.id} type="button" aria-pressed={lane === l.id} onClick={() => setLane(l.id)} className={chip(lane === l.id)}>
              <Icon className="h-3.5 w-3.5" aria-hidden /> {l.label} <span className="tabular-nums opacity-70">{counts[l.id]}</span>
            </button>
          );
        })}
      </div>

      {shown.length === 0 ? (
        <p className="card mt-4 px-5 py-10 text-center text-sm text-neutral-500">
          {orders.length === 0 ? 'No orders yet — they appear here as soon as a buyer checks out.' : 'No orders match this filter.'}
        </p>
      ) : (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-live="polite">
          {shown.map((o) => {
            const meta = LANES.find((l) => l.id === laneOf(o.escrow_status))!;
            const Icon = LANE_ICON[meta.id];
            return (
              <li key={o.id} className="card card-lift glow-hover group p-4 motion-safe:animate-fade-up">
                <div className="flex items-start justify-between gap-3">
                  <span className={clsx('grid h-9 w-9 shrink-0 place-items-center rounded-lg border', meta.tone)}><Icon className="h-4 w-4" aria-hidden /></span>
                  <span className={clsx('pill', meta.tone)}>{meta.label}</span>
                </div>
                <p className="mt-3 truncate font-medium text-neutral-900">{o.product_title}</p>
                <p className="mt-0.5 text-xs text-neutral-500">
                  <span className="font-mono">#{o.id.slice(0, 8).toUpperCase()}</span> · {o.batches} batch{o.batches === 1 ? '' : 'es'} ·{' '}
                  {new Date(o.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                </p>
                <div className="mt-3 flex items-end justify-between gap-2 border-t border-neutral-200 pt-3">
                  <div className="text-xs text-neutral-500">
                    {o.current_status && meta.id !== 'awaiting' ? (
                      <p className="capitalize">{o.current_status.replace(/_/g, ' ')}</p>
                    ) : <p>{meta.hint}</p>}
                    {o.eta_timestamp && (meta.id === 'transit' || meta.id === 'escrow') && (
                      <p className="mt-0.5 flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" aria-hidden />
                        ETA {new Date(o.eta_timestamp).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</p>
                    )}
                  </div>
                  <p className="text-sm font-semibold tabular-nums text-neutral-900">{formatUSD(o.total_cents, true)}</p>
                </div>
                <Link href="/supplier/messages" className="mt-3 inline-flex translate-y-1 items-center gap-1.5 text-xs font-medium text-blue-600 opacity-80 transition group-hover:translate-y-0 group-hover:opacity-100 focus-visible:translate-y-0 focus-visible:opacity-100 dark:text-blue-400">
                  <MessageSquare className="h-3.5 w-3.5" aria-hidden /> Buyer messages
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
