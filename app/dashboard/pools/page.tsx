import Link from 'next/link';
import { redirect } from 'next/navigation';
import clsx from 'clsx';
import { Flame, Info, Plane, TrendingUp, Users } from 'lucide-react';
import { getSessionProfile } from '@/lib/supabase/server';
import type { EscrowStatus } from '@/lib/types';
import { formatUSD } from '@/lib/format';
import { POOL_SELECT, toPoolView } from '@/lib/pool-view';
import { CATALOG_PRODUCT_SELECT, toTrialProductView, type CatalogProductRow } from '@/lib/product-view';
import { goldSupplierIds } from '@/lib/pricing-server';
import { getCategories } from '@/lib/categories-server';
import { POOL_SORTS, TRENDING_DAYS, parsePoolSort, parseTrending, sortPools, trendingReason } from '@/lib/trending';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import TrendPoolCard from '@/components/dashboard/TrendPoolCard';
import ProductResults from '@/components/dashboard/ProductResults';

export const metadata = { title: 'Trend Pools · SokoGlobal', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const TRENDING_PRODUCTS = 12;

/**
 * Trend Pools and what buyers are interacting with most. Pools are ordered by recent pledges (and how hot
 * their product is); products by orders, pool pledges, inquiries, saves and views over the last 14 days,
 * newer activity counting more (trending_pools / trending_products, migration 043). Reads go through RLS
 * or those aggregate functions; no buyer's identity leaves the database.
 */
export default async function PoolsPage({ searchParams }: { searchParams: Promise<{ sort?: string }> }) {
  const [{ supabase, user, profile }, params, categories] = await Promise.all([getSessionProfile(), searchParams, getCategories()]);
  if (!user || !profile) redirect('/login?redirectTo=/dashboard/pools');
  if (profile.role === 'supplier') redirect('/supplier');
  const sort = parsePoolSort(params.sort);

  const [poolsRes, mineRes, poolScoresRes, trendingRes] = await Promise.all([
    supabase.from('trend_pools').select(POOL_SELECT).in('status', ['open', 'funded']).order('deadline', { ascending: true }).limit(100),
    supabase.from('pool_members').select('pool_id, contribution_cents, payment_status').eq('buyer_id', user.id),
    supabase.rpc('trending_pools', { p_limit: 100 }),
    supabase.rpc('trending_products', { p_days: TRENDING_DAYS, p_limit: TRENDING_PRODUCTS }),
  ]);
  if (poolsRes.error) throw new Error(`Could not load Trend Pools: ${poolsRes.error.message}`);

  const mine = new Map((mineRes.data ?? []).map((m) => [m.pool_id as string, m as { contribution_cents: number; payment_status: EscrowStatus }]));
  const pools = (poolsRes.data ?? []).map((p) => toPoolView(p as Parameters<typeof toPoolView>[0], mine.get(p.id as string)));
  // Ranking is a bonus: if its function is unavailable, pools fall back to closing-soonest order.
  const scoreRows = poolScoresRes.error ? [] : (poolScoresRes.data ?? []) as { pool_id: string; score: number | string; recent_pledges: number }[];
  const scores = new Map(scoreRows.map((r) => [r.pool_id, Number(r.score)]));
  const recentPledges = new Map(scoreRows.map((r) => [r.pool_id, r.recent_pledges]));
  const sorted = sortPools(pools, poolScoresRes.error && sort === 'trending' ? 'closing' : sort, scores);
  const myPools = pools.filter((p) => p.my_contribution_cents > 0);

  // Trending listings, in rank order; with no activity yet, the newest listings stand in (labelled as such).
  const trending = trendingRes.error ? [] : parseTrending(trendingRes.data);
  const rank = new Map(trending.map((t, i) => [t.product_id, i]));
  const productsRes = trending.length
    ? await supabase.from('products').select(CATALOG_PRODUCT_SELECT).in('id', trending.map((t) => t.product_id)).eq('status', 'live').is('deleted_at', null)
    : await supabase.from('products').select(CATALOG_PRODUCT_SELECT).eq('status', 'live').is('deleted_at', null).order('created_at', { ascending: false }).limit(8);
  const rows = ((productsRes.data ?? []) as unknown as CatalogProductRow[])
    .sort((a, b) => (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99));
  const gold = await goldSupplierIds(supabase, rows.map((r) => r.supplier_id));
  const nameById = new Map((categories ?? []).map((c) => [c.id, c.name]));
  const products = rows.map((r) => toTrialProductView(r, r.category_id ? nameById.get(r.category_id) ?? null : null, gold));
  const highlights = Object.fromEntries(trending.map((t) => [t.product_id, trendingReason(t)]));

  const openCount = pools.filter((p) => p.status === 'open').length;
  const pledged = pools.reduce((sum, p) => sum + p.pledged_cents, 0);
  const boutiques = pools.reduce((sum, p) => sum + p.member_count, 0);

  return (
    <>
      <DashboardHeader profile={profile} />
      <main className="page-wide space-y-14 py-10">
        <header>
          <p className="eyebrow">Trend Pools</p>
          <h1 className="mt-2 flex items-center gap-2 text-3xl font-semibold text-neutral-900"><TrendingUp className="h-7 w-7 text-neutral-500" aria-hidden /> What buyers are moving on</h1>
          <p className="mt-2 max-w-2xl text-sm text-neutral-600">
            Team up with other boutiques to buy in bulk and split volumetric air freight, and see the listings getting the most orders,
            pledges and inquiries right now.
          </p>
          <dl className="mt-5 flex flex-wrap gap-2 text-sm">
            <Stat label="Open pools" value={openCount.toLocaleString('en-US')} />
            <Stat label="Pledged so far" value={formatUSD(pledged)} />
            <Stat label="Boutiques pooling" value={boutiques.toLocaleString('en-US')} />
          </dl>
        </header>

        {myPools.length > 0 && (
          <section aria-labelledby="my-pools">
            <h2 id="my-pools" className="flex items-center gap-2 text-xl font-semibold text-neutral-900"><Users className="h-5 w-5 text-neutral-500" aria-hidden /> Your pools</h2>
            <div className="mt-5 grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
              {myPools.map((p) => <TrendPoolCard key={`mine-${p.id}`} pool={p} />)}
            </div>
          </section>
        )}

        <section aria-labelledby="open-pools">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-neutral-200 pb-3">
            <h2 id="open-pools" className="flex items-center gap-2 text-xl font-semibold text-neutral-900"><Plane className="h-5 w-5 text-neutral-500" aria-hidden /> Open pools</h2>
            <nav aria-label="Sort pools" className="flex flex-wrap gap-1.5">
              {POOL_SORTS.map(([s, label]) => (
                <Link key={s} href={s === 'trending' ? '/dashboard/pools' : `/dashboard/pools?sort=${s}`} scroll={false} aria-current={sort === s ? 'true' : undefined}
                  className={clsx('rounded-full border px-3 py-1 text-xs font-medium',
                    sort === s ? 'border-transparent bg-[#ffffff] text-[#0a0a0a]' : 'border-neutral-300 text-neutral-700 hover:border-neutral-900')}>
                  {label}
                </Link>
              ))}
            </nav>
          </div>
          {sorted.length === 0 ? (
            <div className="glass-card mt-6 px-6 py-12 text-center">
              <p className="font-medium text-neutral-900">No open pools right now.</p>
              <p className="mt-1 text-sm text-neutral-600">New pools open when suppliers list bulk shipments. Meanwhile, test a supplier with a Trial Batch.</p>
              <Link href="/dashboard/discover" className="btn-primary mt-5 inline-flex">Browse the catalogue</Link>
            </div>
          ) : (
            <div className="mt-6 grid gap-x-6 gap-y-10 sm:grid-cols-2 xl:grid-cols-3">
              {sorted.map((p) => (
                <div key={p.id}>
                  {(recentPledges.get(p.id) ?? 0) > 0 && (
                    <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-orange-400">
                      <Flame className="h-3.5 w-3.5" aria-hidden />
                      {recentPledges.get(p.id)} pledge{recentPledges.get(p.id) === 1 ? '' : 's'} this week
                    </p>
                  )}
                  <TrendPoolCard pool={p} />
                </div>
              ))}
            </div>
          )}
        </section>

        <section aria-labelledby="trending-products">
          <div className="border-b border-neutral-200 pb-3">
            <h2 id="trending-products" className="flex items-center gap-2 text-xl font-semibold text-neutral-900">
              <Flame className="h-5 w-5 text-orange-400" aria-hidden /> {trending.length ? 'Trending products' : 'New this week'}
            </h2>
            <p className="mt-1 flex items-start gap-1.5 text-xs text-neutral-600">
              <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
              {trending.length
                ? `Ranked by orders, pool pledges, supplier inquiries, saves and views over the last ${TRENDING_DAYS} days. Newer activity counts more.`
                : 'Not enough buyer activity yet to rank listings, so these are the newest. Trending appears once buyers start ordering, saving and asking.'}
            </p>
          </div>
          {products.length > 0
            ? <ProductResults products={products} highlights={highlights} className="mt-4" />
            : <p className="glass-card mt-6 px-6 py-10 text-center text-sm text-neutral-600">No live listings yet.</p>}
        </section>
      </main>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass-card px-4 py-2.5">
      <dt className="text-xs text-neutral-500">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums text-neutral-900">{value}</dd>
    </div>
  );
}
