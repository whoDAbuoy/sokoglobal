import Link from 'next/link';
import { redirect } from 'next/navigation';
import { FileQuestion } from 'lucide-react';
import { getSessionProfile } from '@/lib/supabase/server';
import { categoryOptions, effectiveRfqStatus, parseTiers, type QuoteStatus, type RfqStatus } from '@/lib/rfq';
import type { PaymentStructure } from '@/lib/milestone';
import { UUID_RE } from '@/lib/uploads';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import RfqForm, { type RfqPrefill } from '@/components/rfq/RfqForm';
import RFQCard, { type BuyerRfq } from '@/components/rfq/RFQCard';
import { getPricing, goldSupplierIds } from '@/lib/pricing-server';
import { dollarsToCents } from '@/lib/pricing';

export const metadata = { title: 'Requests for quote · SokoGlobal', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

interface QuoteRow {
  id: string; supplier_id: string; status: QuoteStatus; unit_price_kes: number; price_tiers: unknown; moq: number; lead_time_days: number | null;
  valid_until: string; terms_note: string | null; allowed_payment_structures: PaymentStructure[]; created_at: string;
  product: { title: string; unit_of_measure: string | null } | null;
  supplier: { company_name: string; country_code: string; kyc_verified: boolean } | null;
}
interface RfqRow {
  id: string; title: string; description: string; quantity: number; unit_of_measure: string | null; target_price_kes: number | null;
  buyer_id: string; delivery_location: string; status: RfqStatus; order_id: string | null; created_at: string; expires_at: string;
  is_featured?: boolean; needs_white_glove?: boolean;
  category: { name: string } | null; quotes: QuoteRow[];
}

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

/**
 * Buyer RFQ hub: post custom volume requests, compare the private quotes that
 * matching suppliers send, accept one (→ a locked escrow order) or decline.
 */
export default async function BuyerRfqsPage({ searchParams }: { searchParams: Promise<{ product?: string; quantity?: string; status?: string }> }) {
  const { product: productParam, quantity: quantityParam, status: returnStatus } = await searchParams;
  const { supabase, user, profile } = await getSessionProfile();
  if (!user || !profile) redirect('/login?redirectTo=/dashboard/rfqs');
  if (profile.role === 'supplier') redirect('/supplier/rfqs');

  const [{ data: rfqData, error }, { data: cats }, prefillProduct, pricing] = await Promise.all([
    supabase.from('rfqs')
      .select(`id, buyer_id, title, description, quantity, unit_of_measure, target_price_kes, delivery_location, status, order_id, created_at, expires_at,
               is_featured, needs_white_glove, category:categories ( name ),
               quotes:rfq_quotes!rfq_quotes_rfq_id_fkey ( id, supplier_id, status, unit_price_kes, price_tiers, moq, lead_time_days, valid_until, terms_note, allowed_payment_structures, created_at,
                                   product:products ( title, unit_of_measure ),
                                   supplier:profiles!rfq_quotes_supplier_id_fkey ( company_name, country_code, kyc_verified ) )`)
      .eq('buyer_id', user.id).order('created_at', { ascending: false }).limit(100),
    supabase.from('categories').select('id, parent_id, name, sort_order').eq('is_active', true),
    productParam && UUID_RE.test(productParam)
      ? supabase.from('products').select('id, title, category_id, unit_of_measure').eq('id', productParam).eq('status', 'live').maybeSingle()
      : Promise.resolve({ data: null }),
    getPricing(supabase),
  ]);
  if (error) throw new Error(`Could not load your requests: ${error.message}`);
  // Add-ons are offered once migration 026 is in (prices are display copies; Postgres prices the charge).
  const addonPrices = pricing.available
    ? { featured: dollarsToCents(pricing.pricing.featured_rfq_price), white_glove: dollarsToCents(pricing.pricing.white_glove_sourcing_fee) }
    : undefined;

  const rows = (rfqData ?? []) as unknown as RfqRow[];
  const gold = await goldSupplierIds(supabase, rows.flatMap((r) => (r.quotes ?? []).map((q) => q.supplier_id)));
  const rfqs: BuyerRfq[] = rows.map((r) => ({
    ...r, category: one(r.category), status: effectiveRfqStatus(r), dbStatus: r.status,
    quotes: (r.quotes ?? []).map((q) => {
      const supplier = one(q.supplier);
      return { ...q, unit_price_kes: Number(q.unit_price_kes), product: one(q.product), supplier: supplier && { ...supplier, gold: gold.has(q.supplier_id) }, tiers: parseTiers(q.price_tiers) };
    })
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
        {returnStatus === 'processing' && (
          <p role="status" className="mt-6 rounded-xl border px-4 py-3 text-sm tone-active">
            Payment received — we&apos;re confirming it with Paystack. Your add-ons switch on within a minute; refresh to see them.
          </p>
        )}

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
                {rfqs.map((r) => (
                  <li key={r.id}><RFQCard rfq={r} viewer={{ userId: user.id, role: profile.role }} kycApproved={kycApproved} now={now} addonPrices={addonPrices} buyerName={profile.full_name}
                    escrowFeeRate={pricing.available ? pricing.pricing.escrow_fee_percent : 0} /></li>
                ))}
              </ul>
            )}
          </section>

          <aside className="lg:sticky lg:top-32 lg:self-start">
            <RfqForm categories={categoryOptions((cats ?? []) as { id: string; parent_id: string | null; name: string; sort_order: number }[])} prefill={prefill}
              addonPrices={addonPrices} buyerName={profile.full_name}
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
