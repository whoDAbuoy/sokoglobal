import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft, ChevronRight, Lock, Plane, ShieldCheck } from 'lucide-react';
import { BROWSE_PAGE_SIZE, getBrowseListings } from '@/lib/public-catalog';
import { productPath, siteUrl, SITE_NAME } from '@/lib/seo';
import JsonLd from '@/components/seo/JsonLd';
import { ListingGrid, PublicHeader } from '@/components/public/PublicCatalog';

/**
 * Public catalogue index (migration 038): every live Trial Batch, newest first, 24 per page. It is the
 * page the landing page and the public header link to, so search engines reach every listing through
 * ordinary links and not only through the sitemap (Google's SEO starter guide). Signed-in buyers keep
 * the filtered catalogue at /dashboard/discover.
 */
type Props = { searchParams: Promise<{ page?: string }> };

const pageNumber = (raw: string | undefined) => {
  const n = Number(raw ?? '1');
  return Number.isInteger(n) && n >= 1 && n <= 10_000 ? n : null;
};
const pageHref = (n: number) => (n <= 1 ? '/products' : `/products?page=${n}`);
const DESCRIPTION = 'Every live Trial Batch on SokoGlobal: verified suppliers in Europe, the Americas and Asia, one fixed landed price with freight and customs, paid into escrow.';

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const n = pageNumber((await searchParams).page);
  const title = n && n > 1 ? `Trial Batches, page ${n}` : 'Browse Trial Batches from verified suppliers';
  return {
    title: `${title} · ${SITE_NAME}`,
    description: DESCRIPTION,
    alternates: { canonical: pageHref(n ?? 1) },
    openGraph: { type: 'website', title, description: DESCRIPTION, url: pageHref(n ?? 1), siteName: SITE_NAME },
    ...(n === null ? { robots: { index: false } } : {}),
  };
}

export default async function BrowseProductsPage({ searchParams }: Props) {
  const page = pageNumber((await searchParams).page);
  if (page === null) notFound();
  const { listings, total } = await getBrowseListings(page);
  if (page > 1 && listings.length === 0) notFound();
  const pages = Math.max(1, Math.ceil(total / BROWSE_PAGE_SIZE));
  const origin = siteUrl();

  return (
    <>
      <JsonLd data={{
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        name: 'SokoGlobal Trial Batches',
        url: `${origin}${pageHref(page)}`,
        numberOfItems: total,
        itemListElement: listings.map((l, i) => ({
          '@type': 'ListItem', position: (page - 1) * BROWSE_PAGE_SIZE + i + 1, url: `${origin}${productPath(l.id, l.title)}`, name: l.title,
        })),
      }} />
      <PublicHeader />
      <main className="page-wide py-8 lg:py-12">
        <header className="max-w-3xl">
          <p className="eyebrow">Catalogue</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-neutral-900 sm:text-4xl">Trial Batches from verified suppliers</h1>
          <p className="mt-3 text-sm leading-relaxed text-neutral-600 sm:text-base">
            Test a new supplier with one small order before you commit to volume. Every price below is the landed cost:
            the goods, consolidated air freight and customs clearance to your door, paid into escrow and released only when you verify the delivery.
          </p>
          <ul className="mt-4 flex flex-wrap gap-2 text-xs">
            <li className="pill tone-escrow"><Lock className="h-3.5 w-3.5" aria-hidden /> Escrow on every order</li>
            <li className="pill tone-active"><ShieldCheck className="h-3.5 w-3.5" aria-hidden /> KYC-checked suppliers</li>
            <li className="pill tone-active"><Plane className="h-3.5 w-3.5" aria-hidden /> Freight and customs included</li>
          </ul>
        </header>

        <section aria-labelledby="listings-title" className="mt-10">
          <h2 id="listings-title" className="sr-only">Listings</h2>
          {listings.length
            ? <ListingGrid listings={listings} label={`Trial Batches, page ${page} of ${pages}`} />
            : <p className="glass-card px-6 py-10 text-center text-sm text-neutral-600">New Trial Batches are on their way. Check back soon.</p>}
        </section>

        {pages > 1 && (
          <nav aria-label="Pages" className="mt-10 flex items-center justify-between gap-3 text-sm">
            {page > 1
              ? <Link href={pageHref(page - 1)} rel="prev" className="btn-secondary px-4 py-2"><ChevronLeft className="h-4 w-4" aria-hidden /> Newer</Link>
              : <span />}
            <span className="text-neutral-500">Page {page} of {pages}</span>
            {page < pages
              ? <Link href={pageHref(page + 1)} rel="next" className="btn-secondary px-4 py-2">Older <ChevronRight className="h-4 w-4" aria-hidden /></Link>
              : <span />}
          </nav>
        )}
      </main>
    </>
  );
}
