import Link from 'next/link';
import { ChevronDown, Clock, Lock, MapPin, PackageCheck, Truck } from 'lucide-react';
import { catalogTotals, type ListingGroup } from '@/lib/supplier-orders';
import { countryName, flag, formatUSD } from '@/lib/format';
import ProductVisual from '@/components/dashboard/ProductVisual';
import ShipOrderDialog, { type ExistingShipment } from './ShipOrderDialog';
import OrderChatButton from '@/components/chat/OrderChatButton';

const DAY = 86_400_000;
const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const waiting = (iso: string | null, now: number) => {
  if (!iso) return null;
  const d = Math.floor((now - Date.parse(iso)) / DAY);
  return d <= 0 ? 'paid today' : `waiting ${d} day${d === 1 ? '' : 's'}`;
};

/** Listing Catalog Cards: one per listing with paid orders to ship; buyers in a collapsible list (server-rendered, no JS). */
export default function OrderCatalog({ groups, shipments = {}, now = Date.now() }: {
  groups: ListingGroup[];
  /** Waybills already saved (label created, not yet handed over), by order id. */
  shipments?: Record<string, ExistingShipment>;
  now?: number;
}) {
  const totals = catalogTotals(groups);
  return (
    <>
        <dl className="mt-6 grid gap-3 sm:grid-cols-3">
          {[
            { label: 'Listings with orders', value: String(totals.listings), icon: PackageCheck },
            { label: 'Paid orders to ship', value: String(totals.orders), icon: Truck },
            { label: 'Goods value in escrow', value: formatUSD(totals.goodsCents), icon: Lock },
          ].map(({ label, value, icon: Icon }) => (
            <div key={label} className="card flex items-center gap-4 p-4">
              <span className="grid h-10 w-10 place-items-center rounded-lg border tone-escrow"><Icon className="h-5 w-5" aria-hidden /></span>
              <div><dd className="text-2xl font-semibold tabular-nums text-neutral-900">{value}</dd><dt className="text-sm text-neutral-600">{label}</dt></div>
            </div>
          ))}
        </dl>

        {groups.length === 0 ? (
          <div className="card mt-8 px-6 py-14 text-center">
            <PackageCheck className="mx-auto h-8 w-8 text-neutral-400" aria-hidden />
            <p className="mt-3 font-medium text-neutral-900">Nothing waiting to ship</p>
            <p className="mt-1 text-sm text-neutral-600">New paid orders appear here as soon as the payment is confirmed.</p>
          </div>
        ) : (
          <ul className="mt-8 space-y-5">
            {groups.map((g) => (
              <li key={g.listing_id}>
                <article className="card overflow-hidden">
                  <div className="flex flex-wrap items-center gap-4 p-4 sm:flex-nowrap sm:p-5">
                    <ProductVisual src={g.image_url} alt="" category="general" className="h-20 w-20 shrink-0 rounded-[14px]" />
                    <div className="min-w-0 flex-1">
                      <h2 className="line-clamp-2 text-lg font-semibold text-neutral-900">{g.title}</h2>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-neutral-600">
                        <span>{g.order_count} buyer order{g.order_count === 1 ? '' : 's'}</span>
                        {waiting(g.oldest_paid_at, now) && <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" aria-hidden /> oldest {waiting(g.oldest_paid_at, now)}</span>}
                      </p>
                    </div>
                    <dl className="grid w-full grid-cols-2 gap-4 sm:w-auto sm:text-right">
                      <div>
                        <dt className="eyebrow">To ship</dt>
                        <dd className="mt-1 text-xl font-semibold tabular-nums text-neutral-900">{g.total_quantity.toLocaleString('en-US')} <span className="text-sm font-normal text-neutral-600">{g.unit_of_measure ?? 'units'}</span></dd>
                        <dd className="text-xs text-neutral-600">{g.total_batches} trial batch{g.total_batches === 1 ? '' : 'es'}</dd>
                      </div>
                      <div>
                        <dt className="eyebrow">Pending value</dt>
                        <dd className="mt-1 text-xl font-semibold tabular-nums text-neutral-900">{formatUSD(g.total_goods_cents, true)}</dd>
                        <dd className="text-xs text-neutral-600">{formatUSD(g.total_landed_cents)} landed</dd>
                      </div>
                    </dl>
                  </div>
                  <details className="group border-t border-neutral-200">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-neutral-800 hover:bg-neutral-50 sm:px-5 [&::-webkit-details-marker]:hidden">
                      Buyer delivery details
                      <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
                    </summary>
                    <ul className="divide-y divide-neutral-200 border-t border-neutral-200">
                      {g.orders.map((o) => (
                        <li key={o.order_id} className="grid gap-2 px-4 py-3 text-sm sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto_auto] sm:items-center sm:px-5">
                          <div className="min-w-0">
                            <p className="truncate font-medium text-neutral-900">{o.buyer_company ?? 'Buyer'} {o.buyer_country && <span className="font-normal text-neutral-600">· {flag(o.buyer_country)} {countryName(o.buyer_country)}</span>}</p>
                            <p className="font-mono text-xs text-neutral-600">#{o.order_id.slice(0, 8).toUpperCase()} · paid {date(o.paid_at)}</p>
                            {(o.is_rfq || o.payment_structure === 'milestone_30_70') && (
                              <p className="mt-1 flex flex-wrap gap-1.5">
                                {o.is_rfq && <span className="pill tone-muted">Quoted order</span>}
                                {o.payment_structure === 'milestone_30_70' && (
                                  <span className="pill tone-transit">{o.escrow_status === 'deposit_paid' ? '30% deposit paid · 70% due on dispatch' : 'Milestone escrow'}</span>
                                )}
                              </p>
                            )}
                          </div>
                          <div className="min-w-0 text-neutral-700">
                            <p className="flex items-center gap-1.5 truncate"><MapPin className="h-3.5 w-3.5 shrink-0 text-neutral-500" aria-hidden />{o.destination ?? (o.buyer_country ? countryName(o.buyer_country) : 'Destination set at booking')}</p>
                            <p className="text-xs text-neutral-600">
                              {o.tracking_number ? `${o.carrier ?? 'Carrier'} ${o.tracking_number}` : 'Awaiting pickup booking'}{o.eta ? ` · ETA ${date(o.eta)}` : ''}
                            </p>
                          </div>
                          <p className="tabular-nums text-neutral-900 sm:text-right">
                            {o.quantity.toLocaleString('en-US')} {g.unit_of_measure ?? 'units'}<span className="block text-xs text-neutral-600">{formatUSD(o.goods_cents, true)}</span>
                          </p>
                          <div className="flex flex-wrap gap-2 sm:justify-end">
                            <Link href={`/supplier/orders/${o.order_id}`} className="btn-secondary px-3 py-1.5 text-sm">Details</Link>
                            <OrderChatButton orderId={o.order_id} label="Message buyer"
                              title={`Order #${o.order_id.slice(0, 8).toUpperCase()} · ${g.title}`} />
                            <ShipOrderDialog orderId={o.order_id} existing={shipments[o.order_id] ?? null}
                              orderLabel={`${g.title} · ${o.quantity.toLocaleString('en-US')} ${g.unit_of_measure ?? 'units'} for ${o.buyer_company ?? 'buyer'} (#${o.order_id.slice(0, 8).toUpperCase()})`}
                              milestoneBalanceDue={o.escrow_status === 'deposit_paid'} />
                          </div>
                        </li>
                      ))}
                    </ul>
                  </details>
                </article>
              </li>
            ))}
          </ul>
        )}
    </>
  );
}
