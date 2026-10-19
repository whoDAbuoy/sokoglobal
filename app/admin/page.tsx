import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import clsx from 'clsx';
import {
  AlertTriangle, ArrowRight, BadgeDollarSign, ChevronLeft, ChevronRight, Clock, Headphones, Lock,
  Repeat, RotateCcw, Search, ShieldCheck, ShoppingBag, Smartphone, CreditCard, TrendingUp, Truck,
} from 'lucide-react';
import { getSessionProfile } from '@/lib/supabase/server';
import { formatUSD } from '@/lib/format';
import {
  dailyCounts, escrowSummary, likePattern, pageList, parsePage, percentChange, periodWindows, TXN_FILTERS,
  txnFilterStatuses, txnStatus, paymentMethod, type MetricOrder, type TxnTone,
} from '@/lib/admin-metrics';
import { initials } from '@/lib/admin-inbox';
import type { EscrowStatus } from '@/lib/types';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import { ChangeBadge, CohortDots, KpiCard, MiniBars, MiniStat, Panel, ShareBar } from '@/components/admin/overview/Widgets';
import ProgressGauge from '@/components/admin/overview/ProgressGauge';
import RowActions from '@/components/admin/overview/RowActions';

export const metadata = { title: 'Overview · SokoGlobal Ops', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

const PER_PAGE = 10;
const METRIC_SAMPLE = 2000; // most recent orders used for money / cohort figures
const ACTIVE_SHIPMENT: EscrowStatus[] = ['funded', 'in_transit', 'customs_cleared', 'delivered_pending_verification'];
const TRACKABLE = new Set<string>(ACTIVE_SHIPMENT);

const TONE: Record<TxnTone, string> = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  escrow: 'border-neutral-300 bg-neutral-100 text-neutral-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  danger: 'border-red-200 bg-red-50 text-red-700',
  muted: 'border-neutral-200 bg-white text-neutral-500',
};

const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const DAY_LABEL = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' });

/**
 * Ops overview: escrow money, shipment health, disputes and the latest
 * transactions. Access: role = 'admin' only (404 otherwise). Every query runs
 * as the signed-in admin, so the admin RLS read policies still apply.
 */
export default async function AdminOverviewPage({ searchParams }: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const { supabase, user, profile } = await getSessionProfile();
  if (!user) redirect('/login?redirectTo=/admin');
  if (profile?.role !== 'admin') notFound();

  const params = await searchParams;
  const q = (params.q ?? '').trim().slice(0, 100);
  const status = TXN_FILTERS.some(([v]) => v === params.status) ? params.status! : '';
  const requestedPage = parsePage(params.page);

  const now = new Date();
  const week = periodWindows(now, 7);
  const month = periodWindows(now, 30);
  const head = { count: 'exact' as const, head: true };

  // Transactions table (server-side filter, search and pagination).
  const statuses = txnFilterStatuses(status);
  let txq = supabase
    .from('orders')
    .select(`id, escrow_status, total_cents, created_at, payment_provider, batches,
             product:products ( title ),
             buyer:profiles!orders_buyer_id_fkey${q ? '!inner' : ''} ( full_name, company_name, country_code )`, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range((requestedPage - 1) * PER_PAGE, requestedPage * PER_PAGE - 1);
  if (statuses) txq = txq.in('escrow_status', statuses);
  if (q) txq = txq.ilike('buyer.company_name', likePattern(q));

  const [
    paidNow, paidPrev, disputesNow, disputesPrev, overdue, activeShipments, needsReply, needsReplyPrev,
    liveProducts, pendingRes, metricRes, txRes,
  ] = await Promise.all([
    supabase.from('orders').select('id', head).gte('funded_at', week.current.from),
    supabase.from('orders').select('id', head).gte('funded_at', week.previous.from).lt('funded_at', week.previous.to),
    supabase.from('escrow_events').select('id', head).eq('to_status', 'disputed').gte('created_at', week.current.from),
    supabase.from('escrow_events').select('id', head).eq('to_status', 'disputed').gte('created_at', week.previous.from).lt('created_at', week.previous.to),
    supabase.from('orders').select('id', head).in('escrow_status', ['funded', 'in_transit', 'customs_cleared'])
      .lt('eta_timestamp', now.toISOString()).not('current_status', 'in', '(customs_cleared,out_for_delivery,delivered)'),
    supabase.from('orders').select('id', head).in('escrow_status', ACTIVE_SHIPMENT),
    supabase.from('support_tickets').select('id', head).eq('status', 'open'),
    supabase.from('support_tickets').select('id', head).eq('status', 'open').lt('last_message_at', week.current.from),
    supabase.from('products').select('id', head).eq('status', 'live').is('deleted_at', null),
    supabase.from('products').select('updated_at', { count: 'exact' }).eq('status', 'pending_review').is('deleted_at', null).limit(500),
    supabase.from('orders')
      .select('buyer_id, escrow_status, total_cents, created_at, funded_at, payment_provider, product:products ( category )')
      .order('created_at', { ascending: false }).limit(METRIC_SAMPLE),
    txq,
  ]);

  if (metricRes.error) throw new Error(`Could not load order metrics: ${metricRes.error.message}`);
  if (txRes.error) throw new Error(`Could not load transactions: ${txRes.error.message}`);

  const metricOrders: MetricOrder[] = (metricRes.data ?? []).map((o) => ({
    buyer_id: o.buyer_id, escrow_status: o.escrow_status, total_cents: o.total_cents, created_at: o.created_at,
    funded_at: o.funded_at, payment_provider: o.payment_provider,
    category: one(o.product as unknown as { category: string })?.category ?? null,
  }));
  const inWindow = (o: MetricOrder, w: { from: string; to: string }) => !!o.funded_at && o.funded_at >= w.from && o.funded_at < w.to;
  const all = escrowSummary(metricOrders);
  const thisMonth = escrowSummary(metricOrders.filter((o) => inWindow(o, month.current)));
  const lastMonth = escrowSummary(metricOrders.filter((o) => inWindow(o, month.previous)));
  const truncated = (metricRes.data ?? []).length === METRIC_SAMPLE;

  const days = Array.from({ length: 7 }, (_, i) => DAY_LABEL.format(new Date(now.getTime() - (6 - i) * 86_400_000)));
  const paidPerDay = dailyCounts(metricOrders.map((o) => o.funded_at), now);
  const submittedPerDay = dailyCounts((pendingRes.data ?? []).map((p) => p.updated_at as string), now);

  const c = (r: { count: number | null }) => r.count ?? 0;
  const disputesOpen = metricOrders.filter((o) => o.escrow_status === 'disputed').length;

  // Transactions
  const total = txRes.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  const page = Math.min(requestedPage, totalPages);
  const rows = txRes.data ?? [];
  const href = (p: number) => {
    const sp = new URLSearchParams();
    if (q) sp.set('q', q);
    if (status) sp.set('status', status);
    if (p > 1) sp.set('page', String(p));
    const s = sp.toString();
    return `/admin${s ? `?${s}` : ''}#transactions`;
  };

  const methodIcon = (kind: string) => (kind === 'mpesa' ? Smartphone : kind === 'card' ? CreditCard : BadgeDollarSign);
  const methodTotal = thisMonth.byMethod.reduce((s, m) => s + m.cents, 0);

  return (
    <>
      <DashboardHeader profile={profile} />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Internal · Operations</p>
            <h1 className="mt-2 text-3xl font-semibold text-neutral-900">Overview</h1>
            <p className="mt-1 text-sm text-neutral-500">Escrow, shipments, disputes and support at a glance.</p>
          </div>
          <Link href="/admin/review" className="btn-secondary py-2 text-sm">
            Review queue <span className="tabular-nums text-neutral-500">({pendingRes.count ?? 0})</span> <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>

        {/* KPI row */}
        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard icon={ShoppingBag} value={c(paidNow)} label="Orders paid into escrow">
            <ChangeBadge change={percentChange(c(paidNow), c(paidPrev))} current={c(paidNow)} />
          </KpiCard>
          <KpiCard icon={AlertTriangle} value={c(disputesNow)} label="Disputes opened">
            <ChangeBadge change={percentChange(c(disputesNow), c(disputesPrev))} current={c(disputesNow)} goodWhenUp={false} />
          </KpiCard>
          <KpiCard icon={Clock} value={c(overdue)} label="Overdue shipments">
            <p className="mt-1 text-xs text-neutral-500"><span className="font-semibold tabular-nums text-neutral-700">{c(activeShipments)}</span> active in escrow</p>
          </KpiCard>
          <KpiCard icon={Headphones} value={c(needsReply)} label="Tickets needing a reply">
            <p className="mt-1 text-xs text-neutral-500">
              <span className={clsx('font-semibold tabular-nums', c(needsReplyPrev) > 0 ? 'text-amber-700' : 'text-neutral-700')}>{c(needsReplyPrev)}</span> waiting over a week
            </p>
          </KpiCard>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          {/* Left column */}
          <div className="grid gap-4">
            <Panel>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-neutral-900">Catalogue insight</h2>
                  <p className="text-xs text-neutral-500">Last 7 days · {days[0]}–{days[6]}</p>
                </div>
                <Link href="/admin/products" className="text-xs font-medium text-neutral-600 hover:text-neutral-900">Catalogue →</Link>
              </div>
              <div className="mt-4 space-y-4 border-t border-neutral-200 pt-4">
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <p className="text-xs text-neutral-500">Live products</p>
                    <p className="text-2xl font-semibold tabular-nums text-neutral-900">{c(liveProducts).toLocaleString('en-US')}</p>
                    <p className="text-[11px] text-neutral-500">Bars: orders paid per day</p>
                  </div>
                  <MiniBars values={paidPerDay} labels={days} title="Orders paid per day" />
                </div>
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <p className="text-xs text-neutral-500">Awaiting review</p>
                    <p className="text-2xl font-semibold tabular-nums text-neutral-900">{(pendingRes.count ?? 0).toLocaleString('en-US')}</p>
                    <p className="text-[11px] text-neutral-500">Bars: submissions per day</p>
                  </div>
                  <MiniBars values={submittedPerDay} labels={days} muted title="Products submitted per day" />
                </div>
              </div>
            </Panel>

            <Panel>
              <h2 className="font-semibold text-neutral-900">Paid into escrow</h2>
              <div className="mt-3 flex items-baseline gap-2">
                <p className="text-2xl font-semibold tabular-nums text-neutral-900">{formatUSD(thisMonth.gmv)}</p>
                <TrendingUp className="h-4 w-4 text-neutral-500" aria-hidden />
              </div>
              <ChangeBadge change={percentChange(thisMonth.gmv, lastMonth.gmv)} current={thisMonth.gmv}
                suffix={`vs previous 30 days (${formatUSD(lastMonth.gmv)})`} />
              <ul className="mt-5 space-y-4">
                {thisMonth.byMethod.length === 0 && <li className="text-sm text-neutral-500">No payments in the last 30 days.</li>}
                {thisMonth.byMethod.map((m) => {
                  const Icon = methodIcon(m.kind);
                  const pct = methodTotal ? Math.round((m.cents / methodTotal) * 100) : 0;
                  return (
                    <li key={m.label} className="flex items-center gap-3">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-neutral-200 bg-neutral-50">
                        <Icon className="h-4 w-4 text-neutral-700" aria-hidden />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="text-sm font-semibold text-neutral-900">{m.label}</p>
                          <p className="text-sm tabular-nums text-neutral-900">{formatUSD(m.cents)}</p>
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                          <ShareBar pct={pct} label={`${m.label} share of payments`} />
                          <span className="w-16 shrink-0 text-right text-[11px] tabular-nums text-neutral-500">{m.count} · {pct}%</span>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          </div>

          {/* Right column */}
          <Panel className="grid gap-4">
            <div className="grid gap-4 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
              <div>
                <h2 className="font-semibold text-neutral-900">Escrow metrics</h2>
                <div className="mt-4 flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-md bg-neutral-900"><ShieldCheck className="h-5 w-5 text-white" aria-hidden /></span>
                  <div>
                    <p className="font-semibold text-neutral-900">SokoGlobal Escrow</p>
                    <p className="text-xs text-neutral-500">{truncated ? `Latest ${METRIC_SAMPLE.toLocaleString('en-US')} orders` : 'All paid orders'}</p>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <MiniStat icon={Lock} label="Held in escrow" value={formatUSD(all.held)} />
                  <MiniStat icon={BadgeDollarSign} label="Released to suppliers" value={formatUSD(all.released)} />
                  <MiniStat icon={RotateCcw} label="Refunded / cancelled" value={formatUSD(all.refunded)} />
                  <MiniStat icon={Truck} label="Paid orders · avg value" value={`${all.paidCount.toLocaleString('en-US')} · ${formatUSD(all.avgOrder)}`} />
                </div>
              </div>
              <div className="flex flex-col rounded-lg border border-neutral-200 p-4">
                <h3 className="text-sm font-semibold text-neutral-900">Escrow settled</h3>
                <div className="my-3 flex-1">
                  <ProgressGauge pct={all.settledPct} value={formatUSD(all.released)} caption="released" label="Share of escrow value released to suppliers" />
                </div>
                <div className="flex items-baseline justify-between">
                  <p className="text-sm text-neutral-700">Of held + released</p>
                  <p className="text-xl font-semibold tabular-nums text-neutral-900">{all.settledPct}%</p>
                </div>
              </div>
            </div>

            <div className="grid gap-5 rounded-lg border border-neutral-200 p-4 md:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
              <div>
                <h3 className="text-sm font-semibold text-neutral-900">Repeat buyers</h3>
                <p className="mt-3 text-5xl font-light tabular-nums text-neutral-900">{all.repeatPct}%</p>
                <p className="mt-2 text-xs text-neutral-500">Buyers with two or more paid orders</p>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-neutral-900">Buyer cohort</h3>
                <p className="mt-1 text-sm text-neutral-500">How many buyers come back for another paid order after their first.</p>
                <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                  <span className="inline-flex items-center gap-1.5 font-medium text-neutral-900"><Repeat className="h-4 w-4" aria-hidden /> {all.repeatBuyers.toLocaleString('en-US')} repeat</span>
                  <span className="text-neutral-600">{all.buyers.toLocaleString('en-US')} paying buyers</span>
                  <span className="text-neutral-600">{disputesOpen} open disputes</span>
                </div>
                <div className="mt-3"><CohortDots pct={all.repeatPct} label="Repeat buyer rate" /></div>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-neutral-900">Paid value by category</h3>
              <ul className="mt-3 space-y-2.5">
                {all.byCategory.length === 0 && <li className="text-sm text-neutral-500">No paid orders yet.</li>}
                {all.byCategory.slice(0, 5).map((cat) => {
                  const pct = all.gmv ? Math.round((cat.cents / all.gmv) * 100) : 0;
                  return (
                    <li key={cat.category} className="grid grid-cols-[8rem_1fr_5.5rem] items-center gap-3 text-sm">
                      <span className="truncate text-neutral-700">{titleCase(cat.category)}</span>
                      <ShareBar pct={pct} label={`${titleCase(cat.category)} share of paid value`} />
                      <span className="text-right tabular-nums text-neutral-900">{formatUSD(cat.cents)}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </Panel>
        </div>

        {/* Transactions */}
        <section id="transactions" className="mt-4 scroll-mt-24 overflow-hidden rounded-xl border border-neutral-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 px-4 py-3">
            <h2 className="font-semibold text-neutral-900">Transactions</h2>
            <form className="flex flex-1 flex-wrap justify-end gap-2" role="search" action="/admin#transactions">
              <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" aria-hidden />
                <input name="q" defaultValue={q} placeholder="Search buyer company" aria-label="Search buyer company" className="input py-2 pl-9" />
              </div>
              <select name="status" defaultValue={status} aria-label="Status" className="input w-auto py-2">
                {TXN_FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <button className="btn-secondary py-2">Filter</button>
            </form>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-left text-sm">
              <thead className="border-b border-neutral-200 text-xs text-neutral-500">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Customer</th>
                  <th scope="col" className="px-4 py-3 font-medium">Order</th>
                  <th scope="col" className="px-4 py-3 font-medium">Amount</th>
                  <th scope="col" className="px-4 py-3 font-medium">Status</th>
                  <th scope="col" className="px-4 py-3 font-medium">Paid by</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {rows.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-neutral-500">{q || status ? 'No transactions match these filters.' : 'No orders yet.'}</td></tr>
                )}
                {rows.map((o) => {
                  const buyer = one(o.buyer as unknown as { full_name: string; company_name: string; country_code: string });
                  const product = one(o.product as unknown as { title: string });
                  const pill = txnStatus(o.escrow_status as EscrowStatus);
                  const method = paymentMethod(o.payment_provider);
                  return (
                    <tr key={o.id} className="transition-colors hover:bg-neutral-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-neutral-100 text-xs font-semibold text-neutral-700 ring-1 ring-neutral-200">{initials(buyer?.company_name)}</span>
                          <div className="min-w-0">
                            <p className="truncate font-medium text-neutral-900">{buyer?.company_name ?? 'Unknown buyer'}</p>
                            <p className="truncate text-xs text-neutral-500">{buyer?.full_name}{buyer?.country_code ? ` · ${buyer.country_code}` : ''}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <p className="max-w-[14rem] truncate text-neutral-800">{product?.title ?? 'Order'}</p>
                        <p className="text-xs text-neutral-500">#{o.id.slice(0, 8).toUpperCase()} · {new Date(o.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</p>
                      </td>
                      <td className="px-4 py-3 font-medium tabular-nums text-neutral-900">{formatUSD(o.total_cents, true)}</td>
                      <td className="px-4 py-3"><span className={clsx('pill', TONE[pill.tone])}>{pill.label}</span></td>
                      <td className="px-4 py-3">
                        {method.kind === 'none' ? <span className="text-neutral-400">—</span> : (
                          <span className={clsx('inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-semibold',
                            method.kind === 'mpesa' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-neutral-300 bg-white text-neutral-800')}>
                            {(() => { const Icon = methodIcon(method.kind); return <Icon className="h-3.5 w-3.5" aria-hidden />; })()}
                            {method.label}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <RowActions orderId={o.id} productTitle={product?.title ?? null} canTrack={TRACKABLE.has(o.escrow_status)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-200 px-4 py-3 text-xs text-neutral-500">
            <p>
              {total === 0 ? 'Showing 0 entries' : `Showing ${(page - 1) * PER_PAGE + 1} to ${Math.min(page * PER_PAGE, total)} of ${total.toLocaleString('en-US')} entries`}
            </p>
            {totalPages > 1 && (
              <nav aria-label="Transactions pages" className="flex items-center gap-1">
                <PageLink href={href(page - 1)} disabled={page <= 1} label="Previous page"><ChevronLeft className="h-3.5 w-3.5" aria-hidden /> <span className="hidden sm:inline">Previous</span></PageLink>
                {pageList(page, totalPages).map((p, i) => p === '…'
                  ? <span key={`gap-${i}`} className="px-1.5 text-neutral-400" aria-hidden>…</span>
                  : <PageLink key={p} href={href(p)} current={p === page} label={`Page ${p}`}>{p}</PageLink>)}
                <PageLink href={href(page + 1)} disabled={page >= totalPages} label="Next page"><span className="hidden sm:inline">Next</span> <ChevronRight className="h-3.5 w-3.5" aria-hidden /></PageLink>
              </nav>
            )}
          </div>
        </section>
      </main>
    </>
  );
}

function PageLink({ href, current, disabled, label, children }: {
  href: string; current?: boolean; disabled?: boolean; label: string; children: React.ReactNode;
}) {
  const cls = clsx('inline-flex h-7 min-w-7 items-center justify-center gap-1 rounded-md px-2 text-xs font-medium tabular-nums transition-colors',
    current ? 'bg-neutral-900 text-white' : 'text-neutral-700 hover:bg-neutral-100',
    disabled && 'pointer-events-none opacity-40');
  if (disabled) return <span className={cls} aria-disabled="true" aria-label={label}>{children}</span>;
  return <Link href={href} className={cls} aria-label={label} aria-current={current ? 'page' : undefined}>{children}</Link>;
}
