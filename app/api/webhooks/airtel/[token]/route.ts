import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { airtelConfig, parseCallback } from '@/lib/payments/airtel';
import { handleGatewayEvent } from '@/lib/payments/gateway-events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 64_000;

/**
 * POST /api/webhooks/airtel/:token — Airtel Money collection callback (set this URL in the Airtel portal).
 * Callbacks are not trusted: (1) the URL carries AIRTEL_CALLBACK_TOKEN, (2) the transaction id must be
 * one of our prompts, and (3) the result is re-checked with Airtel's status API before escrow is funded.
 * If Airtel has no final answer yet, the order-page poll and the retry cron settle it.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let expected: string;
  try { expected = airtelConfig().callbackToken; } catch {
    console.error('[airtel] callback received but Airtel Money is not configured');
    return NextResponse.json({ error: 'Not configured' }, { status: 503 });
  }
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const cb = parseCallback(body);
  if (!cb) return NextResponse.json({ error: 'Unrecognised payload' }, { status: 400 });

  const result = await handleGatewayEvent({
    gateway: 'airtel_money', eventId: `${cb.id}:${cb.statusCode ?? 'callback'}`, eventType: 'collection.callback', token: cb.id, payload: body,
  });
  if ('error' in result) console.error('[airtel] callback processing failed — retry cron will settle it', result.error);
  // Airtel only needs a 200; the logged event is retried by our cron if it is not settled yet.
  return NextResponse.json({ received: true });
}
