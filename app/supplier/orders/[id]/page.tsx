import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import clsx from 'clsx';
import { ArrowLeft, Banknote, Truck, Zap } from 'lucide-react';
import { getSessionProfile } from '@/lib/supabase/server';
import { formatUSD } from '@/lib/format';
import { UUID_RE } from '@/lib/uploads';
import { statusMeta, type Tone } from '@/lib/order-status';
import { PAYMENT_STRUCTURE_LABEL, type PaymentStructure } from '@/lib/milestone';
import { SHIPMENT_STAGE_LABEL, trackingLink } from '@/lib/shipping';
import { formatRate } from '@/lib/pricing';
import type { EscrowStatus } from '@/lib/types';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import OrderChatButton from '@/components/chat/OrderChatButton';
import ShipOrderDialog, { type ExistingShipment } from '@/components/supplier/ShipOrderDialog';
import EarlyPayoutPanel, { type EarlyPayoutQuote } from '@/components/supplier/EarlyPayoutPanel';

export const metadata = { title: 'Order · SokoGlobal Supplier' };
export const dynamic = 'force-dynamic';

const TONE: Record<Tone, string> = { warning: 'tone-pending', escrow: 'tone-escrow', success: 'tone-active', danger: 'tone-danger', muted: 'tone-muted' };
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const PAYOUT_LABEL: Record<string, string> = { processing: 'Transfer in progress', succeeded: 'Paid', failed: 'Failed — retrying', on_hold: 'On hold' };

/**
 * One paid order from the supplier's side: what was ordered, the shipment, and
 * the payout — including the Instant Early Payout (migration 026) once the order
 * is fully paid and dispatched. RLS shows suppliers only paid orders of their own listings.
 */
export default async function SupplierOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const { supabase, user, profile } = await getSessionProfile();
  if (!user || !profile) redirect(`/login?redirectTo=/supplier/orders/${id}`);
  if (profile.role !== 'supplier') redirect('/dashboard');

  const { data: order } = await supabase.from('orders')
    .select(`id, escrow_status, quantity, goods_cents, payment_structure, funded_at, final_paid_at, created_at, destination_label,
             commission_rate, early_payout_requested_at, early_payout_fee_rate, rfq_quote_id,
             product:products ( title, supplier_id )`)
    .eq('id', id).maybeSingle();
  const product = one(order?.product as unknown as { title: string; supplier_id: string } | null);
  if (!order || product?.supplier_id !== user.id) notFound();

  const [{ data: shipment }, { data: payout }, quoteRes] = await Promise.all([
    supabase.from('shipments').select('status, carrier_name, tracking_number, tracking_url, estimated_delivery, dispatched_at').eq('order_id', id).maybeSingle(),
    supabase.from('payouts').select('status, gross_cents, fee_cents, early_payout_fee_cents, amount_cents, currency, early, created_at, completed_at').eq('order_id', id).maybeSingle(),
    supabase.rpc('early_payout_quote', { p_order_id: id }),
  ]);
  const quote = quoteRes.error ? null : quoteRes.data as EarlyPayoutQuote | null;
  const status = order.escrow_status as EscrowStatus;
  const meta = statusMeta(status);
  const title = product?.title ?? 'Order';
  const ref = `#${order.id.slice(0, 8).toUpperCase()}`;
  const ship = shipment as (ExistingShipment & { dispatched_at: string | null }) | null;
  const link = ship ? trackingLink(ship) : null;
  const commission = order.commission_rate !== null ? Number(order.commission_rate) : null;
  const canShip = ['funded', 'deposit_paid', 'in_transit', 'customs_cleared'].includes(status);

  return (
    <>
      <DashboardHeader profile={profile} />
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
        <Link href="/supplier/orders" className="inline-flex items-center gap-1 text-sm text-neutral-600 hover:text-neutral-900"><ArrowLeft className="h-4 w-4" aria-hidden /> Orders</Link>
        <div className="mt-4 flex flex-wrap items-start justify-between gap-3 border-b border-neutral-200 pb-6">
          <div className="min-w-0">
            <p className="eyebrow">Order {ref} · {order.quantity.toLocaleString('en-US')} units{order.rfq_quote_id ? ' · quoted' : ''}</p>
            <h1 className="mt-2 text-3xl font-semibold text-neutral-900">{title}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={clsx('pill', TONE[meta.tone])}>{meta.label}</span>
            <OrderChatButton orderId={order.id} label="Message buyer" title={`Order ${ref} · ${title}`} />
          </div>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="min-w-0 space-y-6">
            <section aria-labelledby="summary" className="card p-5">
              <h2 id="summary" className="font-semibold text-neutral-900">Order</h2>
              <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                <div><dt className="text-neutral-500">Goods value (your payout before fees)</dt><dd className="font-medium tabular-nums text-neutral-900">{formatUSD(order.goods_cents, true)}</dd></div>
                <div><dt className="text-neutral-500">Payment terms</dt><dd className="font-medium text-neutral-900">{PAYMENT_STRUCTURE_LABEL[(order.payment_structure ?? 'full') as PaymentStructure] ?? order.payment_structure}</dd></div>
                <div><dt className="text-neutral-500">Paid into escrow</dt><dd className="font-medium text-neutral-900">{day(order.funded_at)}{order.payment_structure === 'milestone_30_70' ? (order.final_paid_at ? ` · balance ${day(order.final_paid_at)}` : ' · balance due on dispatch') : ''}</dd></div>
                <div><dt className="text-neutral-500">Commission</dt><dd className="font-medium text-neutral-900">{commission !== null ? formatRate(commission) : 'Standard rate'}</dd></div>
                {order.destination_label && <div><dt className="text-neutral-500">Deliver to</dt><dd className="font-medium text-neutral-900">{order.destination_label}</dd></div>}
              </dl>
            </section>

            <section aria-labelledby="shipment" className="card p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 id="shipment" className="flex items-center gap-2 font-semibold text-neutral-900"><Truck className="h-4 w-4 text-neutral-500" aria-hidden /> Shipment</h2>
                {canShip && <ShipOrderDialog orderId={order.id} existing={ship} orderLabel={`${title} (${ref})`}
                  milestoneBalanceDue={status === 'deposit_paid' && !order.final_paid_at} />}
              </div>
              {ship ? (
                <p className="mt-3 text-sm text-neutral-700">
                  {SHIPMENT_STAGE_LABEL[ship.status]} · {ship.carrier_name}{' '}
                  {link ? <a href={link} target="_blank" rel="noopener noreferrer" className="font-mono underline underline-offset-2">{ship.tracking_number}</a> : <span className="font-mono">{ship.tracking_number}</span>}
                  {ship.dispatched_at && ` · dispatched ${day(ship.dispatched_at)}`}
                </p>
              ) : <p className="mt-3 text-sm text-neutral-600">No waybill yet. Add it when the goods leave your warehouse.</p>}
            </section>
          </div>

          <aside aria-labelledby="payout" className="card h-fit p-5">
            <h2 id="payout" className="flex items-center gap-2 font-semibold text-neutral-900">
              {payout?.early || (!payout && quote) ? <Zap className="h-4 w-4 text-yellow-600 dark:text-yellow-300" aria-hidden /> : <Banknote className="h-4 w-4 text-neutral-500" aria-hidden />}
              {payout ? 'Payout' : 'Instant Early Payout'}
            </h2>
            {payout ? (
              <dl className="mt-3 space-y-2 text-sm text-neutral-600">
                <div className="flex justify-between gap-3"><dt>Status</dt><dd className="font-medium text-neutral-900">{PAYOUT_LABEL[payout.status] ?? payout.status}{payout.early ? ' · early' : ''}</dd></div>
                <div className="flex justify-between gap-3"><dt>Goods value</dt><dd className="tabular-nums text-neutral-900">{formatUSD(payout.gross_cents, true)}</dd></div>
                <div className="flex justify-between gap-3"><dt>Fees</dt><dd className="tabular-nums text-neutral-900">−{formatUSD(payout.fee_cents, true)}{payout.early_payout_fee_cents ? ` (incl. ${formatUSD(payout.early_payout_fee_cents, true)} early fee)` : ''}</dd></div>
                <div className="flex justify-between gap-3 border-t border-neutral-200 pt-2 font-semibold text-neutral-900"><dt>Net</dt><dd className="tabular-nums">{formatUSD(payout.amount_cents, true)} {payout.currency}</dd></div>
                {payout.completed_at && <p className="text-xs text-neutral-500">Completed {day(payout.completed_at)}.</p>}
              </dl>
            ) : status === 'released' ? (
              <p className="mt-3 text-sm text-neutral-600">Escrow is released; your payout starts automatically.</p>
            ) : quote ? (
              <>
                <p className="mt-1 mb-4 text-sm text-neutral-600">
                  Get paid as soon as the order ships instead of waiting for the buyer to confirm delivery. Available once the buyer has paid in full and you&apos;ve added the waybill.
                </p>
                <EarlyPayoutPanel orderId={order.id} quote={quote} />
              </>
            ) : (
              <p className="mt-3 text-sm text-neutral-600">You&apos;re paid the goods value, less commission, when the buyer confirms delivery.</p>
            )}
          </aside>
        </div>
      </main>
    </>
  );
}
