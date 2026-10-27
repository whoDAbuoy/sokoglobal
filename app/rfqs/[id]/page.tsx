import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import clsx from 'clsx';
import { ArrowLeft, CalendarClock, MapPin, Package, Tag } from 'lucide-react';
import { getSessionProfile } from '@/lib/supabase/server';
import { getCategories } from '@/lib/categories-server';
import { RFQ_STATUS_LABEL, categoryWithin, rfqDeleteBlock, showsRfqDelete, effectiveRfqStatus, parseTiers, type QuoteStatus, type RfqStatus } from '@/lib/rfq';
import { UUID_RE } from '@/lib/uploads';
import { isSuperAdmin } from '@/lib/auth/admin-access';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import QuoteForm from '@/components/rfq/QuoteForm';
import ShareRFQButton from '@/components/rfq/ShareRFQButton';
import DeleteRfqButton from '@/components/rfq/DeleteRfqButton';
import Price from '@/components/currency/Price';

export const metadata = { title: 'Buyer request · SokoGlobal', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const TONE: Record<RfqStatus, string> = { open: 'tone-pending', quoted: 'tone-transit', accepted: 'tone-escrow', rejected: 'tone-muted', expired: 'tone-muted' };
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * Shareable request page (/rfqs/<id>). Any signed-in user can open a live
 * request (migration 022 RLS); the buyer and quoting suppliers also see it
 * after it closes. Suppliers with a listing in the category can quote here;
 * anyone can pass the link on to a fulfiller.
 */
export default async function RfqDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user, profile } = await getSessionProfile();
  if (!user || !profile) redirect(`/login?redirectTo=/rfqs/${encodeURIComponent(id)}`);
  if (!UUID_RE.test(id)) notFound();

  // A supplier's own quote, live listings and the category tree don't depend on the request row,
  // so they load alongside it (a supplier never owns an RFQ: only importers can post one).
  const supplierView = profile.role === 'supplier';
  const [{ data: rfq }, supplierData] = await Promise.all([
    supabase.from('rfqs')
      .select('id, buyer_id, title, description, quantity, unit_of_measure, target_price_kes, delivery_location, status, order_id, category_id, created_at, expires_at, category:categories ( name )')
      .eq('id', id).maybeSingle(),
    supplierView
      ? Promise.all([
          supabase.from('rfq_quotes').select('id, product_id, unit_price_kes, price_tiers, moq, lead_time_days, terms_note, allowed_payment_structures, status')
            .eq('rfq_id', id).eq('supplier_id', user.id).maybeSingle(),
          supabase.from('products').select('id, title, category_id').eq('supplier_id', user.id).eq('status', 'live').order('title'),
          getCategories(),
        ])
      : null,
  ]);
  if (!rfq) notFound();

  const status = effectiveRfqStatus(rfq as { status: RfqStatus; expires_at: string });
  const live = status === 'open' || status === 'quoted';
  const isOwner = rfq.buyer_id === user.id;
  const who = { isOwner, isSuperAdmin: isSuperAdmin(profile) };
  const unit = (rfq.unit_of_measure as string | null) ?? 'units';
  const category = (Array.isArray(rfq.category) ? rfq.category[0] : rfq.category) as { name: string } | null;

  // Supplier view: their own quote, and which of their live listings may quote (same rule as submit_rfq_quote).
  let quoteBlock: React.ReactNode = null;
  if (supplierData && !isOwner) {
    const [{ data: myQuote }, { data: products }, cats] = supplierData;
    const parentOf = new Map((cats ?? []).map((c) => [c.id, c.parent_id ?? null]));
    const eligible = (products ?? []).filter((p) => categoryWithin(p.category_id as string | null, rfq.category_id as string | null, parentOf));
    const q = myQuote as { id: string; product_id: string; unit_price_kes: number; price_tiers: unknown; moq: number; lead_time_days: number | null;
      terms_note: string | null; allowed_payment_structures: string[]; status: QuoteStatus } | null;
    quoteBlock = (
      <div className="card mt-6 p-5">
        {q && <p className="mb-3 text-sm text-neutral-700">Your quote: <Price kes={Number(q.unit_price_kes)} /> / unit · MOQ {q.moq.toLocaleString('en-US')} · <span className="font-medium">{q.status}</span></p>}
        {live && q?.status !== 'accepted' && (eligible.length
          ? <QuoteForm rfqId={id} products={eligible.map((p) => ({ id: p.id as string, title: p.title as string }))} buyerQuantity={rfq.quantity as number}
              defaults={q ? { quoteId: q.id, productId: q.product_id, unitPriceKes: Number(q.unit_price_kes), moq: q.moq, leadTimeDays: q.lead_time_days,
                              termsNote: q.terms_note, tiers: parseTiers(q.price_tiers), allowed: q.allowed_payment_structures } : {}} />
          : <p className="text-sm text-neutral-600">You need a live listing in {category ? `“${category.name}”` : 'this category'} to quote. Know a supplier who can fulfil it? Share the link with them.</p>)}
        {!live && !q && <p className="text-sm text-neutral-600">This request is no longer taking quotes.</p>}
      </div>
    );
  }

  return (
    <>
      <DashboardHeader profile={profile} />
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href={isOwner ? '/dashboard/rfqs' : profile.role === 'supplier' ? '/supplier/rfqs' : '/dashboard'}
            className="inline-flex items-center gap-1 text-sm text-neutral-600 hover:text-neutral-900">
            <ArrowLeft className="h-4 w-4" aria-hidden /> {isOwner ? 'My requests' : profile.role === 'supplier' ? 'Buyer requests' : 'Dashboard'}
          </Link>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Request actions">
            {live && <ShareRFQButton rfqId={id} title={rfq.title} />}
            {showsRfqDelete(who) && (
              <DeleteRfqButton rfqId={id} title={rfq.title} variant="danger" label="Delete Request"
                redirectTo={isOwner ? '/dashboard/rfqs' : '/admin'}
                disabledReason={rfqDeleteBlock({ status: rfq.status as RfqStatus, hasOrder: !!rfq.order_id }, who)} />
            )}
          </div>
        </div>

        <article className="card mt-6 p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="eyebrow">Request for quote</p>
              <h1 className="mt-2 text-2xl font-semibold text-neutral-900">{rfq.title}</h1>
            </div>
            <span className={clsx('pill whitespace-nowrap', TONE[status])}>{RFQ_STATUS_LABEL[status]}</span>
          </div>
          <dl className="mt-4 grid gap-3 text-sm text-neutral-700 sm:grid-cols-2">
            <div className="flex items-center gap-2"><Package className="h-4 w-4 text-neutral-500" aria-hidden /><dt className="sr-only">Quantity</dt><dd>{(rfq.quantity as number).toLocaleString('en-US')} {unit}</dd></div>
            <div className="flex items-center gap-2"><MapPin className="h-4 w-4 text-neutral-500" aria-hidden /><dt className="sr-only">Deliver to</dt><dd>{rfq.delivery_location}</dd></div>
            {rfq.target_price_kes && <div className="flex items-center gap-2"><Tag className="h-4 w-4 text-neutral-500" aria-hidden /><dt className="sr-only">Target price</dt><dd>Target <Price kes={Number(rfq.target_price_kes)} /> per unit</dd></div>}
            <div className="flex items-center gap-2"><CalendarClock className="h-4 w-4 text-neutral-500" aria-hidden /><dt className="sr-only">Deadline</dt><dd>{live ? `Quotes close ${day(rfq.expires_at)}` : `Posted ${day(rfq.created_at)}`}</dd></div>
          </dl>
          {category && <p className="mt-3 text-sm text-neutral-600">Category: {category.name}</p>}
          <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-neutral-800">{rfq.description}</p>

          {isOwner && (
            <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-neutral-200 pt-4">
              <Link href="/dashboard/rfqs" className="btn-secondary px-3 py-1.5 text-sm">Compare quotes</Link>
              {rfq.order_id && <Link href={`/dashboard/orders/${rfq.order_id}`} className="btn-primary px-3 py-1.5 text-sm">View order</Link>}
            </div>
          )}
        </article>

        {quoteBlock}
      </main>
    </>
  );
}
