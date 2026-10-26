import { redirect } from 'next/navigation';
import { getSessionProfile } from '@/lib/supabase/server';
import type { EscrowStatus, OrderView, ProductCategory } from '@/lib/types';
import { orderGroup, PAID_ORDER_STATUSES, type OrderGroup } from '@/lib/order-status';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import EscrowTracker from '@/components/dashboard/EscrowTracker';
import SupportWidget from '@/components/dashboard/SupportWidget';
import QuickReorder, { type QuotedReorder } from '@/components/dashboard/QuickReorder';
import type { ReorderSource } from '@/lib/reorder';

export const metadata = { title: 'My orders · SokoGlobal', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

const GROUPS: { key: OrderGroup; title: string; empty: string }[] = [
  { key: 'action', title: 'Needs your action', empty: 'Nothing to verify right now.' },
  { key: 'escrow', title: 'In escrow', empty: 'No shipments in progress.' },
  { key: 'completed', title: 'Completed', empty: 'No completed orders yet.' },
  { key: 'closed', title: 'Closed', empty: '' },
];

/**
 * The buyer's orders and escrow tracking, reached only from the header's "My orders" button.
 * Lists only real orders the signed-in buyer has paid into escrow (no sample data):
 * `buyer_id = auth.uid()` here, and RLS enforces the same on the database side.
 */
export default async function OrdersPage() {
  const { supabase, user, profile } = await getSessionProfile();
  if (!user || !profile) redirect('/login?redirectTo=/dashboard/orders');
  if (profile.role === 'supplier') redirect('/supplier');

  const { data, error } = await supabase
    .from('orders')
    .select('id, order_type, escrow_status, total_cents, created_at, payment_structure, rfq_quote_id, product:products ( title )')
    .eq('buyer_id', user.id)
    .in('escrow_status', PAID_ORDER_STATUSES)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw new Error(`Could not load orders: ${error.message}`);

  const orders: OrderView[] = (data ?? []).map((o) => ({
    id: o.id, order_type: o.order_type, escrow_status: o.escrow_status as EscrowStatus, total_cents: o.total_cents, created_at: o.created_at,
    product_title: one(o.product as unknown as { title: string })?.title ?? 'Product',
    payment_structure: o.payment_structure, is_rfq: !!o.rfq_quote_id,
  }));

  // Completed orders feed the quick-reorder matrix (live listings at today's price; RLS hides delisted ones).
  const { data: done } = await supabase
    .from('orders')
    .select(`id, product_id, batches, quantity, rfq_quote_id, released_at, verified_at,
             product:products ( title, status, category, trial_landed_cost_cents,
                                supplier:profiles!products_supplier_id_fkey ( company_name ),
                                product_media ( public_url, media_type, sort_order ) )`)
    .eq('buyer_id', user.id).eq('escrow_status', 'released')
    .order('released_at', { ascending: false, nullsFirst: false })
    .limit(100);
  type DoneProduct = {
    title: string; status: string; category: ProductCategory;
    trial_landed_cost_cents: number; supplier: { company_name: string } | { company_name: string }[] | null;
    product_media: { public_url: string; media_type: string; sort_order: number }[] | null;
  };
  const reorderSources: ReorderSource[] = [];
  const quoted: QuotedReorder[] = [];
  const seenQuoted = new Set<string>();
  for (const o of done ?? []) {
    const p = one(o.product as unknown as DoneProduct | DoneProduct[] | null);
    const completedAt = (o.released_at ?? o.verified_at) as string | null;
    if (o.rfq_quote_id) {
      if (p && !seenQuoted.has(o.product_id)) { seenQuoted.add(o.product_id); quoted.push({ order_id: o.id, product_id: o.product_id, title: p.title, quantity: o.quantity, completed_at: completedAt }); }
      continue;
    }
    const image = [...(p?.product_media ?? [])].filter((m) => m.media_type === 'image').sort((a, b) => a.sort_order - b.sort_order)[0]?.public_url ?? null;
    reorderSources.push({
      order_id: o.id, product_id: o.product_id, batches: o.batches, completed_at: completedAt,
      product: p ? { status: p.status, title: p.title, supplier_name: one(p.supplier)?.company_name ?? 'Supplier', image_url: image,
                     category: p.category, landed_cost_cents: p.trial_landed_cost_cents } : null,
    });
  }
  const byGroup = (g: OrderGroup) => orders.filter((o) => orderGroup(o.escrow_status) === g);

  return (
    <>
      <DashboardHeader profile={profile} />
      <main className="page-wide py-10">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-neutral-200 pb-6">
          <div>
            <p className="eyebrow">Escrow</p>
            <h1 className="mt-2 text-3xl font-semibold text-neutral-900">My orders</h1>
            <p className="mt-1 text-sm text-neutral-500">Every order is held in escrow until you verify the goods at your door.</p>
          </div>
          <nav aria-label="Order groups" className="flex flex-wrap gap-2">
            {GROUPS.map((g) => {
              const n = byGroup(g.key).length;
              return n ? (
                <a key={g.key} href={`#${g.key}`} className="pill hover:border-neutral-400">
                  {g.title} <span className="tabular-nums text-neutral-500">{n}</span>
                </a>
              ) : null;
            })}
          </nav>
        </div>

        <QuickReorder sources={reorderSources} quoted={quoted} />

        {orders.length === 0 ? (
          <div className="mt-8"><EscrowTracker orders={[]} /></div>
        ) : (
          GROUPS.map((g) => {
            const list = byGroup(g.key);
            if (!list.length && !g.empty) return null;
            return (
              <section key={g.key} id={g.key} aria-labelledby={`${g.key}-title`} className="mt-10 scroll-mt-32">
                <h2 id={`${g.key}-title`} className="flex items-center gap-2 text-sm font-semibold text-neutral-900">
                  {g.title} <span className="font-normal tabular-nums text-neutral-500">{list.length}</span>
                </h2>
                <div className="mt-4">
                  {list.length ? <EscrowTracker orders={list} /> : <p className="text-sm text-neutral-500">{g.empty}</p>}
                </div>
              </section>
            );
          })
        )}
      </main>
      <SupportWidget orders={orders} />
    </>
  );
}
