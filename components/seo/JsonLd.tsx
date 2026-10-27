import { serializeJsonLd } from '@/lib/seo';

/**
 * Schema.org structured data for crawlers (Google, Bing, AI agents). Server-rendered and inert:
 * browsers don't execute application/ld+json, so it needs no CSP nonce. The payload is escaped by
 * serializeJsonLd, so listing text can't break out of the tag.
 */
export default function JsonLd({ data }: { data: Record<string, unknown> }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }} />;
}
