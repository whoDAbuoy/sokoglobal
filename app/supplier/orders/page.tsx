import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getSessionProfile } from '@/lib/supabase/server';
import { groupPaidOrders, parseGroupedCatalog, type ListingGroup, type RawOrder } from '@/lib/supplier-orders';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import OrderCatalog from '@/components/supplier/OrderCatalog';

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

        <OrderCatalog groups={groups} />
      </main>
    </>
  );
}
