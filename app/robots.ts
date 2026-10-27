import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/seo';

/**
 * /robots.txt: crawlers (search engines and AI agents) may read the landing page and the public
 * listing / supplier pages; everything behind sign-in, the APIs and auth flows are off limits.
 * "/supplier/" (the portal) and "/supplier$" are listed separately so the public "/suppliers/" pages stay open.
 */
export default function robots(): MetadataRoute.Robots {
  const origin = siteUrl();
  return {
    rules: [{
      userAgent: '*',
      allow: ['/', '/products/', '/suppliers/'],
      disallow: ['/dashboard/', '/dashboard$', '/supplier/', '/supplier$', '/admin/', '/admin$', '/rfqs/', '/api/', '/auth/', '/checkout/', '/maintenance'],
    }],
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}
