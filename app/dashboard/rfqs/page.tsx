import Link from 'next/link';
import { redirect } from 'next/navigation';
import clsx from 'clsx';
import { BadgeCheck, CalendarClock, FileQuestion, MapPin, Package } from 'lucide-react';
import { getSessionProfile } from '@/lib/supabase/server';
import { countryName, flag } from '@/lib/format';
import { RFQ_STATUS_LABEL, canDeleteRfq, categoryOptions, effectiveRfqStatus, parseTiers, type QuoteStatus, type RfqStatus } from '@/lib/rfq';
import { PAYMENT_STRUCTURE_LABEL, type PaymentStructure } from '@/lib/milestone';
import { UUID_RE } from '@/lib/uploads';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import RfqForm, { type RfqPrefill } from '@/components/rfq/RfqForm';
import { AcceptQuoteButton, CloseRfqButton, RejectQuoteButton } from '@/components/rfq/QuoteActions';
import Price from '@/components/currency/Price';
import DeleteRfqButton from '@/components/rfq/DeleteRfqButton';
import ShareRFQButton from '@/components/rfq/ShareRFQButton';

export const metadata = { title: 'Requests for quote · SokoGlobal', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

interface QuoteRow {
  id: string; status: QuoteStatus; unit_price_kes: number; price_tiers: unknown; moq: number; lead_time_days: number | null;
  valid_until: string; terms_note: string | null; allowed_payment_structures: PaymentStructure[]; created_at: string;
  product: { title: string; unit_of_measure: string | null } | null;
  supplier: { company_name: string; country_code: string; kyc_verified: boolean } | null;
}
interface RfqRow {
  id: string; title: string; description: string; quantity: number; unit_of_measure: string | null; target_price_kes: number | null;
  delivery_location: string; status: RfqStatus; order_id: string | null; created_at: string; expires_at: string;
  category: { name: string } | null; quotes: QuoteRow[];
}

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const TONE: Record<RfqStatus, string> = { open: 'tone-pending', quoted: 'tone-transit', accepted: 'tone-escrow', rejected: 'tone-muted', expired: 'tone-muted' };

/**
 * Buyer RFQ hub: post custom volume requests, compare the private quotes that
 * matching suppliers send, accept one (→ a locked escrow order) or decline.
 */
export default async function BuyerRfqsPage({ searchParams }: { searchParams: Promise<{ product?: string; quantity?: string }> }) {
  const { product: productParam, quantity: quantityParam } = await searchParams;
  const { supabase, user, profile } = await getSessionProfile();
  if (!user || !profile) redirect('/login?redirectTo=/dashboard/rfqs');
  if (profile.role === 'supplier') redirect('/supplier/rfqs');

  const [{ data: rfqData, error }, { data: cats }, prefillProduct] = await Promise.all([
    supabase.from('rfqs')
      .select(`id, title, description, quantity, unit_of_measure, target_price_kes, delivery_location, status, order_id, created_at, expires_at,
               category:categories ( name ),
               quotes:rfq_quotes!rfq_quotes_rfq_id_fkey ( id, status, unit_price_kes, price_tiers, moq, lead_time_days, valid_until, terms_note, allowed_payment_structures, created_at,
                                   product:products ( title, unit_of_measure ),
                                   supplier:profiles!rfq_quotes_supplier_id_fkey ( company_name, country_code, kyc_verified ) )`)
      .eq('buyer_id', user.id).order('created_at', { ascending: false }).limit(100),
    supabase.from('categories').select('id, parent_id, name, sort_order').eq('is_active', true),
    productParam && UUID_RE.test(productParam)
      ? supabase.from('products').select('id, title, category_id, unit_of_measure').eq('id', productParam).eq('status', 'live').maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (error) throw new Error(`Could not load your requests: ${error.message}`);

  const rfqs = ((rfqData ?? []) as unknown as RfqRow[]).map((r) => ({
    ...r, category: one(r.category), status: effectiveRfqStatus(r), dbStatus: r.status,
    quotes: (r.quotes ?? []).map((q) => ({ ...q, product: one(q.product), supplier: one(q.supplier), tiers: parseTiers(q.price_tiers) }))
      .sort((a, b) => Number(a.unit_price_kes) - Number(b.unit_price_kes)),
  }));
  const p = prefillProduct.data as { id: string; title: string; category_id: string | null; unit_of_measure: string | null } | null;
  const qty = Number(quantityParam);
  const prefill: RfqPrefill = p
    ? { title: p.title, productId: p.id, categoryId: p.category_id, unitOfMeasure: p.unit_of_measure, quantity: Number.isInteger(qty) && qty > 0 ? qty : undefined }
    : {};
  const kycApproved = profile.kyc_status === 'approved' || (!profile.kyc_status && profile.kyc_verified);
  const now = Date.now();

  return (
    <>
      <DashboardHeader profile={profile} />
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="border-b border-neutral-200 pb-6">
          <p className="eyebrow">Sourcing</p>
          <h1 className="mt-2 text-3xl font-semibold text-neutral-900">Requests for quote</h1>
          <p className="mt-1 max-w-2xl text-sm text-neutral-600">
            Need a volume, grade or price that isn&apos;t listed? Describe it once; verified suppliers quote privately. Accepted quotes
            become escrow orders — with the option to pay 30% upfront and 70% when your goods ship.
          </p>
        </div>

        <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <section aria-labelledby="my-rfqs" className="min-w-0">
            <h2 id="my-rfqs" className="sr-only">Your requests</h2>
            {rfqs.length === 0 ? (
              <div className="card px-6 py-14 text-center">
                <FileQuestion className="mx-auto h-8 w-8 text-neutral-400" aria-hidden />
                <p className="mt-3 font-medium text-neutral-900">No requests yet</p>
                <p className="mt-1 text-sm text-neutral-600">Post your first request — quotes usually arrive within a few days.</p>
              </div>
            ) : (
              <ul className="space-y-5">
                {rfqs.map((r) => {
                  const live = r.status === 'open' || r.status === 'quoted';
                  const unit = r.unit_of_measure ?? 'units';
                  return (
                    <li key={r.id}>
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
                          <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-500">
                            <span className="inline-flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" aria-hidden />
                              Posted {day(r.created_at)} · {live ? `quotes close ${day(r.expires_at)}` : `closed`}</span>
                            {live && <CloseRfqButton rfqId={r.id} />}
                            {canDeleteRfq({ status: r.dbStatus, hasOrder: !!r.order_id }, { isOwner: true, isSuperAdmin: false }) && (
                              <DeleteRfqButton rfqId={r.id} title={r.title} quoteCount={r.quotes.length} />
                            )}
                            {live && <ShareRFQButton rfqId={r.id} title={r.title} className="inline-flex items-center gap-1 text-sm text-neutral-600 hover:text-neutral-900" />}
                            {r.order_id && <Link href={`/dashboard/orders/${r.order_id}`} className="font-medium text-blue-700 underline-offset-4 hover:underline dark:text-blue-400">View order</Link>}
                          </p>
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
                                  {live && q.status === 'pending' && !expired && (
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
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <aside className="lg:sticky lg:top-24 lg:self-start">
            <RfqForm categories={categoryOptions((cats ?? []) as { id: string; parent_id: string | null; name: string; sort_order: number }[])} prefill={prefill}
              disabledReason={profile.role !== 'importer' ? 'Requests for quote are for importer accounts.'
                : !kycApproved ? 'Verify your business (KYC) to request quotes.' : null} />
            {!kycApproved && profile.role === 'importer' && (
              <Link href="/dashboard/kyc" className="btn-secondary mt-3 w-full">Verify my business</Link>
            )}
          </aside>
        </div>
      </main>
    </>
  );
}
