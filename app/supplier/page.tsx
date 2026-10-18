import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Plus } from 'lucide-react';
import { getSessionProfile } from '@/lib/supabase/server';
import type { EscrowStatus } from '@/lib/types';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import SupportWidget from '@/components/dashboard/SupportWidget';
import SupplierStats, { type ProductCounts } from '@/components/supplier/SupplierStats';
import SupplierProductCard, { type SupplierProduct } from '@/components/supplier/SupplierProductCard';
import { addOrder, emptyCounts, type OrderCounts } from '@/components/supplier/orderStages';

export default async function SupplierHome() {
  const { supabase, user, profile } = await getSessionProfile();
  if (!user || !profile) redirect('/login?redirectTo=/supplier');
  if (profile.role !== 'supplier') redirect('/dashboard');

  const { data: productRows } = await supabase
    .from('products')
    .select('id, title, category, status, trial_goods_cents, trial_landed_cost_cents, deleted_at, deletion_reason, product_media ( id, media_type, public_url, sort_order )')
    .eq('supplier_id', user.id)
    .order('created_at', { ascending: false });
  const products = (productRows ?? []) as unknown as SupplierProduct[];

  const productIds = products.map((p) => p.id);
  const { data: orderRows } = productIds.length
    ? await supabase.from('orders').select('product_id, escrow_status, total_cents').in('product_id', productIds)
    : { data: [] };
  const orders = (orderRows ?? []) as { product_id: string; escrow_status: EscrowStatus; total_cents: number }[];

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

  return (
    <>
      <DashboardHeader profile={profile} />
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Supplier</p>
            <h1 className="mt-2 text-3xl font-semibold text-neutral-900">Your catalogue</h1>
            <p className="mt-1 text-sm text-neutral-500">Products go live after logistics quoting and photo review.</p>
          </div>
          <Link href="/supplier/products/new" className="btn-primary"><Plus className="h-4 w-4" /> New product</Link>
        </div>

        <SupplierStats products={productCounts} orders={totals} />

        <div className="mt-10 flex items-baseline justify-between border-b border-neutral-200 pb-3">
          <h2 className="text-lg font-semibold text-neutral-900">Trial Batches</h2>
          <p className="text-sm tabular-nums text-neutral-500">{products.length} product{products.length === 1 ? '' : 's'}</p>
        </div>

        {products.length === 0 ? (
          <div className="card mt-6 px-6 py-12 text-center">
            <p className="text-sm text-neutral-500">No products yet. Create your first Trial Batch listing.</p>
            <Link href="/supplier/products/new" className="btn-secondary mt-4 inline-flex"><Plus className="h-4 w-4" /> New product</Link>
          </div>
        ) : (
          <div className="mt-6 grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((p) => (
              <SupplierProductCard key={p.id} product={p} orders={byProduct.get(p.id) ?? emptyCounts()} />
            ))}
          </div>
        )}
      </main>
      <SupportWidget />
    </>
  );
}
