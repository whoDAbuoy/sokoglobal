import Link from 'next/link';
import { redirect } from 'next/navigation';
import { FilePen, Plus, Upload } from 'lucide-react';
import { getSessionProfile } from '@/lib/supabase/server';
import type { EscrowStatus } from '@/lib/types';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import type { SupplierProduct } from '@/components/supplier/SupplierProductCard';
import SupplierProductGrid from '@/components/supplier/SupplierProductGrid';
import { addOrder, emptyCounts, type OrderCounts } from '@/components/supplier/orderStages';
import { PageHead, Panel } from '@/components/supplier/sellsy/ui';

export const metadata = { title: 'Products · SokoGlobal' };
export const dynamic = 'force-dynamic';

/**
 * The supplier's Trial Batch catalogue (the grid that used to sit under the overview), with per-listing
 * order bars and draft deletion. Same reads as the overview: own products, and the paid orders RLS shows.
 */
export default async function SupplierProductsPage() {
  const { supabase, user, profile } = await getSessionProfile();
  if (!user || !profile) redirect('/login?redirectTo=/supplier/products');
  if (profile.role !== 'supplier') redirect('/dashboard');

  // Listings and their orders load together: orders are scoped by an inner join on the listing's supplier
  // (not by RLS alone, which lets a supplier with a delegated admin grant read every order).
  const [{ data: productRows }, { data: orderRows }] = await Promise.all([
    supabase
      .from('products')
      .select('id, title, category, status, trial_goods_cents, trial_landed_cost_cents, deleted_at, deletion_reason, product_media ( id, media_type, public_url, sort_order )')
      .eq('supplier_id', user.id)
      .order('created_at', { ascending: false }),
    supabase.from('orders').select('product_id, escrow_status, total_cents, product:products!inner ( supplier_id )').eq('product.supplier_id', user.id),
  ]);
  const products = (productRows ?? []) as unknown as SupplierProduct[];
  const byProduct = new Map<string, OrderCounts>();
  for (const o of (orderRows ?? []) as unknown as { product_id: string; escrow_status: EscrowStatus; total_cents: number }[]) {
    if (o.escrow_status === 'pending_payment') continue; // unpaid orders never reach suppliers
    let c = byProduct.get(o.product_id);
    if (!c) byProduct.set(o.product_id, (c = emptyCounts()));
    addOrder(c, o.escrow_status, o.total_cents);
  }
  const drafts = products.filter((p) => p.status === 'draft' && !p.deleted_at).length;

  return (
    <>
      <DashboardHeader profile={profile} />
      <main className="page-wide pb-16 pt-8">
        <PageHead eyebrow="Catalogue" title={<>Products <span className="sx-pill sx-pill-muted text-sm">{products.length}</span></>}
          actions={<>
            {drafts > 0 && <Link href="/supplier/drafts" className="btn-secondary"><FilePen className="h-4 w-4" aria-hidden /> Drafts ({drafts})</Link>}
            <Link href="/supplier/products/import" className="btn-secondary"><Upload className="h-4 w-4" aria-hidden /> Bulk import</Link>
            <Link href="/supplier/products/new" className="btn-primary"><Plus className="h-4 w-4" aria-hidden /> New product</Link>
          </>}>
          Trial Batch listings with their order mix. Products go live after logistics quoting and photo review.
        </PageHead>

        {products.length === 0 ? (
          <Panel as="div" className="mt-8 px-6 py-12 text-center">
            <p className="text-sm text-neutral-500">No products yet. Create your first Trial Batch listing.</p>
            <Link href="/supplier/products/new" className="btn-secondary mt-4 inline-flex"><Plus className="h-4 w-4" aria-hidden /> New product</Link>
          </Panel>
        ) : (
          <SupplierProductGrid products={products} orders={Object.fromEntries(byProduct)} />
        )}
      </main>
    </>
  );
}
