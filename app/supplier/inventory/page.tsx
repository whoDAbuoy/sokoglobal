import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Clock, Pencil, Plus } from 'lucide-react';
import { formatUSD } from '@/lib/format';
import { getSessionProfile } from '@/lib/supabase/server';
import type { EscrowStatus, ProductCategory, ProductStatus } from '@/lib/types';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import ProductVisual from '@/components/dashboard/ProductVisual';
import { addOrder, emptyCounts, type OrderCounts } from '@/components/supplier/orderStages';
import { PageHead, Panel, ProductStatusPill } from '@/components/supplier/sellsy/ui';

export const metadata = { title: 'Inventory · SokoGlobal' };
export const dynamic = 'force-dynamic';

type Row = {
  id: string; title: string; category: ProductCategory; status: ProductStatus; trial_units: number; moq?: number | null;
  trial_goods_cents: number; trial_landed_cost_cents: number | null; deleted_at: string | null; updated_at: string;
  product_media: { media_type: string; public_url: string | null; sort_order: number | null }[] | null;
};

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'live', label: 'Live' },
  { key: 'pending_review', label: 'In review' },
  { key: 'draft', label: 'Drafts' },
  { key: 'archived', label: 'Archived' },
] as const;
type FilterKey = (typeof FILTERS)[number]['key'];

/**
 * Listing inventory as one dark table: batch size, MOQ, goods value, landed cost and the order mix per listing.
 * Read-only: edits happen on the product page (same server actions as before).
 */
export default async function SupplierInventoryPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { supabase, user, profile } = await getSessionProfile();
  if (!user || !profile) redirect('/login?redirectTo=/supplier/inventory');
  if (profile.role !== 'supplier') redirect('/dashboard');
  const { status } = await searchParams;
  const filter: FilterKey = FILTERS.some((f) => f.key === status) ? (status as FilterKey) : 'all';

  // `moq` arrives with migration 015; read without it before that.
  const cols = 'id, title, category, status, trial_units, trial_goods_cents, trial_landed_cost_cents, deleted_at, updated_at, product_media ( media_type, public_url, sort_order )';
  const load = (select: string) => supabase.from('products').select(select).eq('supplier_id', user.id).is('deleted_at', null).order('updated_at', { ascending: false });
  let res = await load(`${cols}, moq`);
  if (res.error) res = await load(cols);
  const all = (res.data ?? []) as unknown as Row[];

  const ids = all.map((p) => p.id);
  const { data: orderRows } = ids.length
    ? await supabase.from('orders').select('product_id, escrow_status, total_cents').in('product_id', ids)
    : { data: [] };
  const byProduct = new Map<string, OrderCounts>();
  for (const o of (orderRows ?? []) as { product_id: string; escrow_status: EscrowStatus; total_cents: number }[]) {
    if (o.escrow_status === 'pending_payment') continue;
    let c = byProduct.get(o.product_id);
    if (!c) byProduct.set(o.product_id, (c = emptyCounts()));
    addOrder(c, o.escrow_status, o.total_cents);
  }

  const count = (k: FilterKey) => (k === 'all' ? all.length : all.filter((p) => p.status === k).length);
  const rows = filter === 'all' ? all : all.filter((p) => p.status === filter);
  const cover = (p: Row) => [...(p.product_media ?? [])].filter((m) => m.media_type === 'image' && m.public_url)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))[0]?.public_url ?? null;

  return (
    <>
      <DashboardHeader profile={profile} />
      <main className="mx-auto max-w-7xl px-4 pb-16 pt-8 sm:px-6 lg:px-8">
        <PageHead eyebrow="Catalogue" title="Inventory"
          actions={<Link href="/supplier/products/new" className="btn-primary"><Plus className="h-4 w-4" aria-hidden /> New product</Link>}>
          Every active listing with its Trial Batch size, minimum order, goods value and landed cost.
        </PageHead>

        <nav aria-label="Filter by status" className="no-scrollbar mt-6 flex gap-1.5 overflow-x-auto">
          {FILTERS.map((f) => (
            <Link key={f.key} href={f.key === 'all' ? '/supplier/inventory' : `/supplier/inventory?status=${f.key}`}
              aria-current={filter === f.key ? 'page' : undefined} className="sx-tab press">
              {f.label} <span className="tabular-nums opacity-60">{count(f.key)}</span>
            </Link>
          ))}
        </nav>

        <Panel as="div" className="mt-4 overflow-hidden !p-0">
          {rows.length === 0 ? (
            <p className="px-6 py-12 text-center text-sm text-neutral-500">No listings here.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="sx-table min-w-[860px]">
                <caption className="sr-only">Listings{filter === 'all' ? '' : ` (${FILTERS.find((f) => f.key === filter)?.label})`}</caption>
                <thead>
                  <tr>
                    <th scope="col">Product</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="text-right">Units / batch</th>
                    <th scope="col" className="text-right">MOQ</th>
                    <th scope="col" className="text-right">Goods value</th>
                    <th scope="col" className="text-right">Landed cost</th>
                    <th scope="col" className="text-right">Orders</th>
                    <th scope="col"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => {
                    const c = byProduct.get(p.id) ?? emptyCounts();
                    return (
                      <tr key={p.id}>
                        <td>
                          <div className="flex min-w-0 items-center gap-3">
                            <span className="sx-thumb h-10 w-10 rounded-xl"><ProductVisual src={cover(p)} alt="" category={p.category} className="h-full w-full" /></span>
                            <span className="min-w-0">
                              <Link href={`/supplier/products/${p.id}`} className="block max-w-[18rem] truncate text-neutral-900 hover:underline">{p.title}</Link>
                              <span className="block text-xs capitalize text-neutral-500">{p.category}</span>
                            </span>
                          </div>
                        </td>
                        <td><ProductStatusPill status={p.status} /></td>
                        <td className="text-right tabular-nums">{p.trial_units.toLocaleString('en-US')}</td>
                        <td className="text-right tabular-nums">{p.moq ? p.moq.toLocaleString('en-US') : '—'}</td>
                        <td className="text-right tabular-nums">{formatUSD(p.trial_goods_cents)}</td>
                        <td className="text-right tabular-nums">
                          {p.trial_landed_cost_cents
                            ? formatUSD(p.trial_landed_cost_cents)
                            : <span className="sx-pill sx-pill-muted"><Clock className="h-3 w-3" aria-hidden /> After review</span>}
                        </td>
                        <td className="text-right tabular-nums">
                          {c.total}
                          {c.escrow > 0 && <span className="ml-1.5 text-xs text-neutral-500">({c.escrow} in escrow)</span>}
                        </td>
                        <td className="text-right">
                          <Link href={`/supplier/products/${p.id}`} aria-label={`Edit ${p.title}`} className="btn-secondary px-3 py-1.5 text-xs"><Pencil className="h-3.5 w-3.5" aria-hidden /> Edit</Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </main>
    </>
  );
}
