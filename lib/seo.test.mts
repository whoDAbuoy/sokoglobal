// Run: npx tsx --test lib/seo.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { metaDescription, productJsonLd, serializeJsonLd, siteUrl, supplierJsonLd, type ListingForSeo } from './seo.ts';
import * as robotsModule from '../app/robots.ts';

// tsx may hand back the CommonJS-wrapped module ({ default: { default: fn } }); unwrap either shape.
const robotsExport = robotsModule.default as unknown as (() => import('next').MetadataRoute.Robots) | { default: () => import('next').MetadataRoute.Robots };
const robots = typeof robotsExport === 'function' ? robotsExport : robotsExport.default;

const LISTING: ListingForSeo = {
  id: 'f3700000-0000-4000-8000-0000000000a1', title: 'Steel kettle', brand: 'Acme', description: 'A 1.7 L kettle.\n\nBrushed steel.',
  category_name: 'Kitchen', origin_country: 'CN', images: ['https://cdn.test/1.jpg', 'https://cdn.test/2.jpg'],
  landed_cost_cents: 57000, trial_units: 100, supplier_id: 'e3711111-1111-4111-8111-111111111111',
  supplier_company: 'Kettle Works Ltd', supplier_country: 'CN', rating_average: 4.5, rating_count: 2,
};
const ORIGIN = 'https://sokoglobal.com';

test('siteUrl: origin only, trailing path and slash dropped, bad values fall back', () => {
  assert.equal(siteUrl({ NEXT_PUBLIC_SITE_URL: 'https://shop.example.com/some/path/' }), 'https://shop.example.com');
  assert.equal(siteUrl({ NEXT_PUBLIC_SITE_URL: 'http://localhost:3000' }), 'http://localhost:3000');
  assert.equal(siteUrl({ NEXT_PUBLIC_SITE_URL: 'not a url' }), 'https://sokoglobal.com');
  assert.equal(siteUrl({}), 'https://sokoglobal.com');
});

test('metaDescription: one line, cut on a word with an ellipsis', () => {
  assert.equal(metaDescription('  A  1.7 L\nkettle. '), 'A 1.7 L kettle.');
  const long = metaDescription('word '.repeat(60), 50);
  assert.ok(long.length <= 50 && long.endsWith('…') && !long.includes('wor…'), long);
  assert.equal(metaDescription(null), '');
});

test('productJsonLd: Product with one Offer at the landed USD price, seller and its rating', () => {
  const ld = productJsonLd(LISTING, ORIGIN) as Record<string, any>;
  assert.equal(ld['@context'], 'https://schema.org');
  assert.equal(ld['@type'], 'Product');
  assert.equal(ld.url, `${ORIGIN}/products/${LISTING.id}`);
  assert.deepEqual(ld.image, LISTING.images);
  assert.deepEqual(ld.brand, { '@type': 'Brand', name: 'Acme' });
  assert.equal(ld.offers['@type'], 'Offer');
  assert.equal(ld.offers.price, '570.00');
  assert.equal(ld.offers.priceCurrency, 'USD');
  assert.equal(ld.offers.eligibleQuantity.value, 100);
  assert.equal(ld.offers.seller['@type'], 'Organization');
  assert.equal(ld.offers.seller.name, 'Kettle Works Ltd');
  assert.equal(ld.offers.seller.url, `${ORIGIN}/suppliers/${LISTING.supplier_id}`);
  assert.deepEqual(ld.offers.seller.aggregateRating, { '@type': 'AggregateRating', ratingValue: '4.50', reviewCount: 2, bestRating: 5, worstRating: 1 });
  assert.equal(ld.aggregateRating, undefined, 'the rating is the supplier’s, not the product’s');
});

test('productJsonLd: optional fields are omitted, never null; no rating without ratings', () => {
  const ld = productJsonLd({ ...LISTING, brand: null, description: null, category_name: null, images: [], rating_average: null, rating_count: 0 }, ORIGIN) as Record<string, any>;
  for (const k of ['brand', 'description', 'category', 'image']) assert.equal(k in ld, false, k);
  assert.equal('aggregateRating' in ld.offers.seller, false);
});

test('supplierJsonLd: Organization with country and what it offers', () => {
  const ld = supplierJsonLd({ id: LISTING.supplier_id, company_name: 'Kettle Works Ltd', country_code: 'CN', avatar_url: 'https://cdn.test/a.png', bio: 'We make kettles.' },
    ORIGIN, [{ id: LISTING.id, title: 'Steel kettle' }]) as Record<string, any>;
  assert.equal(ld['@type'], 'Organization');
  assert.equal(ld.logo, 'https://cdn.test/a.png');
  assert.deepEqual(ld.address, { '@type': 'PostalAddress', addressCountry: 'CN' });
  assert.equal(ld.makesOffer[0].itemOffered.url, `${ORIGIN}/products/${LISTING.id}`);
});

test('serializeJsonLd: listing text cannot close the script tag', () => {
  const evil = productJsonLd({ ...LISTING, title: '</script><script>alert(1)</script>', description: 'x y' }, ORIGIN);
  const out = serializeJsonLd(evil);
  assert.ok(!out.includes('</script>') && !out.includes('<'), out);
  assert.ok(!out.includes(' '));
  assert.equal((JSON.parse(out) as { name: string }).name, '</script><script>alert(1)</script>', 'still the same data once parsed');
});

test('robots: public pages open, private areas closed, the portal block does not hide /suppliers/', () => {
  process.env.NEXT_PUBLIC_SITE_URL = 'https://sokoglobal.com';
  const r = robots();
  const rule = Array.isArray(r.rules) ? r.rules[0] : r.rules;
  const disallow = ([] as string[]).concat(rule.disallow ?? []);
  const allow = ([] as string[]).concat(rule.allow ?? []);
  for (const p of ['/dashboard/', '/supplier/', '/admin/', '/api/', '/checkout/', '/rfqs/', '/auth/']) assert.ok(disallow.includes(p), p);
  for (const p of ['/', '/products/', '/suppliers/']) assert.ok(allow.includes(p), p);
  // Robots rules are prefix matches ("$" anchors the end): none may match a public supplier page.
  const blocks = (rulePath: string, url: string) => rulePath.endsWith('$') ? url === rulePath.slice(0, -1) : url.startsWith(rulePath);
  assert.ok(!disallow.some((d) => blocks(d, '/suppliers/abc')), 'public supplier pages stay crawlable');
  assert.ok(!disallow.some((d) => blocks(d, '/products/abc')), 'public product pages stay crawlable');
  assert.ok(disallow.some((d) => blocks(d, '/supplier')) && disallow.some((d) => blocks(d, '/supplier/orders')), 'the supplier portal is blocked');
  assert.equal(r.sitemap, 'https://sokoglobal.com/sitemap.xml');
});
