import { notFound, redirect } from 'next/navigation';
import { Search } from 'lucide-react';
import { getSessionProfile } from '@/lib/supabase/server';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import ProductTable, { type AdminProductRow } from '@/components/admin/ProductTable';
import { isAdmin, isSuperAdmin } from '@/lib/auth/admin-access';
import Link from 'next/link';
import { FolderTree } from 'lucide-react';

export const metadata = { title: 'Catalogue · SokoGlobal Ops', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const count = (v: unknown) => one(v as { count: number }[])?.count ?? 0;

const FILTERS = [
  ['', 'All active'], ['live', 'Live'], ['pending_review', 'Pending review'], ['draft', 'Draft'], ['removed', 'Removed'],
] as const;

/** Moderation view of every product. Removal goes through admin_remove_product(). */
export default async function AdminProductsPage({ searchParams }: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const { supabase, user, profile } = await getSessionProfile();
  if (!user) redirect('/login?redirectTo=/admin/products');
  if (!isAdmin(profile)) notFound();

  const params = await searchParams;
  const q = (params.q ?? '').trim().slice(0, 100);
  const status = FILTERS.find(([v]) => v === params.status)?.[0] ?? '';

  let query = supabase.from('products')
    .select(`id, title, brand, status, trial_landed_cost_cents, updated_at, deleted_at, deletion_reason, is_featured,
             supplier:supplier_profiles!products_supplier_id_fkey ( company_name, country_code ),
             orders ( count ), trend_pools ( count ), category:categories ( name )`)
    .order('updated_at', { ascending: false }).limit(200);
  if (status === 'removed') query = query.not('deleted_at', 'is', null);
  else {
    query = query.is('deleted_at', null);
    if (status) query = query.eq('status', status);
  }
  if (q) query = query.ilike('title', `%${q.replace(/[\\%_]/g, '\\$&')}%`);
  const { data, error } = await query;
  if (error) throw new Error(`Could not load products: ${error.message}`);

  type Row = Omit<AdminProductRow, 'supplier' | 'order_count' | 'pool_count' | 'category_name'> & { supplier: unknown; orders: unknown; trend_pools: unknown; category?: unknown };
  const rows: AdminProductRow[] = ((data ?? []) as unknown as Row[]).map((p) => ({
    id: p.id, title: p.title, brand: p.brand, status: p.status,
    trial_landed_cost_cents: p.trial_landed_cost_cents, updated_at: p.updated_at,
    deleted_at: p.deleted_at, deletion_reason: p.deletion_reason,
    supplier: one(p.supplier as unknown as AdminProductRow['supplier']),
    order_count: count(p.orders), pool_count: count(p.trend_pools),
    is_featured: !!p.is_featured, category_name: one(p.category as { name: string } | null)?.name ?? null,
  }));

  return (
    <>
      <DashboardHeader profile={profile} />
      <main className="page-wide py-10">
        <p className="eyebrow">Internal · Moderation</p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-3xl font-semibold text-neutral-900">Catalogue</h1>
          <Link href="/admin/categories" className="btn-secondary px-3 py-2 text-sm"><FolderTree className="h-4 w-4" aria-hidden /> Categories</Link>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          Every product on the platform. Products with order history are archived instead of erased.
        </p>

        <form className="mt-6 flex flex-wrap gap-3" role="search">
          <div className="relative min-w-[16rem] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input name="q" defaultValue={q} placeholder="Search by title" aria-label="Search by title" className="input pl-9" />
          </div>
          <select name="status" defaultValue={status} aria-label="Status" className="input w-auto">
            {FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <button className="btn-secondary">Filter</button>
        </form>

        <ProductTable rows={rows} canOverride={isSuperAdmin(profile)} />
        {rows.length === 200 && <p className="mt-3 text-xs text-slate-500">Showing the 200 most recently updated — refine the search to see more.</p>}
      </main>
    </>
  );
}
