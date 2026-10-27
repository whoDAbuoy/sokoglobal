import { Suspense } from 'react';
import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight, BadgeCheck, Clock, FileQuestion, Lock, Package, Plane, Star } from 'lucide-react';
import { getPublicListing, getPublicListings } from '@/lib/public-catalog';
import { countryName, flag, formatUSD } from '@/lib/format';
import { metaDescription, productJsonLd, productPath, siteUrl, SITE_NAME } from '@/lib/seo';
import JsonLd from '@/components/seo/JsonLd';
import Price from '@/components/currency/Price';
import GoldBadge from '@/components/supplier/GoldBadge';
import { ListingGrid, ListingGridSkeleton, PublicHeader, SupplierLink } from '@/components/public/PublicCatalog';

/**
 * Public Trial Batch page (migration 036): anyone, including search engines and AI crawlers, can read
 * a live listing, its landed price and its supplier. Ordering and quoting go through sign-in (the
 * buttons point at the signed-in catalogue / RFQ form; middleware sends visitors to /login first).
 * The listing read is cached per request, so the metadata and the page share one database call; the
 * related listings stream in behind their own Suspense boundary.
 */
type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const listing = await getPublicListing(id);
  if (!listing) return { title: `Listing not found · ${SITE_NAME}`, robots: { index: false } };
  const title = `${listing.title} · Trial Batch from ${listing.supplier_company}`;
  const description = metaDescription(listing.description)
    || `${listing.trial_units.toLocaleString('en-US')} units from ${countryName(listing.origin_country)}, ${formatUSD(listing.landed_cost_cents)} landed with freight and customs, escrow-protected.`;
  const url = `${siteUrl()}${productPath(listing.id)}`;
  return {
    title: `${title} · ${SITE_NAME}`,
    description,
    alternates: { canonical: url },
    openGraph: { type: 'website', url, title, description, siteName: SITE_NAME, images: listing.images.slice(0, 4) },
    twitter: { card: listing.images.length ? 'summary_large_image' : 'summary', title, description, images: listing.images.slice(0, 1) },
  };
}

export default async function PublicProductPage({ params }: Props) {
  const { id } = await params;
  const listing = await getPublicListing(id);
  if (!listing) notFound();

  const [cover, ...rest] = listing.images;
  const specs = Object.entries(listing.attributes)
    .filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v) && String(v).trim() !== '')
    .slice(0, 16);
  const unit = listing.unit_of_measure ?? 'units';

  return (
    <>
      <JsonLd data={productJsonLd(listing, siteUrl())} />
      <PublicHeader />
      <main className="page-wide py-8 lg:py-12">
        <nav aria-label="Breadcrumb" className="text-xs text-neutral-500">
          <ol className="flex flex-wrap items-center gap-1">
            <li><Link href="/" className="hover:text-neutral-900">Home</Link> /</li>
            {listing.category_name && <li>{listing.category_name} /</li>}
            <li aria-current="page" className="line-clamp-1 text-neutral-700">{listing.title}</li>
          </ol>
        </nav>

        <div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <section aria-label="Photos">
            <div className="glass-card relative aspect-square overflow-hidden">
              {cover
                ? <Image src={cover} alt={listing.title} fill priority sizes="(min-width: 1024px) 50vw, 100vw" className="object-cover" />
                : <Package className="absolute inset-0 m-auto h-10 w-10 text-neutral-400" aria-hidden />}
            </div>
            {rest.length > 0 && (
              <ul className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-5">
                {rest.slice(0, 9).map((src, i) => (
                  <li key={src} className="glass-card relative aspect-square overflow-hidden">
                    <Image src={src} alt={`${listing.title}, photo ${i + 2}`} fill sizes="20vw" className="object-cover" />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="listing-title">
            <p className="eyebrow">{listing.brand ?? 'Trial Batch'}</p>
            <h1 id="listing-title" className="mt-2 text-3xl font-semibold tracking-tight text-neutral-900">{listing.title}</h1>
            <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-neutral-600">
              <span>by <SupplierLink id={listing.supplier_id} name={listing.supplier_company} /></span>
              <span aria-hidden>·</span>
              <span>{flag(listing.supplier_country)} {countryName(listing.supplier_country)}</span>
              {listing.supplier_verified && <span className="pill tone-escrow text-[11px]"><BadgeCheck className="h-3.5 w-3.5" aria-hidden /> KYC verified</span>}
              {listing.supplier_gold && <GoldBadge />}
              {listing.rating_count > 0 && listing.rating_average !== null && (
                <span className="inline-flex items-center gap-1"><Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-hidden />
                  {listing.rating_average.toFixed(1)} ({listing.rating_count} rating{listing.rating_count === 1 ? '' : 's'})</span>
              )}
            </p>

            <div className="glass-card mt-6 p-5">
              <p className="text-xs uppercase tracking-eyebrow text-neutral-500">Guaranteed landed cost</p>
              <p className="mt-1 text-4xl font-semibold tabular-nums text-neutral-900"><Price cents={listing.landed_cost_cents} /></p>
              <p className="mt-1 text-sm text-neutral-600">
                {formatUSD(listing.landed_cost_cents, true)} for {listing.trial_units.toLocaleString('en-US')} {unit}: goods, air freight and customs to your door.
              </p>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div><dt className="text-neutral-500">Unit price</dt><dd className="font-medium tabular-nums text-neutral-900">{formatUSD(listing.unit_price_cents, true)}</dd></div>
                <div><dt className="text-neutral-500">Ships from</dt><dd className="font-medium text-neutral-900">{flag(listing.origin_country)} {countryName(listing.origin_country)}</dd></div>
                {listing.lead_time_days !== null && (
                  <div><dt className="flex items-center gap-1 text-neutral-500"><Clock className="h-3.5 w-3.5" aria-hidden /> Lead time</dt><dd className="font-medium text-neutral-900">{listing.lead_time_days} days + air freight</dd></div>
                )}
                {listing.moq !== null && (
                  <div><dt className="text-neutral-500">Bulk MOQ</dt><dd className="font-medium tabular-nums text-neutral-900">{listing.moq.toLocaleString('en-US')} {unit}</dd></div>
                )}
              </dl>
              <div className="mt-5 flex flex-wrap gap-2">
                <Link href={`/dashboard/discover?q=${encodeURIComponent(listing.title)}`} className="btn-primary px-5 py-2.5">
                  <Plane className="h-4 w-4" aria-hidden /> Order this Trial Batch <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
                <Link href={`/dashboard/rfqs?product=${listing.id}`} className="btn-secondary px-5 py-2.5">
                  <FileQuestion className="h-4 w-4" aria-hidden /> Request a bulk quote
                </Link>
              </div>
              <p className="mt-3 flex items-center gap-1.5 text-xs text-neutral-500">
                <Lock className="h-3.5 w-3.5" aria-hidden /> Paid into escrow. The supplier is paid only after you verify the goods.
              </p>
            </div>

            {listing.description && (
              <div className="mt-6">
                <h2 className="text-lg font-semibold text-neutral-900">About this product</h2>
                <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-neutral-700">{listing.description}</p>
              </div>
            )}
            {specs.length > 0 && (
              <div className="mt-6">
                <h2 className="text-lg font-semibold text-neutral-900">Specifications</h2>
                <dl className="glass-card mt-2 divide-y divide-black/[0.06] px-4 text-sm dark:divide-snow/[0.08]">
                  {specs.map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-4 py-2">
                      <dt className="capitalize text-neutral-500">{k.replace(/_/g, ' ')}</dt>
                      <dd className="text-right text-neutral-900">{typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </section>
        </div>

        {listing.category_id && (
          <section aria-labelledby="related-title" className="mt-16">
            <h2 id="related-title" className="mb-4 text-xl font-semibold text-neutral-900">
              More {listing.category_name ? listing.category_name.toLowerCase() : 'in this category'}
            </h2>
            <Suspense fallback={<ListingGridSkeleton label="Loading related listings" />}>
              <RelatedListings categoryId={listing.category_id} excludeId={listing.id} />
            </Suspense>
          </section>
        )}
      </main>
    </>
  );
}

/** Streams after the main listing: same category, newest first. */
async function RelatedListings({ categoryId, excludeId }: { categoryId: string; excludeId: string }) {
  const related = await getPublicListings({ categoryId, excludeId, limit: 8 });
  if (!related.length) return <p className="text-sm text-neutral-500">No other live listings in this category yet.</p>;
  return <ListingGrid listings={related} label="Related listings" />;
}
