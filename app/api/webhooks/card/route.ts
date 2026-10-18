import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { settleCardReference } from '@/lib/payments/checkout';
import { parseWebhook, paystackConfig, verifyWebhookSignature } from '@/lib/payments/paystack';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 1_000_000;
const PROVIDER = 'paystack';

/**
 * POST /api/webhooks/card — Paystack events (Dashboard → Settings → API Keys & Webhooks).
 *
 *   charge.success → re-verify with GET /transaction/verify → apply_card_payment()
 *                    (funds the order, every unpaid order in a cart, or the pledge)
 *
 * Authenticated by x-paystack-signature (HMAC-SHA512 of the raw body with the
 * secret key). 200 = handled (incl. ignored/duplicate/mismatch) · 401 forged ·
 * 400 malformed · 500 transient → Paystack retries.
 */
export async function POST(request: Request) {
  let secret: string;
  try { secret = paystackConfig().secretKey; } catch {
    console.error('[card] webhook received but Paystack is not configured');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
  }

  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  if (!verifyWebhookSignature(raw, request.headers.get('x-paystack-signature'), secret)) {
    console.warn('[card] rejected webhook with invalid signature');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let body: unknown;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const event = parseWebhook(body);
  if (!event) return NextResponse.json({ error: 'Unrecognised payload' }, { status: 400 });

  const db = createAdminClient();
  const eventId = `${event.event}:${event.id || event.reference}`;
  const { error: logError } = await db.from('payment_events').upsert(
    { provider: PROVIDER, event_id: eventId, event_type: event.event, tx_ref: event.reference, payload: body },
    { onConflict: 'provider,event_id', ignoreDuplicates: true },
  );
  if (logError) return transient('could not log event', logError.message);
  const { data: logged } = await db.from('payment_events').select('id, processed_at, outcome')
    .eq('provider', PROVIDER).eq('event_id', eventId).single();
  if (logged?.processed_at) return NextResponse.json({ received: true, duplicate: true, outcome: logged.outcome });

  const finish = async (outcome: string) => {
    await db.from('payment_events').update({ outcome, processed_at: new Date().toISOString() }).eq('id', logged!.id);
    return NextResponse.json({ received: true, outcome });
  };

  if (event.event !== 'charge.success') return finish('ignored_event_type');
  try {
    const outcome = await settleCardReference(event.reference);
    if (outcome === 'pending') return transient('charge not final yet', event.reference);   // Paystack retries
    return finish(outcome);
  } catch (err) {
    return transient('processing failed', err instanceof Error ? err.message : String(err));
  }
}

function transient(what: string, detail: string) {
  console.error(`[card] ${what}`, detail);
  return NextResponse.json({ error: 'Temporary failure' }, { status: 500 });
}
