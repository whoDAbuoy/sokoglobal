import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getSessionProfile } from '@/lib/supabase/server';
import { UUID_RE } from '@/lib/uploads';
import { formatUSD } from '@/lib/format';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import TrackingForm, { type TrackingFormOrder } from './TrackingForm';

export const metadata = { title: 'Shipment tracking · SokoGlobal Ops', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

/**
 * Ops view to book / update a shipment. Access: role = 'admin' (404 for
 * anyone else, so the route isn't discoverable). Reads use the admin's own
 * session (RLS policy "orders: admin reads", migration 005).
 */
export default async function TrackingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user, profile } = await getSessionProfile();
  if (!user) redirect(`/login?redirectTo=/admin/orders/${id}/tracking`);
  if (profile?.role !== 'admin') notFound();
  if (!UUID_RE.test(id)) notFound();

  const { data: order } = await supabase
    .from('orders')
    .select(`id, order_type, quantity, total_cents, escrow_status, created_at,
             discharge_timestamp, eta_timestamp, origin_port_coords, destination_coords, route_waypoints,
             current_status, origin_label, destination_label, tracking_updated_at,
             product:products ( title, origin_country ),
             buyer:profiles!orders_buyer_id_fkey ( company_name, country_code )`)
    .eq('id', id)
    .maybeSingle();
  if (!order) notFound();

  const { data: events } = await supabase
    .from('escrow_events').select('id, from_status, to_status, event_type, created_at')
    .eq('order_id', id).order('created_at', { ascending: false }).limit(8);

  const product = one(order.product as unknown as { title: string; origin_country: string });
  const buyer = one(order.buyer as unknown as { company_name: string; country_code: string });

  const formOrder: TrackingFormOrder = {
    id: order.id,
    escrowStatus: order.escrow_status,
    currentStatus: order.current_status,
    discharge: order.discharge_timestamp,
    eta: order.eta_timestamp,
    origin: order.origin_port_coords,
    destination: order.destination_coords,
    waypoints: Array.isArray(order.route_waypoints) ? order.route_waypoints : [],
    originLabel: order.origin_label,
    destinationLabel: order.destination_label,
    updatedAt: order.tracking_updated_at,
  };

  return (
    <>
      <DashboardHeader profile={profile} />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <Link href="/admin/orders" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
          <ArrowLeft className="h-4 w-4" aria-hidden /> Shipments
        </Link>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-brand-700">Internal · Logistics</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">{product?.title ?? 'Order'}</h1>
            <p className="mt-1 text-sm text-slate-500">
              #{order.id.slice(0, 8).toUpperCase()} · {order.quantity} units · {formatUSD(order.total_cents, true)} · buyer {buyer?.company_name ?? '—'} ({buyer?.country_code})
            </p>
          </div>
        </div>

        <div className="mt-6">
          <TrackingForm order={formOrder} />
        </div>

        <section className="card mt-8 p-5">
          <h2 className="text-sm font-semibold text-slate-900">Recent escrow events</h2>
          <ul className="mt-3 divide-y divide-slate-100 text-sm">
            {(events ?? []).length === 0 && <li className="py-2 text-slate-500">None yet.</li>}
            {(events ?? []).map((e) => (
              <li key={e.id} className="flex justify-between gap-4 py-2">
                <span className="text-slate-700">
                  {e.event_type === 'status_change' ? `${e.from_status ?? '∅'} → ${e.to_status}`.replace(/_/g, ' ') : e.event_type.replace(/_/g, ' ')}
                </span>
                <time className="text-xs text-slate-500" dateTime={e.created_at}>
                  {new Date(e.created_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
                </time>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </>
  );
}
