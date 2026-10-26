import Link from 'next/link';
import Image from 'next/image';
import clsx from 'clsx';
import {
  AlertTriangle, ArrowRight, BadgeCheck, Check, CircleDashed, FileQuestion, Lightbulb, Lock, Megaphone, Package, Plane,
  ShoppingBag, Truck, UserCheck, Users, type LucideIcon,
} from 'lucide-react';
import type { OrderType, OrderView, Profile, TrialProductView } from '@/lib/types';
import { flag, formatUSD } from '@/lib/format';
import { UUID_RE } from '@/lib/uploads';
import {
  escrowPipeline, orderPill, SHIPMENT_STAGES, shipmentStage, summarizeOrders, trackedOrder, type PillTone,
} from '@/lib/buyer-dashboard';
import { Panel, ViewAll } from '@/components/supplier/sellsy/ui';
import MessageSupplierButton from '@/components/chat/MessageSupplierButton';
import FollowButton from '@/components/follow/FollowButton';
import FxTicker from './command/FxTicker';
import LandedCalculator from './command/LandedCalculator';
import QuickChips from './command/QuickChips';
import HelpDesk from './command/HelpDesk';

export interface RfqAlert { id: string; title: string; quotes: number; expiresAt: string }
export interface Notice { tone: 'amber' | 'mint'; text: string; href?: string; cta?: string }

const PILL: Record<PillTone, string> = {
  mint: 'sx-pill-mint', blue: 'sx-pill-blue', amber: 'sx-pill-amber', rose: 'sx-pill-rose', muted: 'sx-pill-muted',
};
const TYPE_ICON: Record<OrderType, LucideIcon> = { trial: Plane, pool: Users, standard: ShoppingBag };
const TYPE_LABEL: Record<OrderType, string> = { trial: 'Trial Batch', pool: 'Trend Pool', standard: 'Order' };
const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
/** Sample orders (non-UUID ids) have no page to open. */
const orderHref = (id: string) => (UUID_RE.test(id) ? `/dashboard/orders/${id}` : null);

/**
 * Buyer command centre (Sellsy layout, 3 / 6 / 3 on wide screens), built from rows the dashboard already
 * loaded plus the buyer's own RFQ list:
 *  - left: welcome + escrow balance, active orders, quick-action chips, profile status;
 *  - centre: escrow journey bar, shipment tracking, RFQ activity, followed-supplier carousel, recent orders;
 *  - right: FX rates, landed-cost estimator, trade insights, platform notices, escrow help desk.
 * `orders` are the buyer's newest paid orders (the dashboard loads up to 20).
 */
export default function BuyerOverview({ profile, orders, feed, following, rfqs, insights, notices, freightShare }: {
  profile: Profile; orders: OrderView[]; feed: TrialProductView[]; following: number | null;
  /** Open RFQs with their quote counts; null before the RFQ tables exist. */
  rfqs: RfqAlert[] | null;
  insights: { label: string; value: string }[];
  notices: Notice[];
  freightShare: Record<string, number>;
}) {
  const s = summarizeOrders(orders);
  const pipeline = escrowPipeline(orders);
  const pipelineTotal = pipeline.reduce((n, p) => n + p.count, 0);
  const tracked = trackedOrder(orders);
  const stage = tracked ? shipmentStage(tracked.escrow_status) ?? 0 : 0;
  const recent = orders.slice(0, 6);

  const status: { ok: boolean; label: string; href: string }[] = [
    { ok: profile.kyc_status === 'approved' || (!profile.kyc_status && profile.kyc_verified), label: 'Business verified (KYC)', href: '/dashboard/kyc' },
    ...(profile.bio !== undefined ? [{ ok: !!profile.bio, label: 'Bio on your public profile', href: '/dashboard/settings?tab=profile' }] : []),
    { ok: !!profile.avatar_url, label: 'Profile photo', href: '/dashboard/settings?tab=profile' },
    { ok: !!profile.two_factor_enabled, label: 'Two-factor sign-in', href: '/dashboard/settings?tab=security' },
  ];
  const done = status.filter((x) => x.ok).length;

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-12">
      {/* ── Left: metrics & actions ───────────────────────────────────── */}
      <div className="flex flex-col gap-6 md:col-span-1 lg:col-span-3">
        <Panel title="Held in escrow">
          <p className="sx-stat mt-5">{formatUSD(s.heldCents)}</p>
          <p className="mt-3 flex items-center gap-1.5 text-xs text-neutral-500">
            <Lock className="h-3.5 w-3.5 text-[#8fd3cc]" aria-hidden />
            Released only after you verify the goods{s.depositOrders > 0 ? ` · ${s.depositOrders} on a 30% deposit` : ''}
          </p>
          <p className="mt-2 text-xs text-neutral-500">Total ordered <span className="tabular-nums text-neutral-800">{formatUSD(s.orderedCents)}</span></p>
        </Panel>

        <Panel title="Active orders" action={<ViewAll href="/dashboard/orders" />}>
          <p className="sx-stat mt-5">{s.active}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {s.inTransit > 0 && <span className="sx-pill sx-pill-blue"><Truck className="h-3 w-3" aria-hidden /> {s.inTransit} in transit</span>}
            {s.needsAction > 0
              ? <span className="sx-pill sx-pill-amber">{s.needsAction} need{s.needsAction === 1 ? 's' : ''} you</span>
              : <span className="sx-pill sx-pill-muted">Nothing waiting on you</span>}
          </div>
        </Panel>

        <Panel title="Quick actions">
          <div className="mt-4"><QuickChips orders={orders.length} openRfqs={rfqs?.length ?? null} /></div>
        </Panel>

        <Panel title="Profile status" action={<span className="sx-pill sx-pill-muted tabular-nums">{done}/{status.length}</span>}>
          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-snow/[0.06]" aria-hidden>
            <div className="h-full rounded-full bg-gradient-to-r from-[#5a9895] to-teal-300" style={{ width: `${(done / status.length) * 100}%` }} />
          </div>
          <ul className="mt-4 space-y-2">
            {status.map(({ ok, label, href }) => (
              <li key={label}>
                <Link href={href} className="flex items-center gap-2.5 rounded-xl px-1 py-1 text-sm hover:bg-snow/[0.04]">
                  {ok ? <Check className="h-4 w-4 shrink-0 text-[#8fd3cc]" aria-hidden /> : <CircleDashed className="h-4 w-4 shrink-0 text-neutral-500" aria-hidden />}
                  <span className={ok ? 'text-neutral-700' : 'text-neutral-900'}>{label}</span>
                  <span className="sr-only">{ok ? '(done)' : '(to do)'}</span>
                  {!ok && <ArrowRight className="ml-auto h-3.5 w-3.5 text-neutral-500" aria-hidden />}
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      {/* ── Centre: logistics & activity ──────────────────────────────── */}
      <div className="flex min-w-0 flex-col gap-6 md:col-span-2 md:row-start-1 lg:col-span-6 lg:col-start-4">
        <Panel title="Escrow journey" action={<span className="text-xs text-neutral-500">{pipelineTotal} order{pipelineTotal === 1 ? '' : 's'}</span>}>
          <ol className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Orders by escrow stage">
            {pipeline.map((p, i) => (
              <li key={p.label} className="relative">
                <div className={clsx('h-1.5 rounded-full', p.count ? 'bg-gradient-to-r from-[#5a9895] to-teal-300' : 'bg-snow/[0.08]')} aria-hidden />
                <p className="mt-3 flex items-center gap-1.5 text-xs text-neutral-500"><span className="tabular-nums">0{i + 1}</span> {p.label}</p>
                <p className="mt-1 text-2xl font-normal tabular-nums text-neutral-900">{p.count}</p>
                <p className="text-xs tabular-nums text-neutral-500">{formatUSD(p.cents)}</p>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-xs text-neutral-500">Money moves to the supplier only at the last step, after you verify the goods.</p>
        </Panel>

        <div className="grid gap-6 xl:grid-cols-2">
          <Panel title="Shipment tracking" action={tracked && orderHref(tracked.id) ? <ViewAll href={orderHref(tracked.id)!}>Open order</ViewAll> : undefined}>
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

          <Panel title="RFQ activity" action={<ViewAll href="/dashboard/rfqs" />}>
            {rfqs === null ? (
              <p className="mt-6 text-sm text-neutral-500">Requests for quote aren’t available yet.</p>
            ) : rfqs.length === 0 ? (
              <p className="mt-6 flex items-start gap-2 text-sm text-neutral-500">
                <FileQuestion className="mt-0.5 h-4 w-4 shrink-0 text-[#8fd3cc]" aria-hidden />
                No open requests. Need a volume that isn’t listed? <Link href="/dashboard/rfqs" className="text-neutral-900 underline underline-offset-4">Post an RFQ</Link>
              </p>
            ) : (
              <ul className="mt-4 divide-y divide-snow/[0.06]">
                {rfqs.slice(0, 4).map((r) => (
                  <li key={r.id} className="flex items-center gap-3 py-2.5">
                    <span className="min-w-0 flex-1">
                      <Link href="/dashboard/rfqs" className="block truncate text-sm font-medium text-neutral-900 hover:underline">{r.title}</Link>
                      <span className="block text-xs text-neutral-500">Open until {shortDate(r.expiresAt)}</span>
                    </span>
                    <span className={clsx('sx-pill', r.quotes ? 'sx-pill-mint' : 'sx-pill-muted')}>{r.quotes ? `${r.quotes} quote${r.quotes === 1 ? '' : 's'}` : 'Awaiting quotes'}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <Panel title="From suppliers you follow" action={<ViewAll href={following === null ? '/dashboard/discover' : '/dashboard/following'} />}>
          {feed.length > 0 ? (
            // Horizontal carousel: swipe / scroll, snaps per card.
            <ul className="no-scrollbar -mx-5 mt-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-5 pb-1 sm:-mx-6 sm:px-6" aria-label="Newest listings from suppliers you follow">
              {feed.slice(0, 10).map((p) => (
                <li key={p.id} className="w-56 shrink-0 snap-start rounded-2xl border border-snow/[0.08] bg-snow/[0.03] p-3">
                  <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-snow/[0.06]">
                    {p.image_url
                      ? <Image src={p.image_url} alt="" fill sizes="224px" className="object-cover" />
                      : <span className="grid h-full place-items-center text-neutral-500"><Package className="h-6 w-6" aria-hidden /></span>}
                    <span className="sx-pill absolute left-2 top-2 bg-[#050505]/75 text-snow backdrop-blur-md">{p.trial_units.toLocaleString('en-US')} units</span>
                  </div>
                  <p className="mt-3 truncate text-sm font-medium text-neutral-900" title={p.title}>{p.title}</p>
                  <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-neutral-500">
                    {flag(p.origin_country)} {p.supplier_name}
                    {p.supplier_verified && <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-[#8fd3cc]" aria-label="Verified" />}
                  </p>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold tabular-nums text-neutral-900">{formatUSD(p.landed_cost_cents)}</span>
                    {p.lead_time_days ? <span className="text-[11px] text-neutral-500">Ships in {p.lead_time_days} d</span> : null}
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <MessageSupplierButton productId={p.id} productTitle={p.title} disabled={p.is_demo} variant="link" className="text-xs" />
                    {p.supplier_id && <FollowButton supplierId={p.supplier_id} supplierName={p.supplier_name} isDemo={p.is_demo} size="sm" initialFollowing />}
                  </div>
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

        <Panel title="Recent orders" action={<ViewAll href="/dashboard/orders" />}>
          {recent.length > 0 ? (
            <div className="-mx-5 mt-4 overflow-x-auto sm:-mx-6">
              <table className="sx-table min-w-[34rem]">
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

      {/* ── Right: market intelligence & help ─────────────────────────── */}
      <div className="flex flex-col gap-6 md:col-span-1 lg:col-span-3">
        <FxTicker />
        <LandedCalculator freightShare={freightShare} />

        <Panel title="Trade insights">
          <dl className="mt-4 space-y-3">
            {insights.map(({ label, value }) => (
              <div key={label} className="flex items-start gap-2.5">
                <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-[#8fd3cc]" aria-hidden />
                <div><dt className="text-xs text-neutral-500">{label}</dt><dd className="text-sm font-medium text-neutral-900">{value}</dd></div>
              </div>
            ))}
          </dl>
        </Panel>

        <Panel title="Platform notices">
          <ul className="mt-4 space-y-2">
            {notices.map((n) => (
              <li key={n.text} className={clsx('flex items-start gap-2.5 rounded-2xl px-3 py-2.5 text-sm', n.tone === 'amber' ? 'bg-amber-400/10 text-amber-200' : 'bg-[#5a9895]/10 text-neutral-800')}>
                {n.tone === 'amber' ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <Megaphone className="mt-0.5 h-4 w-4 shrink-0 text-[#8fd3cc]" aria-hidden />}
                <span>{n.text}{n.href && <> <Link href={n.href} className="underline underline-offset-4">{n.cta ?? 'Open'}</Link></>}</span>
              </li>
            ))}
          </ul>
        </Panel>

        <HelpDesk />
      </div>
    </div>
  );
}
