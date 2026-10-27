/**
 * Search-engine / AI-crawler metadata (pure): canonical URLs and Schema.org JSON-LD for the public
 * listing and supplier pages (migration 036). Only public fields go in; the builders never see
 * anything the page itself doesn't show.
 */

export const SITE_NAME = 'SokoGlobal';

/** Absolute site origin without a trailing slash (NEXT_PUBLIC_SITE_URL; production default otherwise). */
export function siteUrl(env: Record<string, string | undefined> = process.env): string {
  const raw = env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://sokoglobal.com';
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host}`;
  } catch {
    return 'https://sokoglobal.com';
  }
}

export const productPath = (id: string) => `/products/${id}`;
export const supplierPath = (id: string) => `/suppliers/${id}`;

/** Plain text for meta descriptions: no line breaks or repeated spaces, cut on a word boundary. */
export function metaDescription(text: string | null | undefined, max = 160): string {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 30)).trimEnd()}…`;
}

export interface ListingForSeo {
  id: string; title: string; brand: string | null; description: string | null; category_name: string | null;
  origin_country: string; images: string[]; landed_cost_cents: number; trial_units: number;
  supplier_id: string; supplier_company: string; supplier_country: string;
  rating_average: number | null; rating_count: number;
}
export interface SupplierForSeo {
  id: string; company_name: string; country_code: string; avatar_url: string | null; bio: string | null;
}

type JsonLd = Record<string, unknown>;
const dollars = (cents: number) => (cents / 100).toFixed(2);

function aggregateRating(average: number | null, count: number): JsonLd | undefined {
  if (average === null || !Number.isFinite(average) || count < 1) return undefined;
  return { '@type': 'AggregateRating', ratingValue: average.toFixed(2), reviewCount: count, bestRating: 5, worstRating: 1 };
}

export function organizationJsonLd(s: SupplierForSeo, origin: string): JsonLd {
  return {
    '@type': 'Organization',
    '@id': `${origin}${supplierPath(s.id)}#organization`,
    name: s.company_name,
    url: `${origin}${supplierPath(s.id)}`,
    ...(s.avatar_url ? { logo: s.avatar_url } : {}),
    ...(s.bio ? { description: s.bio } : {}),
    address: { '@type': 'PostalAddress', addressCountry: s.country_code },
  };
}

/**
 * Product + Offer for one Trial Batch. A Trial Batch has one fixed landed price (goods, air freight and
 * customs to the buyer's door), so it is a single Offer, not an AggregateOffer (which needs a price range
 * across several offers). The rating is the supplier's, so it sits on the seller, not on the product.
 */
export function productJsonLd(l: ListingForSeo, origin: string): JsonLd {
  const url = `${origin}${productPath(l.id)}`;
  const seller = organizationJsonLd({ id: l.supplier_id, company_name: l.supplier_company, country_code: l.supplier_country, avatar_url: null, bio: null }, origin);
  const rating = aggregateRating(l.rating_average, l.rating_count);
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    '@id': `${url}#product`,
    name: l.title,
    url,
    ...(l.description ? { description: metaDescription(l.description, 5000) } : {}),
    ...(l.images.length ? { image: l.images.slice(0, 10) } : {}),
    ...(l.brand ? { brand: { '@type': 'Brand', name: l.brand } } : {}),
    ...(l.category_name ? { category: l.category_name } : {}),
    countryOfOrigin: l.origin_country,
    offers: {
      '@type': 'Offer',
      url,
      price: dollars(l.landed_cost_cents),
      priceCurrency: 'USD',
      availability: 'https://schema.org/InStock',
      itemCondition: 'https://schema.org/NewCondition',
      eligibleQuantity: { '@type': 'QuantitativeValue', value: l.trial_units, unitText: 'units per Trial Batch' },
      seller: rating ? { ...seller, aggregateRating: rating } : seller,
    },
  };
}

export function supplierJsonLd(s: SupplierForSeo, origin: string, listings: { id: string; title: string }[]): JsonLd {
  return {
    '@context': 'https://schema.org',
    ...organizationJsonLd(s, origin),
    ...(listings.length ? {
      makesOffer: listings.slice(0, 20).map((l) => ({
        '@type': 'Offer', itemOffered: { '@type': 'Product', name: l.title, url: `${origin}${productPath(l.id)}` },
      })),
    } : {}),
  };
}

/**
 * JSON for a <script type="application/ld+json"> tag. "<" is escaped so text such as "</script>" in a
 * listing title can't close the tag and inject markup; U+2028/2029 are escaped for old parsers.
 */
export function serializeJsonLd(data: JsonLd): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(new RegExp(String.fromCharCode(0x2028), 'g'), '\\u2028')
    .replace(new RegExp(String.fromCharCode(0x2029), 'g'), '\\u2029');
}
