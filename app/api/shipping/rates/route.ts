import { NextResponse } from 'next/server';
import { getSessionProfile } from '@/lib/supabase/server';
import { UUID_RE } from '@/lib/uploads';
import { rateLimit, rateLimitHeaders } from '@/lib/security/rate-limit';
import {
  combineQuotes, originCity, splitByOrigin, validateQuoteForm, type QuoteGroup, type QuoteLine, type ShippingComparison,
} from '@/lib/shipping/dhl';
import { DhlError, dhlAccountNumber, fetchDhlQuote, isDhlRatesConfigured } from '@/lib/shipping/dhl-server';

type Row = { id: string; buyer_id: string; quantity: number; goods_cents: number; product: unknown };
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const MAX_ORIGINS = 4;

/**
 * POST /api/shipping/rates — live DHL Express estimate for the buyer's own cart checkout or order,
 * shown beside the Guaranteed Landed Cost. Quote only: nothing here changes an order or a charge.
 *
 * Body: { kind: 'group' | 'order', id, destinationCity, destinationPostalCode?, weightKg, lengthCm, widthCm, heightCm }
 * Origin (listing country / ship_from_city), declared value (goods) and the destination country
 * (the buyer's profile) come from the database under RLS, never from the client.
 * → 200 ShippingComparison · 400 { errors } · 404 · 422/502 { error }
 */
export async function POST(request: Request) {
  const { supabase, user, profile } = await getSessionProfile();
  if (!user || !profile) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  if (!isDhlRatesConfigured()) return NextResponse.json({ configured: false } satisfies ShippingComparison);

  const limited = await rateLimit('shipping', `rates:${user.id}`);
  if (!limited.success) return NextResponse.json({ error: 'Too many quote requests. Try again in a minute.' }, { status: 429, headers: rateLimitHeaders(limited) });

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const kind = body?.kind === 'group' ? 'group' : body?.kind === 'order' ? 'order' : null;
  const id = typeof body?.id === 'string' ? body.id : '';
  if (!kind || !UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid checkout' }, { status: 400 });
  const form = validateQuoteForm(body ?? {});
  if (!form.ok) return NextResponse.json({ errors: form.errors }, { status: 400 });

  const q = supabase.from('orders').select('id, buyer_id, quantity, goods_cents, product:products ( title, origin_country, attributes )');
  const { data, error } = await (kind === 'group' ? q.eq('checkout_group_id', id) : q.eq('id', id)).limit(20);
  const rows = ((data ?? []) as unknown as Row[]).filter((r) => r.buyer_id === user.id);
  if (error || !rows.length) return NextResponse.json({ error: 'Checkout not found' }, { status: 404 });

  const lines: QuoteLine[] = rows.map((r) => {
    const p = one(r.product as { title: string; origin_country: string; attributes: Record<string, unknown> | null } | null);
    return { orderId: r.id, originCountry: p?.origin_country ?? 'US', attributes: p?.attributes ?? null, units: r.quantity, goodsCents: r.goods_cents, title: p?.title ?? 'Goods' };
  });
  const groups = splitByOrigin(lines, form.value.parcel);
  if (groups.length > MAX_ORIGINS) return NextResponse.json({ error: `DHL estimates cover up to ${MAX_ORIGINS} origin countries per checkout.` }, { status: 422 });

  try {
    const quoted: QuoteGroup[] = await Promise.all(groups.map(async (g) => {
      const city = originCity(g.originCountry, g.lines[0].attributes);
      if (!city) throw new DhlError(`DHL estimates aren't available from ${g.originCountry} yet.`, 422);
      const hs = g.lines.length === 1 && typeof g.lines[0].attributes?.hs_code === 'string' ? (g.lines[0].attributes.hs_code as string).replace(/\D/g, '').slice(0, 10) || null : null;
      const { quote, duties } = await fetchDhlQuote({
        origin: { countryCode: g.originCountry, cityName: city },
        destination: { countryCode: profile.country_code, cityName: form.value.destinationCity, postalCode: form.value.destinationPostalCode },
        parcel: g.parcel, declaredValueCents: g.goodsCents, accountNumber: dhlAccountNumber(), shipDate: new Date(),
        item: { title: g.lines.map((l) => l.title).join(', '), units: g.lines.reduce((s, l) => s + l.units, 0), hsCode: hs },
      });
      // Duties are only comparable when DHL billed them in the freight currency.
      const sameCurrency = duties && duties.currency === quote.currency;
      return {
        originCountry: g.originCountry, originCity: city, productName: quote.productName, currency: quote.currency, freightCents: quote.freightCents,
        transitDays: quote.transitDays, estimatedDelivery: quote.estimatedDelivery,
        dutiesCents: sameCurrency ? duties.dutiesCents : null, taxesCents: sameCurrency ? duties.taxesCents : null,
      };
    }));
    return NextResponse.json({ configured: true, groups: quoted, totals: combineQuotes(quoted) } satisfies ShippingComparison);
  } catch (err) {
    const status = err instanceof DhlError && err.httpStatus >= 400 && err.httpStatus < 500 ? 422 : 502;
    if (status === 502) console.error('[dhl] rate quote failed', err);
    return NextResponse.json({ error: err instanceof DhlError ? err.message : 'DHL quote failed' }, { status });
  }
}
