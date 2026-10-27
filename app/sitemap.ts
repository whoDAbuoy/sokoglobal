import type { MetadataRoute } from 'next';
import { getSitemapEntries } from '@/lib/public-catalog';
import { productPath, siteUrl, supplierPath } from '@/lib/seo';
import { LEGAL_DOCS } from '@/lib/legal';

/**
 * /sitemap.xml: the landing page, every public listing and every supplier with one (migration 036's
 * public_sitemap_entries(): listings and suppliers come back from one call, already filtered to live,
 * non-deleted listings of suppliers in good standing). Built on request (one database call; crawlers
 * fetch it rarely), never at build time, so a deploy doesn't depend on the database being reachable.
 * A database error fails the request rather than serving an empty sitemap. One sitemap holds at most
 * 50,000 URLs; past that, split it with generateSitemaps().
 */
export const dynamic = 'force-dynamic';
const MAX_URLS = 50_000;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = siteUrl();
  const entries = await getSitemapEntries();
  const urls: MetadataRoute.Sitemap = [
    { url: `${origin}/`, changeFrequency: 'daily', priority: 1 },
    { url: `${origin}/products`, changeFrequency: 'daily', priority: 0.9 },
    ...LEGAL_DOCS.map((d) => ({ url: `${origin}${d.href}`, changeFrequency: 'yearly' as const, priority: 0.2 })),
  ];
  for (const e of entries) {
    if (urls.length >= MAX_URLS) break;
    urls.push(e.kind === 'product'
      ? { url: `${origin}${productPath(e.id, e.name)}`, lastModified: new Date(e.last_modified), changeFrequency: 'weekly', priority: 0.8 }
      : { url: `${origin}${supplierPath(e.id, e.name)}`, lastModified: new Date(e.last_modified), changeFrequency: 'weekly', priority: 0.6 });
  }
  return urls;
}
