import { NextResponse } from 'next/server';
import { isDpoConfigured, xmlValue } from '@/lib/payments/dpo';
import { handleGatewayEvent } from '@/lib/payments/gateway-events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 64_000;
const OK = () => new NextResponse('<?xml version="1.0" encoding="utf-8"?><API3G><Response>OK</Response></API3G>', { headers: { 'Content-Type': 'application/xml' } });

/**
 * POST /api/webhooks/dpo — DPO Pay push notification (configure the URL with DPO).
 * The push is unsigned, so it only tells us WHICH token to check: verifyToken asks DPO for the
 * result and amount before apply_card_payment() funds escrow. Unknown tokens are acknowledged
 * and ignored; a transient failure returns 500 so the logged event is retried by our cron.
 */
export async function POST(request: Request) {
  if (!isDpoConfigured()) return NextResponse.json({ error: 'Not configured' }, { status: 503 });
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  const token = xmlValue(raw, 'TransactionToken') ?? new URLSearchParams(raw).get('TransactionToken');
  if (!token || !/^[A-Za-z0-9-]{6,80}$/.test(token)) return NextResponse.json({ error: 'Unrecognised payload' }, { status: 400 });

  const result = await handleGatewayEvent({
    gateway: 'dpo', eventId: `${token}:${xmlValue(raw, 'Result') ?? 'push'}`, eventType: 'push', token, payload: { raw: raw.slice(0, 8000) },
  });
  if ('error' in result) {
    console.error('[dpo] push processing failed', result.error);
    return NextResponse.json({ error: 'Temporary failure' }, { status: 500 });
  }
  return OK();
}
