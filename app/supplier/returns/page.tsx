import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ShieldAlert } from 'lucide-react';
import { formatUSD } from '@/lib/format';
import { getSessionProfile } from '@/lib/supabase/server';
import type { EscrowStatus, ProductCategory } from '@/lib/types';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import ProductVisual from '@/components/dashboard/ProductVisual';
import { OrderStatusPill, PageHead, Panel } from '@/components/supplier/sellsy/ui';

export const metadata = { title: 'Returns & disputes · SokoGlobal' };
export const dynamic = 'force-dynamic';

const RETURN_STATUSES: EscrowStatus[] = ['disputed', 'refunded', 'cancelled'];

type Row = {
  id: string; escrow_status: EscrowStatus; goods_cents: number | null; total_cents: number; created_at: string;
  product: { id: string; title: string; category: ProductCategory; product_media: { media_type: string; public_url: string | null; sort_order: number | null }[] | null }
    | { id: string; title: string; category: ProductCategory; product_media: { media_type: string; public_url: string | null; sort_order: number | null }[] | null }[] | null;
};
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * Orders under dispute, refunded or cancelled, newest first. Read-only for suppliers: disputes are opened by
 * buyers and settled by SokoGlobal ops; the order page carries the chat and the full timeline.
 */
export default async function SupplierReturnsPage() {
  const { supabase, user, profile } = await getSessionProfile();
  if (!user || !profile) redirect('/login?redirectTo=/supplier/returns');
  if (profile.role !== 'supplier') redirect('/dashboard');

  // RLS limits orders to the supplier's own listings.
  const { data } = await supabase.from('orders')
    .select('id, escrow_status, goods_cents, total_cents, created_at, product:products!inner ( id, title, category, supplier_id, product_media ( media_type, public_url, sort_order ) )')
    .eq('product.supplier_id', user.id).in('escrow_status', RETURN_STATUSES)
    .order('created_at', { ascending: false }).limit(200);
  const rows = (data ?? []) as unknown as Row[];
  const open = rows.filter((r) => r.escrow_status === 'disputed');
  const refunded = rows.filter((r) => r.escrow_status === 'refunded');

  return (
    <>
      <DashboardHeader profile={profile} />
      <main className="page-wide pb-16 pt-8">
        <PageHead eyebrow="After-sales" title="Returns & disputes">
          Orders a buyer disputed, plus refunded and cancelled ones. Disputed orders stay in escrow while SokoGlobal reviews them.
        </PageHead>

        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          <Panel as="div"><p className="text-sm text-neutral-500">Open disputes</p><p className="sx-stat mt-2">{open.length}</p></Panel>
          <Panel as="div"><p className="text-sm text-neutral-500">Refunded</p><p className="sx-stat mt-2">{refunded.length}</p></Panel>
          <Panel as="div"><p className="text-sm text-neutral-500">Goods value under dispute</p><p className="sx-stat mt-2">{formatUSD(open.reduce((n, r) => n + (r.goods_cents ?? 0), 0))}</p></Panel>
        </div>

        <Panel as="div" className="mt-4 overflow-hidden !p-0">
          {rows.length === 0 ? (
            <div className="px-6 py-14 text-center">
              <ShieldAlert className="mx-auto h-6 w-6 text-neutral-500" aria-hidden />
              <p className="mt-3 text-sm text-neutral-500">No disputes, refunds or cancellations. Nice.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="sx-table min-w-[720px]">
                <caption className="sr-only">Disputed, refunded and cancelled orders</caption>
                <thead><tr><th scope="col">Order</th><th scope="col">Product</th><th scope="col">Placed</th><th scope="col">Status</th><th scope="col" className="text-right">Goods value</th><th scope="col"><span className="sr-only">Open</span></th></tr></thead>
                <tbody>
                  {rows.map((r) => {
                    const p = one(r.product);
                    const img = [...(p?.product_media ?? [])].filter((m) => m.media_type === 'image' && m.public_url)
                      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))[0]?.public_url ?? null;
                    return (
                      <tr key={r.id}>
                        <td className="font-mono text-xs text-neutral-500">#{r.id.slice(0, 8).toUpperCase()}</td>
                        <td>
                          <span className="flex min-w-0 items-center gap-3">
                            <span className="sx-thumb"><ProductVisual src={img} alt="" category={p?.category ?? 'general'} className="h-full w-full" /></span>
                            <span className="max-w-[16rem] truncate">{p?.title ?? 'Product'}</span>
                          </span>
                        </td>
                        <td className="whitespace-nowrap text-neutral-500">{day(r.created_at)}</td>
                        <td><OrderStatusPill status={r.escrow_status} /></td>
                        <td className="text-right tabular-nums">{formatUSD(r.goods_cents ?? 0)}</td>
                        <td className="text-right"><Link href={`/supplier/orders/${r.id}`} className="btn-secondary px-3 py-1.5 text-xs">Details</Link></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </main>
    </>
  );
}
