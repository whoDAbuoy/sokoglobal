import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getSessionProfile } from '@/lib/supabase/server';
import { formatUSD } from '@/lib/format';
import type { EscrowStatus, OrderView } from '@/lib/types';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import EscrowTracker from '@/components/dashboard/EscrowTracker';
import SupportWidget from '@/components/dashboard/SupportWidget';
import OrderActions from './OrderActions';
import AnimatedShipmentMap from '@/components/tracking/AnimatedShipmentMap';

const EVENT_LABEL: Record<string, string> = {
  status_change: 'Status updated',
  payout_initiated: 'Supplier payout sent',
  payout_succeeded: 'Supplier paid',
  payout_failed: 'Supplier payout issue — our team is on it',
  payout_on_hold: 'Supplier payout pending verification',
};

/**
 * Order detail + Flutterwave return page (redirect_url). Query params such as
 * ?status=successful are only used for messaging — escrow state comes from the
 * database, which only the verified webhook can change.
 */
export default async function OrderPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const [{ id }, { status: returnStatus }] = await Promise.all([params, searchParams]);
  const { supabase, user, profile } = await getSessionProfile();
  if (!user || !profile) redirect(`/login?redirectTo=/dashboard/orders/${id}`);

  const { data: order } = await supabase
    .from('orders')
    .select(`id, order_type, escrow_status, quantity, goods_cents, freight_cents, customs_cents, total_cents,
             created_at, buyer_id, discharge_timestamp, eta_timestamp, origin_port_coords, destination_coords,
             route_waypoints, current_status, origin_label, destination_label, product:products ( title )`)
    .eq('id', id)
    .maybeSingle();
  if (!order || order.buyer_id !== user.id) notFound();

  const { data: events } = await supabase
    .from('escrow_events').select('id, from_status, to_status, event_type, note, created_at')
    .eq('order_id', id).order('created_at', { ascending: true });

  const product = (Array.isArray(order.product) ? order.product[0] : order.product) as { title: string } | null;
  const view: OrderView = {
    id: order.id, order_type: order.order_type, escrow_status: order.escrow_status as EscrowStatus,
    total_cents: order.total_cents, created_at: order.created_at, product_title: product?.title ?? 'Order',
  };

  return (
    <>
      <DashboardHeader profile={profile} />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <Link href="/dashboard#orders" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
          <ArrowLeft className="h-4 w-4" /> Orders
        </Link>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">{view.product_title}</h1>
        <p className="mt-1 text-sm text-slate-500">Order #{order.id.slice(0, 8).toUpperCase()} · {order.quantity} units</p>

        <div className="mt-6"><EscrowTracker orders={[view]} /></div>

        <OrderActions orderId={order.id} status={view.escrow_status} returnStatus={returnStatus ?? null} />

        {order.origin_port_coords && order.destination_coords && (
          <AnimatedShipmentMap
            className="mt-6"
            escrowStatus={view.escrow_status}
            tracking={{
              discharge_timestamp: order.discharge_timestamp,
              eta_timestamp: order.eta_timestamp,
              origin_port_coords: order.origin_port_coords,
              destination_coords: order.destination_coords,
              route_waypoints: order.route_waypoints,
              current_status: order.current_status,
              origin_label: order.origin_label,
              destination_label: order.destination_label,
            }}
          />
        )}

        <section className="card mt-6 p-5">
          <h2 className="text-sm font-semibold text-slate-900">Guaranteed Landed Cost</h2>
          <dl className="mt-3 space-y-1.5 text-sm text-slate-600">
            {[['Product', order.goods_cents], ['Consolidated air freight', order.freight_cents], ['Customs clearance & duties', order.customs_cents]].map(([l, v]) => (
              <div key={l as string} className="flex justify-between"><dt>{l}</dt><dd className="tabular-nums">{formatUSD(v as number, true)}</dd></div>
            ))}
            <div className="flex justify-between border-t border-slate-100 pt-2 font-semibold text-slate-900">
              <dt>Total held in escrow</dt><dd className="tabular-nums">{formatUSD(order.total_cents, true)}</dd>
            </div>
          </dl>
        </section>

        <section className="card mt-6 p-5">
          <h2 className="text-sm font-semibold text-slate-900">Escrow audit trail</h2>
          <ol className="mt-3 space-y-3 border-l border-slate-200 pl-4">
            {(events ?? []).map((e) => (
              <li key={e.id} className="relative text-sm">
                <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-brand-700 ring-4 ring-white" />
                <p className="font-medium text-slate-800">
                  {e.event_type === 'status_change' ? String(e.to_status).replace(/_/g, ' ') : EVENT_LABEL[e.event_type] ?? e.event_type}
                </p>
                <p className="text-xs text-slate-500">{new Date(e.created_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</p>
              </li>
            ))}
          </ol>
        </section>
      </main>
      <SupportWidget orders={[view]} />
    </>
  );
}
