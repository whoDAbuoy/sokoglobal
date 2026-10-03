import { notFound, redirect } from 'next/navigation';
import { CheckCircle2, ClipboardCheck, Inbox, Store } from 'lucide-react';
import { getSessionProfile } from '@/lib/supabase/server';
import { formatUSD } from '@/lib/format';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import ReviewCard, { type PendingProduct } from '@/components/admin/ReviewCard';

export const metadata = { title: 'Operations · SokoGlobal', robots: { index: false, follow: false } };
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
  if (!user) redirect('/login?redirectTo=/admin');
  if (profile?.role !== 'admin') notFound();

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

  const pending: PendingProduct[] = (pendingRes.data ?? []).map((p) => ({
    ...p,
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
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-brand-700">Internal · Operations</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Product review queue</h1>
            <p className="mt-1 text-sm text-slate-500">
              Check the visual proof, enter the logistics quote, and publish the Guaranteed Landed Cost.
            </p>
          </div>
        </div>

        <dl className="mt-6 grid gap-4 sm:grid-cols-3">
          {stats.map(({ label, value, icon: Icon }) => (
            <div key={label} className="card flex items-center gap-4 p-5">
              <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-50 ring-1 ring-brand-100"><Icon className="h-5 w-5 text-brand-700" /></span>
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
                <div className="text-right">
                  <p className="font-semibold tabular-nums">{formatUSD(r.trial_landed_cost_cents, true)}</p>
                  <p className="text-xs text-slate-500">
                    {r.reviewed_at && new Date(r.reviewed_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
