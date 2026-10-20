import { notFound, redirect } from 'next/navigation';
import { CheckCircle2, ClipboardCheck, Inbox, Store } from 'lucide-react';
import { getSessionProfile } from '@/lib/supabase/server';
import { formatUSD } from '@/lib/format';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import ReviewCard, { type PendingProduct } from '@/components/admin/ReviewCard';
import DeleteProductButton from '@/components/admin/DeleteProductButton';
import { isAdmin } from '@/lib/auth/admin-access';

export const metadata = { title: 'Review queue · SokoGlobal Ops', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

/**
 * Internal operations dashboard: quote freight/customs and publish products.
 * Access: role = 'admin' only. Non-admins get a 404 so the route isn't
 * discoverable. Data access is also gated in Postgres (admin RLS policies and
 * admin_* functions), so this check is not the only line of defence.
 */
export default async function AdminPage() {
  const { supabase, user, profile } = await getSessionProfile();
  if (!user) redirect('/login?redirectTo=/admin/review');
  if (!isAdmin(profile)) notFound();

  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const [pendingRes, recentRes, liveCount, todayCount] = await Promise.all([
    supabase
      .from('products')
      .select(`id, title, brand, category, description, origin_country, attributes, unit_price_cents,
               trial_units, trial_goods_cents, lead_time_days, updated_at,
               supplier:profiles!products_supplier_id_fkey ( company_name, full_name, country_code, kyc_verified ),
               product_media ( id, media_type, public_url, captured_at, width, height, sort_order )`)
      .eq('status', 'pending_review')
      .order('updated_at', { ascending: true }) // oldest first (FIFO SLA)
      .limit(50),
    supabase
      .from('products')
      .select('id, title, trial_landed_cost_cents, reviewed_at, supplier:profiles!products_supplier_id_fkey ( company_name )')
      .eq('status', 'live')
      .not('reviewed_at', 'is', null)
      .order('reviewed_at', { ascending: false })
      .limit(8),
    supabase.from('products').select('id', { count: 'exact', head: true }).eq('status', 'live'),
    supabase.from('products').select('id', { count: 'exact', head: true }).eq('status', 'live').gte('reviewed_at', startOfDay.toISOString()),
  ]);

  if (pendingRes.error) throw new Error(`Could not load review queue: ${pendingRes.error.message}`);

  // Catalogue fields (migration 015). Optional: before it runs the query errors and cards show the basics.
  const ids = (pendingRes.data ?? []).map((p) => p.id);
  const { data: extra } = ids.length
    ? await supabase.from('products').select('id, sku, moq, unit_of_measure, price_tiers, category:categories ( name, requires_compliance )').in('id', ids)
    : { data: [] };
  const extraById = new Map(((extra ?? []) as { id: string; sku: string | null; moq: number | null; unit_of_measure: string | null; price_tiers: unknown; category: unknown }[])
    .map((x) => [x.id, x]));

  const pending: PendingProduct[] = (pendingRes.data ?? []).map((p) => ({
    ...p,
    catalog: (() => {
      const x = extraById.get(p.id);
      if (!x) return null;
      const cat = one(x.category as { name: string; requires_compliance: boolean } | null);
      return { sku: x.sku, moq: x.moq, unit: x.unit_of_measure, tiers: Array.isArray(x.price_tiers) ? x.price_tiers.length : 0,
        category_name: cat?.name ?? null, requires_compliance: !!cat?.requires_compliance };
    })(),
    attributes: (p.attributes ?? {}) as Record<string, unknown>,
    supplier: one(p.supplier as unknown as PendingProduct['supplier']),
    media: [...((p.product_media ?? []) as (PendingProduct['media'][number] & { sort_order: number })[])]
      .sort((a, b) => a.sort_order - b.sort_order),
  }));

  const stats = [
    { label: 'Awaiting review', value: pending.length, icon: Inbox },
    { label: 'Approved today', value: todayCount.count ?? 0, icon: ClipboardCheck },
    { label: 'Live products', value: liveCount.count ?? 0, icon: Store },
  ];

  return (
    <>
      <DashboardHeader profile={profile} />
      <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Internal · Moderation</p>
            <h1 className="mt-2 text-3xl font-semibold text-neutral-900">Product review queue</h1>
            <p className="mt-1 text-sm text-slate-500">
              Check the visual proof, enter the logistics quote, and publish the Guaranteed Landed Cost.
            </p>
          </div>
        </div>

        <dl className="mt-6 grid gap-4 sm:grid-cols-3">
          {stats.map(({ label, value, icon: Icon }) => (
            <div key={label} className="card flex items-center gap-4 p-5">
              <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-50 ring-1 ring-neutral-200"><Icon className="h-5 w-5 text-brand-700" /></span>
              <div>
                <dd className="text-2xl font-semibold tabular-nums text-slate-900">{value}</dd>
                <dt className="text-sm text-slate-500">{label}</dt>
              </div>
            </div>
          ))}
        </dl>

        <section className="mt-8 space-y-5">
          {pending.length === 0 ? (
            <div className="card flex flex-col items-center px-6 py-14 text-center">
              <CheckCircle2 className="h-8 w-8 text-emerald-500" />
              <p className="mt-3 font-medium text-slate-900">Queue clear</p>
              <p className="mt-1 text-sm text-slate-500">New submissions from suppliers will appear here.</p>
            </div>
          ) : (
            pending.map((p) => <ReviewCard key={p.id} product={p} />)
          )}
        </section>

        <section id="recent" className="mt-12 scroll-mt-24">
          <h2 className="text-lg font-semibold tracking-tight">Recently approved</h2>
          <div className="card mt-4 divide-y divide-slate-100">
            {(recentRes.data ?? []).length === 0 && <p className="px-5 py-6 text-sm text-slate-500">Nothing approved yet.</p>}
            {(recentRes.data ?? []).map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                <div>
                  <p className="font-medium text-slate-900">{r.title}</p>
                  <p className="text-xs text-slate-500">{one(r.supplier as unknown as { company_name: string })?.company_name}</p>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="font-semibold tabular-nums">{formatUSD(r.trial_landed_cost_cents, true)}</p>
                    <p className="text-xs text-slate-500">
                      {r.reviewed_at && new Date(r.reviewed_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  <DeleteProductButton productId={r.id} title={r.title} />
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
