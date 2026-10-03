import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  getTransfer, isFailedTransfer, isSuccessfulCharge, isSuccessfulTransfer,
  normalizeWebhook, verifyTransaction, verifyWebhookSignature, type NormalizedEvent,
} from '@/lib/payments/flutterwave';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 1_000_000;
const PROVIDER = 'flutterwave';

/**
 * POST /api/webhooks/flutterwave
 *
 *   charge.completed   → re-verify transaction → apply_flutterwave_payment (pending_payment → funded)
 *   transfer.completed → re-verify transfer    → complete_payout (supplier payout settled/failed)
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

  let body: unknown;
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

type Db = ReturnType<typeof createAdminClient>;

async function handleCharge(db: Db, event: NormalizedEvent): Promise<string> {
  if (!isSuccessfulCharge(event.status)) return `charge_${event.status || 'unknown'}`;

  // Never trust webhook amounts — ask Flutterwave. (Throws → 500 → retried.)
  const tx = await verifyTransaction(event.objectId);
  if (tx.id !== event.objectId || tx.txRef !== event.reference || !isSuccessfulCharge(tx.status)) {
    console.error('[flutterwave] charge verification mismatch', { event, tx });
    return 'verification_mismatch';
  }
  if (!Number.isInteger(tx.amountCents)) return 'invalid_amount';

  const { data, error } = await db.rpc('apply_flutterwave_payment', {
    p_tx_ref: tx.txRef, p_provider_ref: tx.id, p_amount_cents: tx.amountCents, p_currency: tx.currency,
  });
  if (error) throw new Error(`apply_flutterwave_payment: ${error.message}`);
  const outcome = String(data);
  if (['amount_mismatch', 'currency_mismatch', 'unknown_reference'].includes(outcome)) {
    console.error('[flutterwave] payment needs manual review', { outcome, txRef: tx.txRef, id: tx.id });
  }
  return outcome;
}

async function handleTransfer(db: Db, event: NormalizedEvent): Promise<string> {
  const transfer = await getTransfer(event.objectId);
  if (transfer.id !== event.objectId || transfer.reference !== event.reference) {
    console.error('[flutterwave] transfer verification mismatch', { event, transfer });
    return 'verification_mismatch';
  }
  const success = isSuccessfulTransfer(transfer.status);
  if (!success && !isFailedTransfer(transfer.status)) return `transfer_${transfer.status || 'pending'}`;

  const { data, error } = await db.rpc('complete_payout', {
    p_reference: transfer.reference, p_transfer_id: transfer.id, p_success: success, p_message: transfer.message || event.message,
  });
  if (error) throw new Error(`complete_payout: ${error.message}`);
  return String(data);
}

function transient(what: string, detail: string) {
  console.error(`[flutterwave] ${what}`, detail);
  return NextResponse.json({ error: 'Temporary failure' }, { status: 500 });
}
