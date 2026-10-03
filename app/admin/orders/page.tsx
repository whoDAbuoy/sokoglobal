import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import clsx from 'clsx';
import { ArrowRight, Plane } from 'lucide-react';
import { getSessionProfile } from '@/lib/supabase/server';
import { formatUSD } from '@/lib/format';
import DashboardHeader from '@/components/dashboard/DashboardHeader';

export const metadata = { title: 'Shipments · SokoGlobal Ops', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

/** Ops queue: paid orders that still need logistics updates. */
export default async function AdminOrdersPage() {
  const { supabase, user, profile } = await getSessionProfile();
  if (!user) redirect('/login?redirectTo=/admin/orders');
  if (profile?.role !== 'admin') notFound();

  const { data: orders, error } = await supabase
    .from('orders')
    .select(`id, escrow_status, current_status, eta_timestamp, total_cents, created_at, tracking_updated_at,
             product:products ( title ), buyer:profiles!orders_buyer_id_fkey ( company_name, country_code )`)
    .in('escrow_status', ['funded', 'in_transit', 'customs_cleared', 'delivered_pending_verification'])
    .order('created_at', { ascending: true })
    .limit(100);
  if (error) throw new Error(`Could not load shipments: ${error.message}`);

  const now = Date.now();
  return (
    <>
      <DashboardHeader profile={profile} />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand-700">Internal · Logistics</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Shipments</h1>
        <p className="mt-1 text-sm text-slate-500">Paid orders in escrow. Book departures, set ETAs and record milestones.</p>

        <div className="card mt-6 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="px-5 py-3 font-semibold">Order</th>
                <th scope="col" className="px-5 py-3 font-semibold">Buyer</th>
                <th scope="col" className="px-5 py-3 font-semibold">Escrow</th>
                <th scope="col" className="px-5 py-3 font-semibold">Shipment</th>
                <th scope="col" className="px-5 py-3 font-semibold">ETA</th>
                <th scope="col" className="px-5 py-3"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(orders ?? []).length === 0 && (
                <tr><td colSpan={6} className="px-5 py-10 text-center text-slate-500">No paid orders awaiting logistics.</td></tr>
              )}
              {(orders ?? []).map((o) => {
                const product = one(o.product as unknown as { title: string });
                const buyer = one(o.buyer as unknown as { company_name: string; country_code: string });
                const overdue = o.eta_timestamp && Date.parse(o.eta_timestamp) < now && !['customs_cleared', 'out_for_delivery', 'delivered'].includes(o.current_status);
                const unbooked = o.current_status === 'awaiting_dispatch';
                return (
                  <tr key={o.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <p className="font-medium text-slate-900">{product?.title ?? 'Order'}</p>
                      <p className="text-xs text-slate-500">#{o.id.slice(0, 8).toUpperCase()} · {formatUSD(o.total_cents)}</p>
                    </td>
                    <td className="px-5 py-3 text-slate-700">{buyer?.company_name} <span className="text-slate-400">({buyer?.country_code})</span></td>
                    <td className="px-5 py-3 text-slate-700">{o.escrow_status.replace(/_/g, ' ')}</td>
                    <td className="px-5 py-3">
                      <span className={clsx('rounded-full px-2 py-0.5 text-xs font-medium',
                        unbooked ? 'bg-amber-50 text-amber-800' : 'bg-brand-50 text-brand-800')}>
                        {o.current_status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className={clsx('px-5 py-3 text-xs', overdue ? 'font-semibold text-red-700' : 'text-slate-600')}>
                      {o.eta_timestamp ? new Date(o.eta_timestamp).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}
                      {overdue && ' · overdue'}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Link href={`/admin/orders/${o.id}/tracking`} className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
                        {unbooked ? <><Plane className="h-4 w-4" aria-hidden /> Book</> : 'Update'} <ArrowRight className="h-4 w-4" aria-hidden />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
