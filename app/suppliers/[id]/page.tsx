import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BadgeCheck, CalendarDays, MessageSquare, Package, Star } from 'lucide-react';
import { getPublicListings, getPublicSupplier } from '@/lib/public-catalog';
import { countryName, flag } from '@/lib/format';
import { initials } from '@/lib/admin-inbox';
import { metaDescription, siteUrl, supplierJsonLd, supplierPath, SITE_NAME } from '@/lib/seo';
import JsonLd from '@/components/seo/JsonLd';
import GoldBadge from '@/components/supplier/GoldBadge';
import { ListingGrid, PublicHeader } from '@/components/public/PublicCatalog';

/**
 * Public supplier profile (migration 036): company, country, verification, Gold, rating and live
 * listings, for buyers and crawlers alike. Following, messaging and ordering need an account; the
 * signed-in profile at /dashboard/suppliers/[id] keeps those actions.
 */
type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const supplier = await getPublicSupplier(id);
  if (!supplier) return { title: `Supplier not found · ${SITE_NAME}`, robots: { index: false } };
  // "Verified" only when KYC is approved: the title is what search results show.
  const title = `${supplier.company_name} · ${supplier.kyc_verified ? 'Verified supplier' : 'Supplier'} in ${countryName(supplier.country_code)}`;
  const description = metaDescription(supplier.bio)
    || `${supplier.live_listings} escrow-protected Trial Batch${supplier.live_listings === 1 ? '' : 'es'} from ${supplier.company_name}, landed in Africa with freight and customs included.`;
  const url = `${siteUrl()}${supplierPath(supplier.id)}`;
  return {
    title: `${title} · ${SITE_NAME}`,
    description,
    alternates: { canonical: url },
    openGraph: { type: 'profile', url, title, description, siteName: SITE_NAME, images: supplier.avatar_url ? [supplier.avatar_url] : [] },
  };
}

export default async function PublicSupplierPage({ params }: Props) {
  const { id } = await params;
  // Profile and listings are independent: one round trip, not two.
  const [supplier, listings] = await Promise.all([getPublicSupplier(id), getPublicListings({ supplierId: id, limit: 48 })]);
  if (!supplier) notFound();
  const since = new Date(supplier.created_at).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  return (
    <>
      <JsonLd data={supplierJsonLd(supplier, siteUrl(), listings)} />
      <PublicHeader />
      <main className="page-wide py-8 lg:py-12">
        <section aria-labelledby="supplier-name" className="glass-card flex flex-wrap items-center gap-5 p-6">
          <span className="relative grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-2xl bg-gradient-to-br from-[#5a9895] to-teal-600 text-lg font-semibold text-snow">
            {supplier.avatar_url
              ? <Image src={supplier.avatar_url} alt="" fill sizes="64px" className="object-cover" />
              : initials(supplier.company_name)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="eyebrow">Supplier</p>
            <h1 id="supplier-name" className="mt-1 flex flex-wrap items-center gap-2 text-2xl font-semibold text-neutral-900">
              {supplier.company_name}
              {supplier.kyc_verified && <span className="pill tone-escrow text-[11px]"><BadgeCheck className="h-3.5 w-3.5" aria-hidden /> KYC verified</span>}
              {supplier.gold && <GoldBadge />}
            </h1>
            <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-neutral-600">
              <span>{flag(supplier.country_code)} {countryName(supplier.country_code)}</span>
              <span className="inline-flex items-center gap-1"><CalendarDays className="h-4 w-4" aria-hidden /> On SokoGlobal since {since}</span>
              <span className="inline-flex items-center gap-1"><Package className="h-4 w-4" aria-hidden /> {supplier.live_listings} live listing{supplier.live_listings === 1 ? '' : 's'}</span>
              {supplier.rating_count > 0 && supplier.rating_average !== null && (
                <span className="inline-flex items-center gap-1"><Star className="h-4 w-4 fill-amber-400 text-amber-400" aria-hidden />
                  {supplier.rating_average.toFixed(1)} from {supplier.rating_count} verified buyer{supplier.rating_count === 1 ? '' : 's'}</span>
              )}
            </p>
            {supplier.bio && <p className="mt-3 max-w-3xl whitespace-pre-line text-sm leading-relaxed text-neutral-700">{supplier.bio}</p>}
          </div>
          <Link href={`/dashboard/suppliers/${supplier.id}`} className="btn-secondary px-4 py-2">
            <MessageSquare className="h-4 w-4" aria-hidden /> Follow or message
          </Link>
        </section>

        <section aria-labelledby="listings-title" className="mt-10">
          <h2 id="listings-title" className="mb-4 text-xl font-semibold text-neutral-900">Trial Batches from {supplier.company_name}</h2>
          {listings.length
            ? <ListingGrid listings={listings} showSupplier={false} label={`Listings from ${supplier.company_name}`} />
            : <p className="glass-card px-6 py-8 text-center text-sm text-neutral-600">No live listings right now.</p>}
        </section>
      </main>
    </>
  );
}
