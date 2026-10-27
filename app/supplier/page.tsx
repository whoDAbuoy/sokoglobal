import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowUpRight, Crown, FileDown, ImageIcon, PackageCheck, Plus } from 'lucide-react';
import { formatUSD } from '@/lib/format';
import { getSessionProfile } from '@/lib/supabase/server';
import type { EscrowStatus } from '@/lib/types';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import SupportWidget from '@/components/dashboard/SupportWidget';
import SupplierStats, { type ProductCounts } from '@/components/supplier/SupplierStats';
import type { SupplierProduct } from '@/components/supplier/SupplierProductCard';
import { addOrder, emptyCounts, type OrderCounts } from '@/components/supplier/orderStages';
import FulfilmentPipeline, { type FulfilmentOrder } from '@/components/supplier/FulfilmentPipeline';
import { payoutSummary, releaseSplit, type PayoutStatus } from '@/lib/supplier-pipeline';
import { goldState } from '@/lib/pricing';
import GoldBadge from '@/components/supplier/GoldBadge';
import ProductVisual from '@/components/dashboard/ProductVisual';
import RevenueChart from '@/components/supplier/sellsy/RevenueChart';
import OrderHeatmap from '@/components/supplier/sellsy/OrderHeatmap';
import CategoryDonut from '@/components/supplier/sellsy/CategoryDonut';
import { GrowthPill, OrderStatusPill, PageHead, Panel, ViewAll } from '@/components/supplier/sellsy/ui';
import { categoryShares, countSince, dailySeries, growthPct, orderHeatmap, productSales } from '@/lib/supplier-dashboard';

export default async function SupplierHome() {
  const { supabase, user, profile } = await getSessionProfile();
  if (!user || !profile) redirect('/login?redirectTo=/supplier');
  if (profile.role !== 'supplier') redirect('/dashboard');

  // Only paid orders reach suppliers: RLS hides unpaid ones (migration 018). Orders are scoped by an inner join
  // on the listing's supplier (not by RLS alone: a supplier holding a delegated admin grant can read every order),
  // so they load in parallel with the listings instead of after them.
  const orderQuery = () => supabase.from('orders')
    .select('id, product_id, escrow_status, total_cents, goods_cents, created_at, batches, current_status, eta_timestamp, fulfillment_status, product:products!inner ( supplier_id )')
    .eq('product.supplier_id', user.id).order('created_at', { ascending: false });
  const [{ data: productRows }, { data: orderRows }, { data: payoutRows }, { data: goldRow }] = await Promise.all([
    supabase
      .from('products')
      .select('id, title, category, status, trial_goods_cents, trial_landed_cost_cents, deleted_at, deletion_reason, product_media ( id, media_type, public_url, sort_order )')
      .eq('supplier_id', user.id)
      .order('created_at', { ascending: false }),
    orderQuery(),
    supabase.from('payouts').select('id, status, amount_cents, currency, reference, completed_at').eq('supplier_id', user.id).order('created_at', { ascending: false }),
    supabase.from('subscriptions').select('status, current_period_end').eq('user_id', user.id).eq('plan_type', 'gold_supplier').maybeSingle(),
  ]);
  const products = (productRows ?? []) as unknown as SupplierProduct[];
  const gold = goldState(goldRow as { status: string; current_period_end: string | null } | null);
  const orders = (orderRows ?? []) as unknown as {
    id: string; product_id: string; escrow_status: EscrowStatus; total_cents: number; goods_cents: number; created_at: string;
    batches: number | null; current_status: string | null; eta_timestamp: string | null; fulfillment_status?: string;
  }[];
  const toShip = orders.filter((o) => o.fulfillment_status === 'pending_fulfillment' || (!o.fulfillment_status && o.escrow_status === 'funded' && o.current_status === 'awaiting_dispatch')
    || (o.escrow_status === 'deposit_paid' && o.current_status === 'awaiting_dispatch'));
  const readyToShip = { count: toShip.length, goodsCents: toShip.reduce((n, o) => n + (o.goods_cents ?? 0), 0) };
  const titleOf = new Map(products.map((p) => [p.id, p.title]));
  const pipeline: FulfilmentOrder[] = orders.map((o) => ({
    id: o.id, escrow_status: o.escrow_status, total_cents: o.total_cents, created_at: o.created_at,
    product_title: titleOf.get(o.product_id) ?? 'Product', batches: o.batches ?? 1,
    current_status: o.current_status, eta_timestamp: o.eta_timestamp,
  }));
  const payouts = payoutSummary((payoutRows ?? []) as { status: PayoutStatus; amount_cents: number }[]);
  const recentPaid = ((payoutRows ?? []) as { id: string; status: string; amount_cents: number; currency: string; reference: string; completed_at: string | null }[])
    .filter((p) => p.status === 'succeeded').slice(0, 5);
  const release = releaseSplit(orders);

  const totals = emptyCounts();
  const byProduct = new Map<string, OrderCounts>();
  for (const o of orders) {
    addOrder(totals, o.escrow_status, o.total_cents);
    let c = byProduct.get(o.product_id);
    if (!c) byProduct.set(o.product_id, (c = emptyCounts()));
    addOrder(c, o.escrow_status, o.total_cents);
  }

  const productCounts: ProductCounts = { live: 0, pending: 0, draft: 0, archived: 0, removed: 0 };
  for (const p of products) {
    if (p.deleted_at) productCounts.removed += 1;
    else if (p.status === 'live') productCounts.live += 1;
    else if (p.status === 'pending_review') productCounts.pending += 1;
    else if (p.status === 'archived') productCounts.archived += 1;
    else productCounts.draft += 1;
  }

  // ── Sellsy overview read-model: summaries of the rows above (no new queries, no money rules). ──
  const now = new Date();
  const productById = new Map(products.map((p) => [p.id, p]));
  const coverOf = (p: SupplierProduct | undefined) => [...(p?.product_media ?? [])]
    .filter((m) => m.media_type === 'image' && m.public_url).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))[0]?.public_url ?? null;
  const orderDates = orders.map((o) => o.created_at);
  const counted = orders.filter((o) => o.escrow_status !== 'refunded' && o.escrow_status !== 'cancelled');
  // 36 days so the 7-day average is already full on the first of the 30 days drawn.
  const series = dailySeries(counted.map((o) => ({ created_at: o.created_at, cents: o.goods_cents ?? 0 })), now, 36);
  const sales30 = series.slice(6).reduce((n, d) => n + d.cents, 0);
  const salesGrowth = (() => {
    const prev = dailySeries(counted.map((o) => ({ created_at: o.created_at, cents: o.goods_cents ?? 0 })), new Date(now.getTime() - 30 * 86_400_000), 30)
      .reduce((n, d) => n + d.cents, 0);
    return prev > 0 ? Math.round(((sales30 - prev) / prev) * 100) : null;
  })();
  const heat = orderHeatmap(orderDates);
  const shares = categoryShares(counted.map((o) => ({ category: productById.get(o.product_id)?.category ?? 'general', cents: o.goods_cents ?? 0 })));
  const topSales = productSales(orders).slice(0, 5);
  const recent = orders.slice(0, 4);
  // "Low stock" in Sellsy terms: listings that can't sell yet — drafts short of photos first, then drafts, then those in review.
  const photoCount = (p: SupplierProduct) => (p.product_media ?? []).filter((m) => m.media_type === 'image' && m.public_url).length;
  const attention = products.filter((p) => !p.deleted_at && (p.status === 'draft' || p.status === 'pending_review'))
    .map((p) => ({ p, photos: photoCount(p), rank: p.status === 'draft' ? (photoCount(p) < 3 ? 0 : 1) : 2 }))
    .sort((a, b) => a.rank - b.rank).slice(0, 6);
  const shortId = (id: string) => `#${id.slice(0, 6).toUpperCase()}`;

  return (
    <>
      <DashboardHeader profile={profile} />
      <main className="page-wide pb-16 pt-8">
        <PageHead eyebrow="Supplier" title={<>Overview {gold.kind === 'active' && <GoldBadge />}</>}
          actions={<>
            <Link href="/supplier/subscription" className="btn-secondary"><Crown className="h-4 w-4 text-yellow-300" aria-hidden /> {gold.kind === 'active' ? 'Gold membership' : 'Go Gold'}</Link>
            <Link href="/supplier/products/new" className="btn-primary"><Plus className="h-4 w-4" aria-hidden /> New product</Link>
          </>}>
          Products go live after logistics quoting and photo review.
        </PageHead>

        {/* Top row: stat stack · sales spline · order heatmap */}
        <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-12">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:col-span-3 lg:grid-cols-1">
            <Panel as="div" className="flex flex-col justify-between">
              <div className="sx-card-head">
                <h2 className="sx-card-title">Total orders</h2>
                <GrowthPill pct={growthPct(orderDates, now)} />
              </div>
              <div className="mt-4">
                <p className="sx-stat">{totals.total.toLocaleString('en-US')}</p>
                <p className="mt-1 text-xs text-neutral-500">+{countSince(orderDates, now)} orders in the last 30 days</p>
              </div>
            </Panel>
            <Panel as="div" className="flex flex-col justify-between">
              <div className="sx-card-head">
                <h2 className="sx-card-title">Ready to ship</h2>
                {readyToShip.count > 0 && <Link href="/supplier/orders" className="sx-pill sx-pill-mint">Ship <ArrowUpRight className="h-3 w-3" aria-hidden /></Link>}
              </div>
              <div className="mt-4">
                <p className="sx-stat">{readyToShip.count}</p>
                <p className="mt-1 text-xs text-neutral-500">{formatUSD(readyToShip.goodsCents)} goods value paid and held in escrow</p>
              </div>
            </Panel>
          </div>

          <Panel id="revenue" className="lg:col-span-5" title="Goods sales" action={<span className="sx-pill sx-pill-muted">Last 30 days</span>}>
            <div className="mt-3 flex flex-wrap items-baseline gap-3">
              <p className="sx-stat">{formatUSD(sales30, true)}</p>
              <GrowthPill pct={salesGrowth} />
            </div>
            <div className="mt-4">
              <RevenueChart points={series} warmup={6} caption={`Goods sales, 7-day average per day over the last 30 days: ${formatUSD(sales30, true)} in total`} />
            </div>
          </Panel>

          <Panel id="order-stats" className="lg:col-span-4" title="Order statistics" action={<span className="sx-pill sx-pill-muted">All time · UTC</span>}>
            <div className="mt-3"><OrderHeatmap data={heat} /></div>
          </Panel>
        </div>

        {/* Middle row: needs attention · last activity · Gold upsell */}
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-12">
          <Panel id="attention" className="lg:col-span-4" title="Needs attention" action={<ViewAll href="/supplier/drafts" />}>
            {attention.length === 0 ? (
              <p className="mt-6 text-sm text-neutral-500">Every listing is live. New drafts and listings in review show up here.</p>
            ) : (
              <ul className="no-scrollbar -mx-1 mt-4 flex snap-x gap-3 overflow-x-auto px-1 pb-1">
                {attention.map(({ p, photos }) => (
                  <li key={p.id} className="w-40 shrink-0 snap-start">
                    <Link href={`/supplier/products/${p.id}`} className="group block overflow-hidden rounded-2xl bg-snow text-[#050505] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8fd3cc]">
                      <ProductVisual src={coverOf(p)} alt="" category={p.category} className="aspect-[4/3] !bg-[#f4f4f4]" />
                      <div className="px-3 pb-3 pt-2">
                        <p className="truncate text-sm font-semibold">{p.title}</p>
                        <p className="mt-0.5 flex items-center gap-1 text-xs text-[#525252]">
                          {p.status === 'pending_review' ? 'Waiting for review' : photos < 3 ? <><ImageIcon className="h-3 w-3" aria-hidden /> {photos} of 3 photos</> : 'Ready to submit'}
                        </p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel id="activity" className="lg:col-span-5" title="Last activity" action={<ViewAll href="/supplier#pipeline" />}>
            {recent.length === 0 ? (
              <p className="mt-6 text-sm text-neutral-500">Paid orders appear here as soon as a buyer&apos;s payment is confirmed.</p>
            ) : (
              <ul className="mt-3 divide-y divide-snow/[0.06]">
                {recent.map((o) => {
                  const p = productById.get(o.product_id);
                  return (
                    <li key={o.id}>
                      <Link href={`/supplier/orders/${o.id}`} className="-mx-2 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-snow/[0.03] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8fd3cc] sm:grid-cols-[auto_minmax(0,1fr)_auto_auto]">
                        <span className="sx-thumb">
                          <ProductVisual src={coverOf(p)} alt="" category={p?.category ?? 'general'} className="h-full w-full" />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm text-neutral-900">{p?.title ?? 'Product'}</span>
                          <span className="block text-xs text-neutral-500"><OrderStatusPill status={o.escrow_status} className="!px-0 !py-0 !bg-transparent" /></span>
                        </span>
                        <span className="hidden font-mono text-xs text-neutral-500 sm:block">{shortId(o.id)}</span>
                        <span className="text-right text-sm tabular-nums text-neutral-900">{formatUSD(o.goods_cents ?? 0)}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <section aria-labelledby="gold-title" className="sx-pro flex flex-col justify-between p-6 lg:col-span-3">
            <div>
              <h2 id="gold-title" className="text-2xl font-medium tracking-tight">{gold.kind === 'active' ? 'You’re Gold' : 'SokoGlobal Gold'}</h2>
              <p className="mt-2 text-sm text-[#1f3b3a]">
                {gold.kind === 'active'
                  ? 'Lower commission on new orders and the Gold Supplier badge on your listings and quotes.'
                  : 'Lower commission on every order and a Gold Supplier badge buyers can see on your listings and quotes.'}
              </p>
            </div>
            <Link href="/supplier/subscription" className="mt-6 inline-flex items-center justify-center rounded-full bg-snow px-4 py-2.5 text-sm font-medium text-[#050505] shadow-[0_8px_24px_-12px_rgb(0_0_0/0.5)] transition hover:bg-[#f2f2f2] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#050505] active:scale-95">
              {gold.kind === 'active' ? 'Manage membership' : 'Upgrade now'}
            </Link>
          </section>
        </div>

        {/* Bottom row: recent sales table · category donut */}
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-12">
          <Panel id="sales" className="overflow-hidden !px-0 !pb-2 lg:col-span-8" title={<span className="px-5 sm:px-6">Recent sales</span>}
            action={<span className="px-5 sm:px-6"><ViewAll href="/supplier/products">All products</ViewAll></span>}>
            {topSales.length === 0 ? (
              <p className="px-5 pb-4 pt-6 text-sm text-neutral-500 sm:px-6">No sales yet. Sales by product appear here once buyers pay for an order.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="sx-table min-w-[560px]">
                  <thead><tr><th scope="col">ID</th><th scope="col">Product</th><th scope="col" className="text-right">Orders</th><th scope="col" className="text-right">Batch price</th><th scope="col" className="text-right">Earnings</th></tr></thead>
                  <tbody>
                    {topSales.map((s) => {
                      const p = productById.get(s.id);
                      return (
                        <tr key={s.id}>
                          <td className="font-mono text-xs text-neutral-500">{shortId(s.id)}</td>
                          <td>
                            <Link href={`/supplier/products/${s.id}`} className="flex min-w-0 items-center gap-3 hover:underline">
                              <span className="sx-thumb"><ProductVisual src={coverOf(p)} alt="" category={p?.category ?? 'general'} className="h-full w-full" /></span>
                              <span className="truncate">{p?.title ?? 'Product'}</span>
                            </Link>
                          </td>
                          <td className="text-right tabular-nums">{s.orders}</td>
                          <td className="text-right tabular-nums">{p ? formatUSD(p.trial_goods_cents) : '—'}</td>
                          <td className="text-right tabular-nums text-neutral-900">{formatUSD(s.earningsCents)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel id="categories" className="lg:col-span-4" title="Top selling categories">
            <div className="mt-5">
              {shares.length ? <CategoryDonut shares={shares} /> : <p className="text-sm text-neutral-500">Category split appears with your first sale.</p>}
            </div>
          </Panel>
        </div>

        {/* Analytics: catalogue + order metrics, payout dial and escrow release (unchanged component). */}
        <section id="analytics" aria-label="Analytics" className="mt-10 scroll-mt-32">
          <SupplierStats products={productCounts} orders={totals} payouts={payouts} release={release} readyToShip={readyToShip} />
        </section>

        <div className="mt-10"><FulfilmentPipeline orders={pipeline} /></div>

        {recentPaid.length > 0 && (
          <Panel id="payouts" className="mt-10 !p-0" title={<span className="flex items-center gap-2 px-5 pt-5 sm:px-6"><PackageCheck className="h-4 w-4 text-[#8fd3cc]" aria-hidden /> Recent payouts</span>}>
            <ul className="mt-3 divide-y divide-snow/[0.06] border-t border-snow/[0.06]">
              {recentPaid.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm sm:px-6">
                  <div>
                    <p className="font-medium tabular-nums text-neutral-900">{formatUSD(p.amount_cents, true)} <span className="text-xs font-normal text-neutral-500">{p.currency}</span></p>
                    <p className="font-mono text-xs text-neutral-500">{p.reference}{p.completed_at ? ` · ${new Date(p.completed_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}</p>
                  </div>
                  <a href={`/api/payouts/${p.id}/receipt`} className="btn-secondary px-3 py-1.5 text-xs"><FileDown className="h-3.5 w-3.5" aria-hidden /> Receipt (PDF)</a>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </main>
      <SupportWidget />
    </>
  );
}
