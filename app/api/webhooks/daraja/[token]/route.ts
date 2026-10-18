import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { mpesaConfig, parseStkCallback, stkQuery } from '@/lib/payments/mpesa';
import { settle } from '@/lib/payments/mpesa-checkout';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 64_000;
const PROVIDER = 'mpesa';

// Daraja only needs a 200; anything else is logged on their side and not retried.
const ACCEPTED = () => NextResponse.json({ ResultCode: 0, ResultDesc: 'Accepted' });

/**
 * POST /api/webhooks/daraja/:token — STK Push result callback.
 * (The path avoids words like "mpesa", which Safaricom rejects in callback URLs.)
 *
 * Daraja callbacks are unsigned, so: (1) the URL carries a secret token,
 * (2) the CheckoutRequestID must match a prompt we sent, and (3) the result is
 * re-checked with STK Query before any order is funded. If the query isn't
 * conclusive yet, the callback is stored and the order-page poll settles it.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let expected: string;
  try { expected = mpesaConfig().callbackToken; } catch {
    console.error('[mpesa] callback received but M-Pesa is not configured');
    return NextResponse.json({ error: 'Not configured' }, { status: 503 });
  }
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const cb = parseStkCallback(body);
  if (!cb) return NextResponse.json({ error: 'Unrecognised payload' }, { status: 400 });

  const db = createAdminClient();
  const eventId = `stk:${cb.checkoutRequestId}`;
  await db.from('payment_events').upsert(
    { provider: PROVIDER, event_id: eventId, event_type: 'stk_callback', tx_ref: cb.checkoutRequestId, payload: body },
    { onConflict: 'provider,event_id', ignoreDuplicates: true },
  );
  const record = (outcome: string) => db.from('payment_events')
    .update({ outcome, processed_at: new Date().toISOString() }).eq('provider', PROVIDER).eq('event_id', eventId);

  const { data: row } = await db.from('mpesa_payments')
    .update({ callback_payload: body }).eq('checkout_request_id', cb.checkoutRequestId).select('id, status').maybeSingle();
  if (!row) {
    console.error('[mpesa] callback for unknown CheckoutRequestID', { checkoutRequestId: cb.checkoutRequestId, receipt: cb.receipt });
    await record('unknown_reference');
    return ACCEPTED();
  }

  try {
    const result = await stkQuery(cb.checkoutRequestId);
    if (result.state === 'pending') {
      await record('awaiting_query');
      return ACCEPTED();
    }
    if (result.resultCode !== cb.resultCode) {
      console.error('[mpesa] callback disagrees with STK query', { checkoutRequestId: cb.checkoutRequestId, callback: cb.resultCode, query: result.resultCode });
    }
    await record(await settle(db, cb.checkoutRequestId, result.resultCode, result.resultDesc, body));
  } catch (err) {
    // Stored on the row; the order-page poll (or the next callback) settles it.
    console.warn('[mpesa] could not confirm callback yet', { checkoutRequestId: cb.checkoutRequestId, err: err instanceof Error ? err.message : err });
    await record('awaiting_query');
  }
  return ACCEPTED();
}
