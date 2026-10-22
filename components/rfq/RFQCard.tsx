import Link from 'next/link';
import clsx from 'clsx';
import { ArrowUpRight, BadgeCheck, CalendarClock, MapPin, Package } from 'lucide-react';
import { countryName, flag } from '@/lib/format';
import { RFQ_STATUS_LABEL, rfqDeleteBlock, showsRfqDelete, type PriceTier, type QuoteStatus, type RfqStatus } from '@/lib/rfq';
import { PAYMENT_STRUCTURE_LABEL, type PaymentStructure } from '@/lib/milestone';
import type { UserRole } from '@/lib/types';
import { AcceptQuoteButton, CloseRfqButton, RejectQuoteButton } from './QuoteActions';
import DeleteRfqButton from './DeleteRfqButton';
import ShareRFQButton from './ShareRFQButton';
import Price from '@/components/currency/Price';

export interface BuyerRfqQuote {
  id: string; status: QuoteStatus; unit_price_kes: number; tiers: PriceTier[]; moq: number; lead_time_days: number | null;
  valid_until: string; terms_note: string | null; allowed_payment_structures: PaymentStructure[];
  product: { title: string; unit_of_measure: string | null } | null;
  supplier: { company_name: string; country_code: string; kyc_verified: boolean } | null;
}
export interface BuyerRfq {
  id: string; buyer_id: string; title: string; description: string; quantity: number; unit_of_measure: string | null; target_price_kes: number | null;
  delivery_location: string; order_id: string | null; created_at: string; expires_at: string; category: { name: string } | null;
  /** As the user should see it (expired once past the deadline). */
  status: RfqStatus;
  /** As stored (what the delete policy checks). */
  dbStatus: RfqStatus;
  quotes: BuyerRfqQuote[];
}

const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const TONE: Record<RfqStatus, string> = { open: 'tone-pending', quoted: 'tone-transit', accepted: 'tone-escrow', rejected: 'tone-muted', expired: 'tone-muted' };

/**
 * One request on the buyer's RFQ hub: details, an action bar (View details · Share · Delete, plus
 * Close / View order) and the private quotes received. Delete shows for the buyer and super admins.
 */
export default function RFQCard({ rfq: r, viewer, kycApproved, now }: {
  rfq: BuyerRfq; viewer: { userId: string; role: UserRole }; kycApproved: boolean; now: number;
}) {
  const live = r.status === 'open' || r.status === 'quoted';
  const unit = r.unit_of_measure ?? 'units';
  const who = { isOwner: viewer.userId === r.buyer_id, isSuperAdmin: viewer.role === 'super_admin' };

  return (
    <article className="card overflow-hidden">
      <header className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-neutral-900"><Link href={`/rfqs/${r.id}`} className="hover:underline">{r.title}</Link></h3>
            <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-neutral-600">
              <span className="inline-flex items-center gap-1"><Package className="h-3.5 w-3.5" aria-hidden />{r.quantity.toLocaleString('en-US')} {unit}</span>
              <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" aria-hidden />{r.delivery_location}</span>
              {r.target_price_kes && <span>Target <Price kes={Number(r.target_price_kes)} /> / {unit.replace(/s$/, '')}</span>}
              {r.category && <span>{r.category.name}</span>}
            </p>
          </div>
          <span className={clsx('pill whitespace-nowrap', TONE[r.status])}>{RFQ_STATUS_LABEL[r.status]}</span>
        </div>
        <p className="mt-3 line-clamp-3 whitespace-pre-line text-sm text-neutral-700">{r.description}</p>
        <p className="mt-3 flex items-center gap-1 text-xs text-neutral-500">
          <CalendarClock className="h-3.5 w-3.5" aria-hidden /> Posted {day(r.created_at)} · {live ? `quotes close ${day(r.expires_at)}` : 'closed'}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-neutral-200 pt-4" role="group" aria-label={`Actions for ${r.title}`}>
          <Link href={`/rfqs/${r.id}`} className="btn-secondary px-3 py-1.5 text-sm">View details <ArrowUpRight className="h-3.5 w-3.5" aria-hidden /></Link>
          {live && <ShareRFQButton rfqId={r.id} title={r.title} />}
          {showsRfqDelete(who) && (
            <DeleteRfqButton rfqId={r.id} title={r.title} quoteCount={r.quotes.length}
              disabledReason={rfqDeleteBlock({ status: r.dbStatus, hasOrder: !!r.order_id }, who)} />
          )}
          {r.order_id && <Link href={`/dashboard/orders/${r.order_id}`} className="btn-primary px-3 py-1.5 text-sm">View order</Link>}
          {live && who.isOwner && <span className="ml-auto"><CloseRfqButton rfqId={r.id} /></span>}
        </div>
      </header>

      {r.quotes.length > 0 ? (
        <ul className="divide-y divide-neutral-200 border-t border-neutral-200 bg-neutral-50/60">
          {r.quotes.map((q) => {
            const expired = Date.parse(q.valid_until) <= now;
            const quoteUnit = q.product?.unit_of_measure ?? unit;
            return (
              <li key={q.id} className="grid gap-3 p-5 sm:grid-cols-[minmax(0,1fr)_auto]">
                <div className="min-w-0 text-sm">
                  <p className="flex flex-wrap items-center gap-2 font-medium text-neutral-900">
                    {q.supplier?.company_name ?? 'Supplier'}
                    {q.supplier?.kyc_verified && <BadgeCheck className="h-4 w-4 text-emerald-600" aria-label="Verified supplier" />}
                    {q.supplier?.country_code && <span className="font-normal text-neutral-600">{flag(q.supplier.country_code)} {countryName(q.supplier.country_code)}</span>}
                    {q.status !== 'pending' && <span className={clsx('pill', q.status === 'accepted' ? 'tone-escrow' : 'tone-muted')}>{q.status}</span>}
                    {q.status === 'pending' && expired && <span className="pill tone-muted">expired</span>}
                  </p>
                  {q.product && <p className="text-neutral-600">For listing: {q.product.title}</p>}
                  <p className="mt-2 text-lg font-semibold tabular-nums text-neutral-900">
                    <Price kes={Number(q.unit_price_kes)} /> <span className="text-sm font-normal text-neutral-600">/ {quoteUnit.replace(/s$/, '')} · MOQ {q.moq.toLocaleString('en-US')}</span>
                  </p>
                  {q.tiers.length > 0 && (
                    <p className="mt-1 flex flex-wrap gap-1.5 text-xs">
                      {q.tiers.map((t) => <span key={t.min_qty} className="pill tone-muted">{t.min_qty.toLocaleString('en-US')}+ · <Price kes={t.unit_price_kes} /></span>)}
                    </p>
                  )}
                  <p className="mt-2 text-xs text-neutral-600">
                    {q.lead_time_days ? `Ships in ${q.lead_time_days} days · ` : ''}Valid until {day(q.valid_until)} ·{' '}
                    {q.allowed_payment_structures.map((s) => PAYMENT_STRUCTURE_LABEL[s] ?? s).join(' or ')}
                  </p>
                  {q.terms_note && <p className="mt-2 whitespace-pre-line rounded-md border border-neutral-200 bg-white/60 p-2.5 text-xs text-neutral-700 dark:bg-transparent">{q.terms_note}</p>}
                </div>
                {live && who.isOwner && q.status === 'pending' && !expired && (
                  <div className="flex flex-wrap items-start gap-2 sm:flex-col sm:items-end">
                    <AcceptQuoteButton quoteId={q.id} supplierName={q.supplier?.company_name ?? 'the supplier'} rfqQuantity={r.quantity} unit={quoteUnit}
                      quote={{ unit_price_kes: Number(q.unit_price_kes), price_tiers: q.tiers, moq: q.moq }}
                      allowed={q.allowed_payment_structures} kycApproved={kycApproved} />
                    <RejectQuoteButton quoteId={q.id} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : live ? (
        <p className="border-t border-neutral-200 bg-neutral-50/60 px-5 py-3 text-sm text-neutral-600">Waiting for suppliers to quote.</p>
      ) : null}
    </article>
  );
}
