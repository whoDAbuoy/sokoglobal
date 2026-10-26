import Link from 'next/link';
import Image from 'next/image';
import clsx from 'clsx';
import { ArrowRight, Check, Lock, Package, Plane, ShoppingBag, Truck, UserCheck, Users, type LucideIcon } from 'lucide-react';
import type { OrderType, OrderView, TrialProductView } from '@/lib/types';
import { formatUSD } from '@/lib/format';
import { UUID_RE } from '@/lib/uploads';
import { orderPill, SHIPMENT_STAGES, shipmentStage, summarizeOrders, trackedOrder, type PillTone } from '@/lib/buyer-dashboard';
import { Panel, ViewAll } from '@/components/supplier/sellsy/ui';

export interface OverviewAction { href: string; label: string; hint: string; icon: LucideIcon; badge?: number }

const PILL: Record<PillTone, string> = {
  mint: 'sx-pill-mint', blue: 'sx-pill-blue', amber: 'sx-pill-amber', rose: 'sx-pill-rose', muted: 'sx-pill-muted',
};
const TYPE_ICON: Record<OrderType, LucideIcon> = { trial: Plane, pool: Users, standard: ShoppingBag };
const TYPE_LABEL: Record<OrderType, string> = { trial: 'Trial Batch', pool: 'Trend Pool', standard: 'Order' };
const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
/** Sample orders (non-UUID ids) have no page to open. */
const orderHref = (id: string) => (UUID_RE.test(id) ? `/dashboard/orders/${id}` : null);

/**
 * Buyer overview (Sellsy layout), built only from rows the dashboard already loaded:
 * top row = active orders · escrow / total ordered · quick actions; middle = followed suppliers'
 * newest listings · shipment preview; bottom = recent orders table.
 * `orders` are the buyer's newest paid orders (the dashboard loads up to 20).
 */
export default function BuyerOverview({ orders, feed, following, actions }: {
  orders: OrderView[]; feed: TrialProductView[]; following: number | null; actions: OverviewAction[];
}) {
  const s = summarizeOrders(orders);
  const tracked = trackedOrder(orders);
  const stage = tracked ? shipmentStage(tracked.escrow_status) ?? 0 : 0;
  const recent = orders.slice(0, 6);

  return (
    <div className="space-y-4">
      {/* Top row: two stat cards + quick actions (asymmetric 4 / 4 / 4 → 3 / 3 / 6 on wide screens). */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-12">
        <Panel title="Active orders" action={<ViewAll href="/dashboard/orders" />} className="xl:col-span-3">
          <p className="sx-stat mt-6">{s.active}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {s.inTransit > 0 && <span className="sx-pill sx-pill-blue"><Truck className="h-3 w-3" aria-hidden /> {s.inTransit} in transit</span>}
            {s.needsAction > 0
              ? <span className="sx-pill sx-pill-amber">{s.needsAction} need{s.needsAction === 1 ? 's' : ''} you</span>
              : <span className="sx-pill sx-pill-muted">Nothing waiting on you</span>}
          </div>
        </Panel>

        <Panel title="Held in escrow" className="xl:col-span-3">
          <p className="sx-stat mt-6">{formatUSD(s.heldCents)}</p>
          <p className="mt-4 flex items-center gap-1.5 text-xs text-neutral-500">
            <Lock className="h-3.5 w-3.5 text-[#8fd3cc]" aria-hidden />
            Released only after you verify the goods{s.depositOrders > 0 ? ` · ${s.depositOrders} on a 30% deposit` : ''}
          </p>
          <p className="mt-2 text-xs text-neutral-500">Total ordered <span className="tabular-nums text-neutral-800">{formatUSD(s.orderedCents)}</span></p>
        </Panel>

        <Panel title="Quick actions" className="md:col-span-2 xl:col-span-6">
          <nav aria-label="Quick actions" className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {actions.map(({ href, label, hint, icon: Icon, badge }) => (
              <Link key={href + label} href={href}
                className="press group flex items-center gap-3 rounded-2xl border border-snow/5 bg-snow/[0.03] p-3 transition-colors hover:border-snow/15 hover:bg-snow/[0.06] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5a9895]">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#5a9895]/20 text-[#8fd3cc]"><Icon className="h-4 w-4" strokeWidth={1.75} aria-hidden /></span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-neutral-900">{label}</span>
                  <span className="block truncate text-xs text-neutral-500">{hint}</span>
                </span>
                {badge ? <span className="sx-pill sx-pill-mint ml-auto px-2 py-0.5">{badge > 99 ? '99+' : badge}</span> : null}
              </Link>
            ))}
          </nav>
        </Panel>
      </div>

      {/* Middle row: followed suppliers' feed + shipment preview (7 / 5). */}
      <div className="grid gap-4 xl:grid-cols-12">
        <Panel title="From suppliers you follow" action={<ViewAll href={following === null ? '/dashboard/discover' : '/dashboard#following'} />} className="xl:col-span-7">
          {feed.length > 0 ? (
            <ul className="mt-4 divide-y divide-snow/[0.06]">
              {feed.slice(0, 4).map((p) => (
                <li key={p.id} className="flex items-center gap-3 py-3">
                  <span className="sx-thumb h-11 w-11 rounded-2xl">
                    {p.image_url
                      ? <Image src={p.image_url} alt="" width={44} height={44} className="h-full w-full object-cover" />
                      : <Package className="h-4 w-4" aria-hidden />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-neutral-900">{p.title}</span>
                    <span className="block truncate text-xs text-neutral-500">{p.supplier_name}</span>
                  </span>
                  <span className="text-sm tabular-nums text-neutral-800">{formatUSD(p.landed_cost_cents)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-6 flex items-start gap-2 text-sm text-neutral-500">
              <UserCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#8fd3cc]" aria-hidden />
              {following
                ? 'The suppliers you follow have no live listings right now. New ones will appear here.'
                : 'Tap Follow next to a supplier’s name on any Trial Batch, and their new listings will show up here.'}
            </p>
          )}
        </Panel>

        <Panel title="Shipment tracking" action={tracked && orderHref(tracked.id) ? <ViewAll href={orderHref(tracked.id)!}>Open order</ViewAll> : undefined} className="xl:col-span-5">
          {tracked ? (
            <>
              <p className="mt-4 truncate text-sm text-neutral-700">{tracked.product_title}</p>
              <ol className="mt-5 space-y-3" aria-label="Shipment progress">
                {SHIPMENT_STAGES.map((label, i) => {
                  const state = i + 1 < stage ? 'done' : i + 1 === stage ? 'current' : 'upcoming';
                  return (
                    <li key={label} className="flex items-center gap-3" aria-current={state === 'current' ? 'step' : undefined}>
                      <span className={clsx('grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px]',
                        state === 'done' ? 'bg-[#5a9895] text-snow' : state === 'current' ? 'bg-teal-400/15 text-[#8fd3cc] ring-2 ring-teal-400' : 'bg-snow/[0.06] text-neutral-500')}>
                        {state === 'done' ? <Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden /> : i + 1}
                      </span>
                      <span className={clsx('text-sm', state === 'upcoming' ? 'text-neutral-500' : 'text-neutral-900', state === 'current' && 'font-medium')}>
                        {label}<span className="sr-only">{state === 'done' ? ' (done)' : state === 'current' ? ' (current)' : ''}</span>
                      </span>
                    </li>
                  );
                })}
              </ol>
            </>
          ) : (
            <p className="mt-6 flex items-start gap-2 text-sm text-neutral-500">
              <Truck className="mt-0.5 h-4 w-4 shrink-0 text-[#8fd3cc]" aria-hidden />
              No shipments in flight. Paid orders appear here from escrow to your door.
            </p>
          )}
        </Panel>
      </div>

      {/* Bottom row: recent orders table. */}
      <Panel title="Recent orders" action={<ViewAll href="/dashboard/orders" />}>
        {recent.length > 0 ? (
          <div className="-mx-5 mt-4 overflow-x-auto sm:-mx-6">
            <table className="sx-table min-w-[36rem]">
              <thead>
                <tr><th scope="col">Order</th><th scope="col">Date</th><th scope="col">Status</th><th scope="col" className="text-right">Total</th></tr>
              </thead>
              <tbody>
                {recent.map((o) => {
                  const Icon = TYPE_ICON[o.order_type] ?? ShoppingBag;
                  const pill = orderPill(o.escrow_status);
                  const href = orderHref(o.id);
                  return (
                    <tr key={o.id}>
                      <td>
                        <span className="flex items-center gap-3">
                          <span className="sx-thumb" title={TYPE_LABEL[o.order_type]}><Icon className="h-4 w-4" aria-hidden /></span>
                          <span className="min-w-0">
                            {href
                              ? <Link href={href} className="block max-w-[18rem] truncate font-medium text-neutral-900 hover:underline">{o.product_title}</Link>
                              : <span className="block max-w-[18rem] truncate font-medium text-neutral-900">{o.product_title}</span>}
                            <span className="block text-xs text-neutral-500">{TYPE_LABEL[o.order_type]}</span>
                          </span>
                        </span>
                      </td>
                      <td className="whitespace-nowrap text-neutral-600">{shortDate(o.created_at)}</td>
                      <td><span className={clsx('sx-pill', PILL[pill.tone])}>{pill.label}</span></td>
                      <td className="text-right tabular-nums">{formatUSD(o.total_cents)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-6 text-sm text-neutral-500">
            No paid orders yet. <Link href="/dashboard#batches" className="inline-flex items-center gap-1 text-neutral-900 underline underline-offset-4">Start with a Trial Batch <ArrowRight className="h-3.5 w-3.5" aria-hidden /></Link>
          </p>
        )}
      </Panel>
    </div>
  );
}
