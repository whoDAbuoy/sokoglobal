import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft, FileDown } from 'lucide-react';
import { getSessionProfile } from '@/lib/supabase/server';
import { formatUSD } from '@/lib/format';
import type { EscrowStatus, OrderView } from '@/lib/types';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import EscrowTracker from '@/components/dashboard/EscrowTracker';
import SupportWidget from '@/components/dashboard/SupportWidget';
import OrderActions from './OrderActions';
import { getPaymentSettings, methodsFor } from '@/lib/payment-settings-server';
import { cryptoOptions, type ManualPaymentView } from '@/lib/payment-methods';
import MessageSupplierButton from '@/components/chat/MessageSupplierButton';
import OrderChatButton from '@/components/chat/OrderChatButton';
import { orderChatOpen } from '@/lib/chat-admin';
import AnimatedShipmentMap from '@/components/tracking/AnimatedShipmentMap';
import { invoiceAvailable } from '@/lib/documents/model';
import { milestoneEligible, paymentStep, type PaymentStructure } from '@/lib/milestone';
import { trackingLink, trackingTimeline, type TimelineShipment } from '@/lib/shipping';
import OrderTimeline from '@/components/tracking/OrderTimeline';
import TrackingTimeline from '@/components/shipping/TrackingTimeline';
import { isDhlCarrier } from '@/lib/shipping/dhl';
import PaymentStructureChooser from '@/components/payments/PaymentStructureChooser';
import Price, { LocalPreview } from '@/components/currency/Price';
import { formatRate } from '@/lib/pricing';

const EVENT_LABEL: Record<string, string> = {
  status_change: 'Status updated',
  early_payout_requested: 'Supplier chose an early payout — your escrow protection is unchanged',
  payout_initiated: 'Supplier payout sent',
  payout_succeeded: 'Supplier paid',
  payout_failed: 'Supplier payout issue — our team is on it',
  payout_on_hold: 'Supplier payout pending verification',
};
/** Early payouts (migration 026) are funded by SokoGlobal before you confirm delivery; your money stays protected. */
const EARLY_EVENT_LABEL: Record<string, string> = {
  payout_initiated: 'Supplier paid early by SokoGlobal — your escrow protection is unchanged',
  payout_succeeded: 'Supplier paid early by SokoGlobal',
  payout_on_hold: 'Early supplier payout pending verification',
};

/**
 * Order detail + return page after a Bank Card payment. Query params such as
 * ?status=successful are only used for messaging — escrow state comes from the
 * database, which only the verified webhook can change.
 */
export default async function OrderPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string; pay?: string; gw?: string; token?: string; TransactionToken?: string }>;
}) {
  const [{ id }, { status: returnStatus, pay, gw, token: paypalToken, TransactionToken: dpoToken }] = await Promise.all([params, searchParams]);
  const { supabase, user, profile } = await getSessionProfile();
  if (!user || !profile) redirect(`/login?redirectTo=/dashboard/orders/${id}`);

  const { data: order } = await supabase
    .from('orders')
    .select(`id, order_type, escrow_status, quantity, checkout_group_id, product_id, goods_cents, freight_cents, customs_cents, total_cents,
             created_at, buyer_id, discharge_timestamp, eta_timestamp, origin_port_coords, destination_coords,
             route_waypoints, current_status, origin_label, destination_label, funded_at, delivered_at,
             payment_structure, deposit_amount, remaining_balance, deposit_paid_at, final_paid_at, rfq_quote_id, fx_rate_to_kes,
             escrow_fee_cents, escrow_fee_rate,
             product:products ( title, trial_units ),
             shipments ( status, carrier_name, tracking_number, tracking_url, estimated_delivery, dispatched_at, delivered_at )`)
    .eq('id', id)
    .maybeSingle();
  if (!order || order.buyer_id !== user.id) notFound();

  const { data: events } = await supabase
    .from('escrow_events').select('id, from_status, to_status, event_type, note, metadata, created_at')
    .eq('order_id', id).order('created_at', { ascending: true });

  const product = (Array.isArray(order.product) ? order.product[0] : order.product) as { title: string; trial_units: number } | null;
  // Trial Batches in this order (quantity is stored in units; migration 010 also records it as orders.batches).
  const batches = product?.trial_units ? Math.max(1, Math.round(order.quantity / product.trial_units)) : 1;
  const view: OrderView = {
    id: order.id, order_type: order.order_type, escrow_status: order.escrow_status as EscrowStatus,
    total_cents: order.total_cents, created_at: order.created_at, product_title: product?.title ?? 'Order',
    payment_structure: order.payment_structure, is_rfq: !!order.rfq_quote_id,
  };
  const shipment = ((Array.isArray(order.shipments) ? order.shipments[0] : order.shipments) ?? null) as (TimelineShipment & { tracking_url: string | null }) | null;
  const step = paymentStep({ ...order, escrow_status: view.escrow_status });
  const dueCents = step.kind === 'pay_full' || step.kind === 'pay_deposit' || step.kind === 'pay_balance' ? step.amountCents : 0;
  const milestone = order.payment_structure === 'milestone_30_70';
  const kycApproved = profile.kyc_status === 'approved' || (!profile.kyc_status && profile.kyc_verified);
  // Paid orders, and accepted quotes from the moment they are accepted (migration 025).
  const chatOpen = orderChatOpen({ ...order, escrow_status: view.escrow_status });
  // Migration 026: the escrow fee is part of total_cents (0 on older orders); M-Pesa charges also carry the FX spread.
  const escrowFee = (order.escrow_fee_cents as number | null) ?? 0;
  // Migration 028: methods switched on + configured + within limits, and any open wire / crypto transfer.
  const [payments, { data: manualRows }] = await Promise.all([
    getPaymentSettings(supabase),
    supabase.from('manual_payments')
      .select('id, method, network, leg, usd_cents, fee_cents, charge_cents, reference, pay_to, tx_hash, proof_path, status, review_note, created_at, submitted_at')
      .eq('order_id', id).order('created_at', { ascending: false }).limit(1),
  ]);
  const lastManual = (manualRows?.[0] ?? null) as ManualPaymentView | null;
  const openManual = lastManual && (lastManual.status === 'awaiting' || lastManual.status === 'submitted') ? lastManual : null;
  const methods = methodsFor({ settings: payments.settings, fxSpread: payments.fxSpread, dueCents, cart: !!order.checkout_group_id });
  const gatewayReturn = gw === 'paypal' && paypalToken ? { gateway: 'paypal' as const, token: paypalToken }
    : gw === 'dpo' && dpoToken ? { gateway: 'dpo' as const, token: dpoToken } : null;
  const canChoose = view.escrow_status === 'pending_payment' && !order.checkout_group_id && !order.rfq_quote_id && order.order_type !== 'pool';

  return (
    <>
      <DashboardHeader profile={profile} />
      <main className="page-wide py-10">
        <Link href="/dashboard/orders" className="inline-flex items-center gap-1 text-sm text-neutral-500 transition-colors hover:text-neutral-900">
          <ArrowLeft className="h-4 w-4" /> My Orders
        </Link>
        <div className="mt-6 border-b border-neutral-200 pb-6">
          <p className="eyebrow">
            Order #{order.id.slice(0, 8).toUpperCase()} · {order.rfq_quote_id ? 'Quoted order · ' : batches > 1 ? `${batches} Trial Batches · ` : ''}{order.quantity.toLocaleString('en-US')} units
          </p>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-3xl font-semibold text-neutral-900">{view.product_title}</h1>
            <div className="flex flex-wrap items-center gap-2">
              {chatOpen && <OrderChatButton orderId={order.id} title={`Order #${order.id.slice(0, 8).toUpperCase()} · ${view.product_title}`} label="Chat with Supplier" className="btn-primary px-3.5 py-2" />}
              <MessageSupplierButton productId={order.product_id} productTitle={view.product_title} />
            </div>
          </div>
        </div>

        <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0">
        <EscrowTracker orders={[view]} actions={false} />

        <OrderTimeline className="mt-6" steps={trackingTimeline({ ...order, escrow_status: view.escrow_status }, shipment)}
          trackingUrl={shipment && shipment.status !== 'label_created' ? trackingLink(shipment) : null} />

        {/* Live DHL Express scans once the supplier has dispatched with DHL (renders nothing until DHL tracking is configured). */}
        {shipment && shipment.status !== 'label_created' && isDhlCarrier(shipment.carrier_name) && (
          <TrackingTimeline className="mt-6" orderId={order.id} trackingUrl={trackingLink(shipment)} />
        )}

        {canChoose && (
          <PaymentStructureChooser orderId={order.id} totalCents={order.total_cents} structure={(order.payment_structure ?? 'full') as PaymentStructure}
            kycApproved={kycApproved}
            eligible={milestoneEligible({ totalCents: order.total_cents, kycApproved, inCart: !!order.checkout_group_id, orderType: order.order_type })} />
        )}

        {order.checkout_group_id && view.escrow_status === 'pending_payment' ? (
          // Cart orders are paid together, from their checkout (per-order payment is refused in Postgres).
          <div className="card mt-6 flex flex-wrap items-center justify-between gap-4 p-5">
            <div>
              <p className="font-medium text-neutral-900">Part of a cart checkout</p>
              <p className="text-sm text-neutral-500">This Trial Batch is paid together with the rest of your cart.</p>
            </div>
            <Link href={`/dashboard/checkout/${order.checkout_group_id}`} className="btn-primary">Go to checkout</Link>
          </div>
        ) : (
          <OrderActions orderId={order.id} status={view.escrow_status} step={step} returnStatus={returnStatus ?? null} payWith={pay ?? null}
            amountLabel={formatUSD(dueCents, true)} balanceLabel={order.remaining_balance ? formatUSD(order.remaining_balance, true) : undefined}
            buyerName={profile.full_name} methods={methods} gatewayReturn={gatewayReturn}
            manual={{ buyerId: user.id, dueCents, open: openManual, rejectedNote: lastManual?.status === 'rejected' ? lastManual.review_note ?? '' : null,
                      swift: payments.settings.swift_bank_details, cryptoOptions: cryptoOptions(payments.settings.crypto_deposit_wallets),
                      cryptoMarkup: payments.settings.crypto_markup_percent }} />
        )}

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

        <section className="glass-card mt-6 p-6">
          <h2 className="eyebrow">Escrow audit trail</h2>
          <ol className="mt-5 space-y-4 border-l border-neutral-200 pl-5">
            {(events ?? []).map((e) => (
              <li key={e.id} className="relative text-sm">
                <span className="absolute -left-[25px] top-1.5 h-2 w-2 rounded-full bg-blue-600 ring-4 ring-blue-600/15 dark:bg-cyan-400 dark:ring-cyan-400/15" />
                <p className="font-medium capitalize text-neutral-900">
                  {e.event_type === 'status_change' ? String(e.to_status).replace(/_/g, ' ')
                    : (e.metadata as { early?: boolean } | null)?.early && e.event_type in EARLY_EVENT_LABEL ? EARLY_EVENT_LABEL[e.event_type]
                    : EVENT_LABEL[e.event_type] ?? e.event_type.replace(/_/g, ' ')}
                </p>
                <p className="text-xs text-neutral-500">{new Date(e.created_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</p>
              </li>
            ))}
          </ol>
        </section>
        </div>

        {/* Order summary — checkout-style sidebar */}
        <aside className="lg:sticky lg:top-32 lg:self-start">
          <section className="glass-card p-6">
            <h2 className="eyebrow">{order.rfq_quote_id ? 'Quoted price' : 'Guaranteed Landed Cost'}</h2>
            <dl className="mt-5 space-y-3 text-sm text-neutral-600">
              {(order.rfq_quote_id
                ? [['Goods, delivered as quoted', order.goods_cents]]
                : [['Product', order.goods_cents], ['Consolidated air freight', order.freight_cents], ['Customs clearance & duties', order.customs_cents]]
              ).concat(escrowFee > 0 ? [[`Escrow protection fee (${formatRate(Number(order.escrow_fee_rate) || 0)})`, escrowFee]] : []).map(([l, v]) => (
                <div key={l as string} className="flex justify-between gap-3"><dt>{l}</dt><dd className="tabular-nums text-neutral-900"><Price cents={v as number} /></dd></div>
              ))}
              <div className="flex items-baseline justify-between border-t border-black/[0.06] pt-4 text-neutral-900 dark:border-snow/[0.08]">
                <dt className="font-medium">{milestone ? 'Order total' : 'Total held in escrow'}</dt>
                <dd className="text-xl font-semibold tabular-nums">{formatUSD(order.total_cents, true)}</dd>
              </div>
              <LocalPreview cents={order.total_cents} className="block text-right text-xs tabular-nums text-neutral-500" />
              {milestone && order.deposit_amount != null && order.remaining_balance != null && (
                <div className="space-y-2 border-t border-black/[0.06] pt-4 dark:border-snow/[0.08]">
                  {[
                    { label: '30% deposit', cents: order.deposit_amount, paid: order.deposit_paid_at, due: 'due now' },
                    { label: '70% balance', cents: order.remaining_balance, paid: order.final_paid_at, due: 'due on dispatch' },
                  ].map((m) => (
                    <div key={m.label} className="flex justify-between gap-3">
                      <dt>{m.label} <span className={m.paid ? 'text-emerald-700' : 'text-neutral-500'}>· {m.paid ? 'in escrow' : m.due}</span></dt>
                      <dd className="tabular-nums text-neutral-900">{formatUSD(m.cents, true)}</dd>
                    </div>
                  ))}
                </div>
              )}
              {order.rfq_quote_id && order.fx_rate_to_kes && (
                <p className="text-xs text-neutral-500">
                  Quoted in KES and converted at KES {Number(order.fx_rate_to_kes).toLocaleString('en-US', { maximumFractionDigits: 2 })} per US dollar when you accepted. Escrow is held in USD.
                </p>
              )}
            </dl>
            {invoiceAvailable(view.escrow_status) && (
              // Plain link: the route streams a PDF with Content-Disposition: attachment.
              <a href={`/api/orders/${order.id}/invoice`} className="btn-secondary mt-5 w-full py-2 text-sm">
                <FileDown className="h-4 w-4" aria-hidden /> Download commercial invoice (PDF)
              </a>
            )}
          </section>
        </aside>
        </div>
      </main>
      <SupportWidget orders={[view]} />
    </>
  );
}
