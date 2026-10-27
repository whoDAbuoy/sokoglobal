import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Truck, Zap } from 'lucide-react';
import { getSessionProfile } from '@/lib/supabase/server';
import { parseGroupedCatalog, type ListingGroup } from '@/lib/supplier-orders';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import OrderCatalog from '@/components/supplier/OrderCatalog';
import ShipOrderDialog, { type ExistingShipment } from '@/components/supplier/ShipOrderDialog';
import OrderChatButton from '@/components/chat/OrderChatButton';
import { SHIPMENT_STAGE_LABEL, trackingLink } from '@/lib/shipping';
import { PageHead, Panel } from '@/components/supplier/sellsy/ui';

type ShipmentRow = ExistingShipment & {
  order_id: string; dispatched_at: string | null;
  order: { quantity: number; escrow_status: string; payment_structure: string | null; product: { title: string } | { title: string }[] | null }
       | { quantity: number; escrow_status: string; payment_structure: string | null; product: { title: string } | { title: string }[] | null }[] | null;
};
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—');

export const metadata = { title: 'Orders to fulfil · SokoGlobal' };
export const dynamic = 'force-dynamic';

/**
 * Paid orders waiting to ship, one card per listing (get_supplier_grouped_catalog, migration 018).
 * Only payment-confirmed orders appear: unpaid ones never reach suppliers.
 */
export default async function SupplierOrdersPage() {
  const { supabase, user, profile } = await getSessionProfile();
  if (!user || !profile) redirect('/login?redirectTo=/supplier/orders');
  if (profile.role !== 'supplier') redirect('/dashboard');

  // Shipments (migration 021; RLS: own orders only) don't depend on the grouped catalogue: load both at once.
  const [{ data, error }, { data: shipmentRows }] = await Promise.all([
    supabase.rpc('get_supplier_grouped_catalog'),
    supabase.from('shipments')
      .select(`order_id, status, carrier_name, tracking_number, tracking_url, estimated_delivery, dispatched_at,
               order:orders ( quantity, escrow_status, payment_structure, product:products ( title ) )`)
      .neq('status', 'delivered').order('dispatched_at', { ascending: true, nullsFirst: true }).limit(200),
  ]);
  if (error) throw new Error(`Could not load your orders: ${error.message}`);
  const groups: ListingGroup[] = parseGroupedCatalog(data);

  // Saved waybills prefill the dialog; parcels on the way can be moved forward.
  const shipments = (shipmentRows ?? []) as unknown as ShipmentRow[];
  const saved = Object.fromEntries(shipments.filter((r) => r.status === 'label_created').map((r) => [r.order_id, r]));
  const onTheWay = shipments.filter((r) => r.status !== 'label_created');

  return (
    <>
      <DashboardHeader profile={profile} />
      <main className="page-wide pb-16 pt-8">
        <PageHead eyebrow="Fulfilment" title="Orders to fulfil"
          actions={<Link href="/supplier#pipeline" className="btn-secondary">All orders</Link>}>
          Paid orders waiting for dispatch, grouped by listing. Every order here is confirmed by Paystack or M-Pesa and held in escrow;
          you&apos;re paid the goods value when the buyer confirms delivery — or right after dispatch with an instant early payout.
        </PageHead>

        <OrderCatalog groups={groups} shipments={saved} />

        {onTheWay.length > 0 && (
          <Panel id="on-the-way" className="mt-10 overflow-hidden !p-0"
            title={<span className="flex items-center gap-2 px-5 pt-5 sm:px-6"><Truck className="h-5 w-5 text-[#8fd3cc]" aria-hidden /> On the way</span>}>
            <p className="px-5 pt-1 text-sm text-neutral-500 sm:px-6">Mark parcels out for delivery or delivered; buyers verify the goods before escrow is released.</p>
            <div className="mt-4 overflow-x-auto">
              <table className="sx-table min-w-[820px]">
                <thead><tr><th scope="col">Order</th><th scope="col">Shipment</th><th scope="col">ETA</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {onTheWay.map((r) => {
                    const o = one(r.order);
                    const title = one(o?.product)?.title ?? 'Order';
                    const link = trackingLink(r);
                    return (
                      <tr key={r.order_id}>
                        <td className="max-w-[16rem]">
                          <p className="truncate text-neutral-900">{title}</p>
                          <p className="font-mono text-xs text-neutral-500">#{r.order_id.slice(0, 8).toUpperCase()} · dispatched {day(r.dispatched_at)}</p>
                        </td>
                        <td>
                          <span className="sx-pill sx-pill-blue">{SHIPMENT_STAGE_LABEL[r.status]}</span>
                          <p className="mt-1 text-xs text-neutral-500">{r.carrier_name}{' '}
                            {link ? <a href={link} target="_blank" rel="noopener noreferrer" className="font-mono underline underline-offset-2">{r.tracking_number}</a> : <span className="font-mono">{r.tracking_number}</span>}
                          </p>
                        </td>
                        <td className="text-neutral-500">
                          {r.estimated_delivery ? day(r.estimated_delivery) : 'No ETA set'}
                          {o?.escrow_status === 'deposit_paid' && <p className="text-xs"><span className="sx-pill sx-pill-amber mt-1">Waiting for the buyer’s 70% balance</span></p>}
                        </td>
                        <td>
                          <div className="flex flex-wrap justify-end gap-2">
                            <Link href={`/supplier/orders/${r.order_id}`} className="btn-secondary px-3 py-1.5 text-sm">
                              {o?.escrow_status === 'deposit_paid' ? 'Details' : <><Zap className="h-3.5 w-3.5 text-yellow-300" aria-hidden /> Payout</>}
                            </Link>
                            <OrderChatButton orderId={r.order_id} label="Message buyer" title={`Order #${r.order_id.slice(0, 8).toUpperCase()} · ${title}`} />
                            <ShipOrderDialog orderId={r.order_id} existing={r} orderLabel={`${title} (#${r.order_id.slice(0, 8).toUpperCase()})`} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        )}
      </main>
    </>
  );
}
