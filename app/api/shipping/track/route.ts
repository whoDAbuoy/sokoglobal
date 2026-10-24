import { NextResponse } from 'next/server';
import { getSessionProfile } from '@/lib/supabase/server';
import { UUID_RE } from '@/lib/uploads';
import { rateLimit, rateLimitHeaders } from '@/lib/security/rate-limit';
import { isDhlCarrier, type TrackResponse } from '@/lib/shipping/dhl';
import { DhlError, fetchDhlTracking, isDhlTrackingConfigured } from '@/lib/shipping/dhl-server';

/**
 * GET /api/shipping/track?orderId=… — live DHL Express events for an order's shipment.
 * The waybill comes from public.shipments under RLS (buyer, supplier or admin of that order),
 * never from the query string, so this cannot be used to look up arbitrary DHL parcels.
 */
export async function GET(request: Request) {
  const { supabase, user } = await getSessionProfile();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const orderId = new URL(request.url).searchParams.get('orderId') ?? '';
  if (!UUID_RE.test(orderId)) return NextResponse.json({ error: 'Invalid order' }, { status: 400 });
  if (!isDhlTrackingConfigured()) return NextResponse.json({ configured: false } satisfies TrackResponse);

  const { data: shipment } = await supabase.from('shipments').select('carrier_name, tracking_number').eq('order_id', orderId).maybeSingle();
  if (!shipment) return NextResponse.json({ error: 'No shipment for this order yet' }, { status: 404 });
  if (!isDhlCarrier(shipment.carrier_name)) return NextResponse.json({ error: 'This shipment is not with DHL' }, { status: 404 });

  const limited = await rateLimit('shipping', `track:${user.id}`);
  if (!limited.success) return NextResponse.json({ error: 'Too many refreshes. Try again in a minute.' }, { status: 429, headers: rateLimitHeaders(limited) });

  try {
    const tracking = await fetchDhlTracking(shipment.tracking_number);
    return NextResponse.json({ configured: true, waybill: shipment.tracking_number, tracking } satisfies TrackResponse);
  } catch (err) {
    console.error('[dhl] tracking failed', err);
    return NextResponse.json({ error: err instanceof DhlError ? err.message : 'DHL tracking failed' }, { status: 502 });
  }
}
