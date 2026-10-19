import { redirect } from 'next/navigation';
import { getSessionProfile } from '@/lib/supabase/server';
import type { EscrowStatus, OrderView } from '@/lib/types';
import { orderGroup, PAID_ORDER_STATUSES, type OrderGroup } from '@/lib/order-status';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import EscrowTracker from '@/components/dashboard/EscrowTracker';
import SupportWidget from '@/components/dashboard/SupportWidget';

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
    .select('id, order_type, escrow_status, total_cents, created_at, product:products ( title )')
    .eq('buyer_id', user.id)
    .in('escrow_status', PAID_ORDER_STATUSES)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw new Error(`Could not load orders: ${error.message}`);

  const orders: OrderView[] = (data ?? []).map((o) => ({
    id: o.id, order_type: o.order_type, escrow_status: o.escrow_status as EscrowStatus, total_cents: o.total_cents, created_at: o.created_at,
    product_title: one(o.product as unknown as { title: string })?.title ?? 'Product',
  }));
  const byGroup = (g: OrderGroup) => orders.filter((o) => orderGroup(o.escrow_status) === g);

  return (
    <>
      <DashboardHeader profile={profile} />
      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
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

        {orders.length === 0 ? (
          <div className="mt-8"><EscrowTracker orders={[]} /></div>
        ) : (
          GROUPS.map((g) => {
            const list = byGroup(g.key);
            if (!list.length && !g.empty) return null;
            return (
              <section key={g.key} id={g.key} aria-labelledby={`${g.key}-title`} className="mt-10 scroll-mt-24">
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
