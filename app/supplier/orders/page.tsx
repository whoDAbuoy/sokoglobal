import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, Truck } from 'lucide-react';
import { getSessionProfile } from '@/lib/supabase/server';
import { groupPaidOrders, parseGroupedCatalog, type ListingGroup, type RawOrder } from '@/lib/supplier-orders';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import OrderCatalog from '@/components/supplier/OrderCatalog';
import ShipOrderDialog, { type ExistingShipment } from '@/components/supplier/ShipOrderDialog';
import OrderChatButton from '@/components/chat/OrderChatButton';
import { SHIPMENT_STAGE_LABEL, trackingLink } from '@/lib/shipping';

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

  let groups: ListingGroup[];
  const { data, error } = await supabase.rpc('get_supplier_grouped_catalog');
  if (!error) groups = parseGroupedCatalog(data);
  else {
    // Before migration 018: group the visible orders here with the same rules.
    const { data: products } = await supabase.from('products')
      .select('id, title, product_media ( public_url, media_type, sort_order )').eq('supplier_id', user.id);
    const meta = new Map((products ?? []).map((p) => {
      const img = [...((p.product_media ?? []) as { public_url: string; media_type: string; sort_order: number }[])]
        .filter((m) => m.media_type === 'image').sort((a, b) => a.sort_order - b.sort_order)[0]?.public_url ?? null;
      return [p.id as string, { title: p.title as string, image_url: img, unit_of_measure: null }];
    }));
    const ids = [...meta.keys()];
    const { data: orders } = ids.length
      ? await supabase.from('orders').select('id, product_id, escrow_status, current_status, funded_at, quantity, batches, goods_cents, total_cents, destination_label, eta_timestamp')
          .in('product_id', ids).eq('escrow_status', 'funded')
      : { data: [] };
    groups = groupPaidOrders((orders ?? []) as RawOrder[], meta);
  }

  // Shipments (migration 021; RLS: own orders only). Saved waybills prefill the dialog; parcels on the way can be moved forward.
  const { data: shipmentRows } = await supabase.from('shipments')
    .select(`order_id, status, carrier_name, tracking_number, tracking_url, estimated_delivery, dispatched_at,
             order:orders ( quantity, escrow_status, payment_structure, product:products ( title ) )`)
    .neq('status', 'delivered').order('dispatched_at', { ascending: true, nullsFirst: true }).limit(200);
  const shipments = (shipmentRows ?? []) as unknown as ShipmentRow[];
  const saved = Object.fromEntries(shipments.filter((r) => r.status === 'label_created').map((r) => [r.order_id, r]));
  const onTheWay = shipments.filter((r) => r.status !== 'label_created');

  return (
    <>
      <DashboardHeader profile={profile} />
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
        <Link href="/supplier" className="inline-flex items-center gap-1 text-sm text-neutral-600 hover:text-neutral-900"><ArrowLeft className="h-4 w-4" aria-hidden /> Catalogue</Link>
        <p className="eyebrow mt-4">Fulfilment</p>
        <h1 className="mt-2 text-3xl font-semibold text-neutral-900">Orders to fulfil</h1>
        <p className="mt-1 max-w-2xl text-sm text-neutral-600">
          Paid orders waiting for dispatch, grouped by listing. Every order here is confirmed by Paystack or M-Pesa and held in escrow;
          you&apos;re paid the goods value when the buyer confirms delivery.
        </p>

        <OrderCatalog groups={groups} shipments={saved} />

        {onTheWay.length > 0 && (
          <section aria-labelledby="on-the-way" className="mt-12">
            <h2 id="on-the-way" className="flex items-center gap-2 text-lg font-semibold text-neutral-900"><Truck className="h-5 w-5" aria-hidden /> On the way</h2>
            <p className="mt-1 text-sm text-neutral-600">Mark parcels out for delivery or delivered; buyers verify the goods before escrow is released.</p>
            <ul className="card mt-4 divide-y divide-neutral-200">
              {onTheWay.map((r) => {
                const o = one(r.order);
                const title = one(o?.product)?.title ?? 'Order';
                const link = trackingLink(r);
                return (
                  <li key={r.order_id} className="grid gap-2 px-4 py-3 text-sm sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] sm:items-center sm:px-5">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-neutral-900">{title}</p>
                      <p className="font-mono text-xs text-neutral-600">#{r.order_id.slice(0, 8).toUpperCase()} · dispatched {day(r.dispatched_at)}</p>
                    </div>
                    <div className="min-w-0 text-neutral-700">
                      <p className="truncate">{SHIPMENT_STAGE_LABEL[r.status]} · {r.carrier_name}{' '}
                        {link ? <a href={link} target="_blank" rel="noopener noreferrer" className="font-mono underline underline-offset-2">{r.tracking_number}</a> : <span className="font-mono">{r.tracking_number}</span>}
                      </p>
                      <p className="text-xs text-neutral-600">
                        {r.estimated_delivery ? `ETA ${day(r.estimated_delivery)}` : 'No ETA set'}
                        {o?.escrow_status === 'deposit_paid' ? ' · waiting for the buyer’s 70% balance' : ''}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2 sm:justify-end">
                      <OrderChatButton orderId={r.order_id} label="Message buyer" title={`Order #${r.order_id.slice(0, 8).toUpperCase()} · ${title}`} />
                      <ShipOrderDialog orderId={r.order_id} existing={r} orderLabel={`${title} (#${r.order_id.slice(0, 8).toUpperCase()})`} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}
