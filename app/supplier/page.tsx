import Link from 'next/link';
import { redirect } from 'next/navigation';
import { FileCheck2, FileDown, MessageSquare, PackagePlus, Plus, Workflow } from 'lucide-react';
import { formatUSD } from '@/lib/format';
import { getSessionProfile } from '@/lib/supabase/server';
import type { EscrowStatus } from '@/lib/types';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import SupportWidget from '@/components/dashboard/SupportWidget';
import SupplierStats, { type ProductCounts } from '@/components/supplier/SupplierStats';
import SupplierProductCard, { type SupplierProduct } from '@/components/supplier/SupplierProductCard';
import { addOrder, emptyCounts, type OrderCounts } from '@/components/supplier/orderStages';
import FulfilmentPipeline, { type FulfilmentOrder } from '@/components/supplier/FulfilmentPipeline';
import QuickActions from '@/components/portal/QuickActions';
import { payoutSummary, releaseSplit, type PayoutStatus } from '@/lib/supplier-pipeline';

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
  const [{ data: orderRows }, { data: payoutRows }] = await Promise.all([
    productIds.length
      ? supabase.from('orders')
        .select('id, product_id, escrow_status, total_cents, created_at, batches, current_status, eta_timestamp')
        .in('product_id', productIds).order('created_at', { ascending: false })
      : Promise.resolve({ data: [] }),
    supabase.from('payouts').select('id, status, amount_cents, currency, reference, completed_at').eq('supplier_id', user.id).order('created_at', { ascending: false }),
  ]);
  const orders = (orderRows ?? []) as {
    id: string; product_id: string; escrow_status: EscrowStatus; total_cents: number; created_at: string;
    batches: number | null; current_status: string | null; eta_timestamp: string | null;
  }[];
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

  return (
    <>
      <DashboardHeader profile={profile} />
      <div className="relative">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="eyebrow">Supplier</p>
              <h1 className="mt-2 text-3xl font-semibold text-neutral-900">Your catalogue</h1>
              <p className="mt-1 text-sm text-neutral-500">Products go live after logistics quoting and photo review.</p>
            </div>
            <Link href="/supplier/products/new" className="btn-primary"><Plus className="h-4 w-4" aria-hidden /> New product</Link>
          </div>
          <QuickActions className="mt-8" label="Supplier shortcuts" actions={[
            { href: '/supplier/products/new', label: 'New Trial Batch', hint: 'List a product for review', icon: PackagePlus, tone: 'tone-active' },
            { href: '/supplier#pipeline', label: 'Fulfilment', hint: 'Orders to prepare and ship', icon: Workflow, tone: 'tone-transit', badge: totals.escrow || undefined },
            { href: '/supplier/verification', label: 'Documents & payouts', hint: 'KYC files and payout account', icon: FileCheck2, tone: 'tone-escrow' },
            { href: '/supplier/messages', label: 'Buyer messages', hint: 'Answer importer questions', icon: MessageSquare, tone: 'tone-pending' },
          ]} />
        </div>
      </div>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <SupplierStats products={productCounts} orders={totals} payouts={payouts} release={release} />

        <div className="mt-10"><FulfilmentPipeline orders={pipeline} /></div>

        {recentPaid.length > 0 && (
          <section aria-labelledby="payouts-title" className="card mt-10 overflow-hidden">
            <h2 id="payouts-title" className="border-b border-neutral-200 px-4 py-3 font-semibold text-neutral-900">Recent payouts</h2>
            <ul className="divide-y divide-neutral-200">
              {recentPaid.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                  <div>
                    <p className="font-medium tabular-nums text-neutral-900">{formatUSD(p.amount_cents, true)} <span className="text-xs font-normal text-neutral-500">{p.currency}</span></p>
                    <p className="font-mono text-xs text-neutral-500">{p.reference}{p.completed_at ? ` · ${new Date(p.completed_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}</p>
                  </div>
                  <a href={`/api/payouts/${p.id}/receipt`} className="btn-secondary px-3 py-1.5 text-xs"><FileDown className="h-3.5 w-3.5" aria-hidden /> Receipt (PDF)</a>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="mt-12 flex items-baseline justify-between border-b border-neutral-200 pb-3">
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
