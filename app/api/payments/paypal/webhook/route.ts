import { NextResponse } from 'next/server';
import { isPaypalConfigured, verifyWebhook, webhookOrderId } from '@/lib/payments/paypal';
import { handleGatewayEvent } from '@/lib/payments/gateway-events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 1_000_000;
const HANDLED = ['CHECKOUT.ORDER.APPROVED', 'CHECKOUT.ORDER.COMPLETED', 'PAYMENT.CAPTURE.COMPLETED', 'PAYMENT.CAPTURE.DENIED', 'PAYMENT.CAPTURE.PENDING'];

/**
 * POST /api/payments/paypal/webhook — PayPal Developer Dashboard → your app → Webhooks (set PAYPAL_WEBHOOK_ID).
 *
 *   CHECKOUT.ORDER.APPROVED     → capture (the buyer approved but never came back to our page)
 *   PAYMENT.CAPTURE.COMPLETED   → confirm the capture → apply_card_payment()
 *
 * Every delivery is verified with PayPal's verify-webhook-signature API, and the payment itself is
 * re-read from PayPal (never from the event body). 200 = handled · 401 forged · 400 malformed ·
 * 500 transient → PayPal retries (and our retry cron re-processes the logged event).
 */
export async function POST(request: Request) {
  if (!isPaypalConfigured()) return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 });
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  let event: { id?: string; event_type?: string; resource?: Record<string, unknown> };
  try { event = JSON.parse(raw); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  if (!event?.id || !event.event_type) return NextResponse.json({ error: 'Unrecognised payload' }, { status: 400 });

  let verified: boolean;
  try { verified = await verifyWebhook(request.headers, event); } catch (err) {
    console.error('[paypal] webhook verification unavailable', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Temporary failure' }, { status: 500 });
  }
  if (!verified) {
    console.warn('[paypal] rejected webhook with invalid signature');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }
  if (!HANDLED.includes(event.event_type)) return NextResponse.json({ received: true, outcome: 'ignored_event_type' });

  const result = await handleGatewayEvent({
    gateway: 'paypal', eventId: event.id, eventType: event.event_type, token: webhookOrderId(event as Parameters<typeof webhookOrderId>[0]), payload: event,
  });
  if ('error' in result) {
    console.error('[paypal] webhook processing failed', result.error);
    return NextResponse.json({ error: 'Temporary failure' }, { status: 500 });
  }
  return NextResponse.json({ received: true, ...('outcome' in result ? { outcome: result.outcome } : { pending: true }) });
}
