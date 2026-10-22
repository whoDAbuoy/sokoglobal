import Link from 'next/link';
import { redirect } from 'next/navigation';
import clsx from 'clsx';
import { ArrowLeft, CalendarClock, FileQuestion, MapPin, Package, Users } from 'lucide-react';
import { getSessionProfile } from '@/lib/supabase/server';
import { countryName, flag } from '@/lib/format';
import { categoryWithin, parseTiers, type QuoteStatus } from '@/lib/rfq';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import QuoteForm from '@/components/rfq/QuoteForm';
import Price from '@/components/currency/Price';
import ShareRFQButton from '@/components/rfq/ShareRFQButton';

export const metadata = { title: 'Buyer requests · SokoGlobal' };
export const dynamic = 'force-dynamic';

interface FeedRow {
  id: string; title: string; description: string; quantity: number; unit_of_measure: string | null; target_price_kes: number | null;
  delivery_location: string; category_id: string | null; category_name: string | null; buyer_country: string | null; status: string;
  created_at: string; expires_at: string; quote_count: number;
  /** Migration 022: the feed lists every live request; quoting still needs a listing in the category. */
  can_quote?: boolean;
  my_quote: { id: string; product_id: string; unit_price_kes: number; price_tiers: unknown; moq: number; lead_time_days: number | null;
              terms_note: string | null; valid_until: string; allowed_payment_structures: string[]; status: QuoteStatus } | null;
}

const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/**
 * Supplier RFQ lane: every live buyer request (supplier_rfq_feed(), migration 022) — ones matching the
 * supplier's live listings first — plus requests they have already quoted. Requests outside their
 * categories can't be quoted, but can be shared with a supplier who can fulfil them. Quotes are private.
 */
export default async function SupplierRfqsPage() {
  const { supabase, user, profile } = await getSessionProfile();
  if (!user || !profile) redirect('/login?redirectTo=/supplier/rfqs');
  if (profile.role !== 'supplier') redirect('/dashboard/rfqs');

  const [{ data: feed, error }, { data: products }, { data: cats }] = await Promise.all([
    supabase.rpc('supplier_rfq_feed'),
    supabase.from('products').select('id, title, category_id').eq('supplier_id', user.id).eq('status', 'live').order('title'),
    supabase.from('categories').select('id, parent_id'),
  ]);
  if (error) throw new Error(`Could not load buyer requests: ${error.message}`);

  const parentOf = new Map((cats ?? []).map((c) => [c.id as string, (c.parent_id as string | null) ?? null]));
  const listings = (products ?? []) as { id: string; title: string; category_id: string | null }[];
  const rows = (feed ?? []) as FeedRow[];
  const now = Date.now();
  const open = rows.filter((r) => (r.status === 'open' || r.status === 'quoted') && Date.parse(r.expires_at) > now);
  const closed = rows.filter((r) => !open.includes(r));

  const card = (r: FeedRow) => {
    const unit = r.unit_of_measure ?? 'units';
    const eligible = listings.filter((p) => categoryWithin(p.category_id, r.category_id, parentOf));
    const q = r.my_quote;
    const live = open.includes(r);
    return (
      <li key={r.id}>
        <article className="card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-lg font-semibold text-neutral-900"><Link href={`/rfqs/${r.id}`} className="hover:underline">{r.title}</Link></h3>
              <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-neutral-600">
                <span className="inline-flex items-center gap-1"><Package className="h-3.5 w-3.5" aria-hidden />{r.quantity.toLocaleString('en-US')} {unit}</span>
                <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" aria-hidden />{r.delivery_location}
                  {r.buyer_country && <> · {flag(r.buyer_country)} {countryName(r.buyer_country)}</>}</span>
                {r.target_price_kes && <span>Target <Price kes={Number(r.target_price_kes)} /> / unit</span>}
                {r.category_name && <span>{r.category_name}</span>}
              </p>
            </div>
            {q && <span className={clsx('pill whitespace-nowrap', q.status === 'accepted' ? 'tone-escrow' : q.status === 'rejected' ? 'tone-muted' : 'tone-transit')}>
              {q.status === 'pending' ? 'Quoted' : q.status === 'accepted' ? 'Accepted' : 'Declined'}</span>}
          </div>
          <p className="mt-3 line-clamp-4 whitespace-pre-line text-sm text-neutral-700">{r.description}</p>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-neutral-200 pt-4">
            <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-500">
              <span className="inline-flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" aria-hidden />{live ? `Quotes close ${day(r.expires_at)}` : `Closed ${day(r.expires_at)}`}</span>
              <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" aria-hidden />{r.quote_count} quote{r.quote_count === 1 ? '' : 's'} so far</span>
              {q && <span>Your price: <Price kes={Number(q.unit_price_kes)} /> · MOQ {q.moq.toLocaleString('en-US')}</span>}
            </p>
            <div className="flex flex-wrap items-center gap-2">
            {live && <ShareRFQButton rfqId={r.id} title={r.title} />}
            {live && q?.status !== 'accepted' && (
              eligible.length && r.can_quote !== false
                ? <QuoteForm rfqId={r.id} products={eligible.map(({ id, title }) => ({ id, title }))} buyerQuantity={r.quantity}
                    defaults={q ? { quoteId: q.id, productId: q.product_id, unitPriceKes: Number(q.unit_price_kes), moq: q.moq, leadTimeDays: q.lead_time_days,
                                    termsNote: q.terms_note, tiers: parseTiers(q.price_tiers), allowed: q.allowed_payment_structures } : {}} />
                : <p className="text-xs text-neutral-500">Outside your categories — share it with a supplier who can fulfil it.</p>
            )}
            {q?.status === 'accepted' && <Link href="/supplier/orders" className="btn-secondary px-3 py-1.5 text-sm">Go to orders</Link>}
            </div>
          </div>
        </article>
      </li>
    );
  };

  return (
    <>
      <DashboardHeader profile={profile} />
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
        <Link href="/supplier" className="inline-flex items-center gap-1 text-sm text-neutral-600 hover:text-neutral-900"><ArrowLeft className="h-4 w-4" aria-hidden /> Catalogue</Link>
        <p className="eyebrow mt-4">Sourcing</p>
        <h1 className="mt-2 text-3xl font-semibold text-neutral-900">Buyer requests</h1>
        <p className="mt-1 max-w-2xl text-sm text-neutral-600">
          Volume requests from verified importers — ones in your categories first. Send a private quote against one of your listings,
          or share a request with a supplier who can fulfil it. Accepted quotes become escrow orders you fulfil from your orders page.
        </p>

        {open.length === 0 ? (
          <div className="card mt-8 px-6 py-14 text-center">
            <FileQuestion className="mx-auto h-8 w-8 text-neutral-400" aria-hidden />
            <p className="mt-3 font-medium text-neutral-900">No open buyer requests right now</p>
            <p className="mt-1 text-sm text-neutral-600">
              {listings.length ? 'New requests appear here as soon as buyers post them.' : 'You can quote on requests in the categories of your live listings — publish one to start quoting.'}
            </p>
          </div>
        ) : (
          <ul className="mt-8 space-y-5">{open.map(card)}</ul>
        )}

        {closed.length > 0 && (
          <section aria-labelledby="past" className="mt-12">
            <h2 id="past" className="text-sm font-semibold text-neutral-900">Past requests you quoted</h2>
            <ul className="mt-4 space-y-4 opacity-90">{closed.map(card)}</ul>
          </section>
        )}
      </main>
    </>
  );
}
