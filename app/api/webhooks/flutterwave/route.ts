import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { normalizeWebhook, verifyWebhookSignature } from '@/lib/payments/flutterwave';
import { handleCharge, handleTransfer } from '@/lib/payments/flutterwave-events';
import type { Json } from '@/lib/supabase/database.types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 1_000_000;
const PROVIDER = 'flutterwave';

/**
 * POST /api/webhooks/flutterwave — supplier payouts (+ legacy charges).
 *
 *   transfer.completed → re-verify transfer    → complete_payout (supplier payout settled/failed)
 *   charge.completed   → DEPRECATED: buyer card payments moved to Paystack
 *                        (/api/webhooks/card, migration 011). Still applied so
 *                        Flutterwave checkouts started before the switch are not
 *                        lost; remove once no legacy checkout can still complete.
 *
 * 200 = handled (incl. ignored/duplicate/mismatch) · 401 forged · 400 malformed
 * 500 = transient, Flutterwave should retry.
 */
export async function POST(request: Request) {
  const secretHash = process.env.FLW_SECRET_HASH;
  if (!secretHash) {
    console.error('[flutterwave] FLW_SECRET_HASH is not set');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
  }

  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  }
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: 'Payload too large' }, { status: 413 });

  if (!verifyWebhookSignature(raw, request.headers, secretHash)) {
    console.warn('[flutterwave] rejected webhook with invalid signature');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let body: Json;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const event = normalizeWebhook(body);
  if (!event) return NextResponse.json({ error: 'Unrecognised payload' }, { status: 400 });

  const db = createAdminClient();

  // Idempotency log
  const { error: logError } = await db.from('payment_events').upsert(
    { provider: PROVIDER, event_id: event.eventId, event_type: event.eventType, tx_ref: event.reference || null, payload: body },
    { onConflict: 'provider,event_id', ignoreDuplicates: true },
  );
  if (logError) return transient('could not log event', logError.message);
  const { data: logged } = await db.from('payment_events').select('id, processed_at, outcome')
    .eq('provider', PROVIDER).eq('event_id', event.eventId).single();
  if (logged?.processed_at) return NextResponse.json({ received: true, duplicate: true, outcome: logged.outcome });

  const finish = async (outcome: string) => {
    await db.from('payment_events').update({ outcome, processed_at: new Date().toISOString() }).eq('id', logged!.id);
    return NextResponse.json({ received: true, outcome });
  };

  try {
    if (event.eventType === 'charge.completed') return finish(await handleCharge(db, event));
    if (event.eventType === 'transfer.completed') return finish(await handleTransfer(db, event));
    return finish('ignored_event_type');
  } catch (err) {
    return transient('processing failed', err instanceof Error ? err.message : String(err));
  }
}

function transient(what: string, detail: string) {
  console.error(`[flutterwave] ${what}`, detail);
  return NextResponse.json({ error: 'Temporary failure' }, { status: 500 });
}
