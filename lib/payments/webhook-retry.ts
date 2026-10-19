import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { settleCardReference } from '@/lib/payments/checkout';
import { normalizeWebhook } from '@/lib/payments/flutterwave';
import { handleCharge, handleTransfer } from '@/lib/payments/flutterwave-events';
import { syncPayment, type MpesaPaymentRow } from '@/lib/payments/mpesa-checkout';
import { isMpesaConfigured } from '@/lib/payments/mpesa';
import { postSlack } from '@/lib/notifications/slack';
import { decideRetry, retryDelayMs, WEBHOOK_GRACE_MS } from '@/lib/payments/resilience';

const BATCH = 50;
const MPESA_BATCH = 25;
const MPESA_ROW = 'id, order_id, checkout_group_id, status, checkout_request_id, amount_kes, result_code, result_desc, callback_payload, created_at, last_queried_at';

type EventRow = { id: number; provider: string; event_type: string; tx_ref: string | null; payload: unknown; attempts: number };
type Attempt = { outcome: string } | { pending: true } | { error: string };

/**
 * Dead-letter retry worker (used by /api/cron/retry-webhooks and the admin
 * "Retry now" button). Re-processes webhook deliveries that were logged in
 * payment_events but never finished, using the same idempotent settle
 * functions as the live webhooks, with exponential backoff; after
 * MAX_WEBHOOK_ATTEMPTS an event is dead-lettered and posted to Slack.
 * Also re-queries M-Pesa prompts whose callback never arrived.
 */
export async function retryWebhooks({ db, hasTime, now = new Date() }: { db: SupabaseClient; hasTime: () => boolean; now?: Date }) {
  const report = { examined: 0, settled: 0, still_pending: 0, dead_lettered: [] as { id: number; provider: string; tx_ref: string | null; error: string }[], mpesa_synced: 0 };

  const { data: due, error } = await db.from('payment_events')
    .select('id, provider, event_type, tx_ref, payload, attempts')
    .is('processed_at', null).is('dead_lettered_at', null)
    .lt('received_at', new Date(now.getTime() - WEBHOOK_GRACE_MS).toISOString())
    .or(`next_retry_at.is.null,next_retry_at.lte."${now.toISOString()}"`)
    .order('received_at', { ascending: true }).limit(BATCH);
  if (error) throw new Error(`load payment_events: ${error.message}`);

  for (const ev of (due ?? []) as EventRow[]) {
    if (!hasTime()) break;
    const attempt = ev.attempts + 1;
    // Claim with an optimistic lock so two workers never process the same event.
    const { data: claimed } = await db.from('payment_events')
      .update({ attempts: attempt, next_retry_at: new Date(now.getTime() + retryDelayMs(attempt)).toISOString() })
      .eq('id', ev.id).eq('attempts', ev.attempts).is('processed_at', null).select('id');
    if (!claimed?.length) continue;
    report.examined += 1;

    const decision = decideRetry(attempt, await processEvent(db, ev));
    if (decision.action === 'done') {
      await db.from('payment_events').update({ outcome: decision.outcome, processed_at: new Date().toISOString(), last_error: null }).eq('id', ev.id);
      report.settled += 1;
    } else if (decision.action === 'retry') {
      await db.from('payment_events').update({ last_error: decision.error.slice(0, 1000) }).eq('id', ev.id);
      report.still_pending += 1;
    } else {
      await db.from('payment_events').update({ last_error: decision.error.slice(0, 1000), dead_lettered_at: new Date().toISOString(), outcome: 'dead_letter' }).eq('id', ev.id);
      report.dead_lettered.push({ id: ev.id, provider: ev.provider, tx_ref: ev.tx_ref, error: decision.error });
    }
  }

  // Lost Daraja callbacks: prompts still pending a few minutes after they were sent.
  if (isMpesaConfigured() && hasTime()) {
    const { data: open } = await db.from('mpesa_payments').select(MPESA_ROW).eq('status', 'pending')
      .lt('created_at', new Date(now.getTime() - 2 * 60_000).toISOString()).order('created_at', { ascending: true }).limit(MPESA_BATCH);
    for (const row of (open ?? []) as MpesaPaymentRow[]) {
      if (!hasTime()) break;
      if (await syncPayment(db, row)) report.mpesa_synced += 1;
    }
  }

  if (report.dead_lettered.length) {
    await postSlack({
      text: `:rotating_light: ${report.dead_lettered.length} payment webhook(s) dead-lettered after repeated failures — review in Admin → Reconciliation.\n`
        + report.dead_lettered.slice(0, 10).map((d) => `• ${d.provider} ${d.tx_ref ?? `#${d.id}`}: ${d.error}`).join('\n'),
    }).catch(() => undefined);
  }
  return report;
}

async function processEvent(db: SupabaseClient, ev: EventRow): Promise<Attempt> {
  try {
    if (ev.provider === 'paystack') {
      if (ev.event_type !== 'charge.success' || !ev.tx_ref) return { outcome: 'ignored_event_type' };
      const outcome = await settleCardReference(ev.tx_ref);
      return outcome === 'pending' ? { pending: true } : { outcome };
    }
    if (ev.provider === 'flutterwave') {
      const event = normalizeWebhook(ev.payload);
      if (!event) return { outcome: 'unrecognised_payload' };
      if (event.eventType === 'charge.completed') return { outcome: await handleCharge(db, event) };
      if (event.eventType === 'transfer.completed') return { outcome: await handleTransfer(db, event) };
      return { outcome: 'ignored_event_type' };
    }
    if (ev.provider === 'mpesa') {
      if (!ev.tx_ref) return { outcome: 'unknown_reference' };
      const { data: row } = await db.from('mpesa_payments').select(MPESA_ROW).eq('checkout_request_id', ev.tx_ref).maybeSingle();
      if (!row) return { outcome: 'unknown_reference' };
      const r = row as MpesaPaymentRow;
      if (r.status !== 'pending') return { outcome: `already_${r.status}` };
      const outcome = await syncPayment(db, r);
      return outcome ? { outcome } : { pending: true };
    }
    return { outcome: 'unknown_provider' };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
