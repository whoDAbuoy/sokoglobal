import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { gatewayRowByToken, settleGatewayRow, type Gateway } from '@/lib/payments/gateways';
import type { Json } from '@/lib/supabase/database.types';

export type EventResult = { outcome: string } | { pending: true } | { error: string };

/**
 * Webhook bookkeeping shared by the DPO, PayPal and Airtel endpoints: log the delivery in
 * payment_events (deduplicated by provider + event id), settle the attempt it points at by asking
 * the gateway, and mark it processed. Pending / failed deliveries stay unprocessed, so the
 * retry-webhooks cron picks them up (reprocessGatewayEvent) with backoff and dead-lettering.
 */
export async function handleGatewayEvent(input: { gateway: Gateway; eventId: string; eventType: string; token: string | null; payload: unknown }): Promise<EventResult> {
  const db = createAdminClient();
  const { error: logError } = await db.from('payment_events').upsert(
    { provider: input.gateway, event_id: input.eventId.slice(0, 200), event_type: input.eventType.slice(0, 80), tx_ref: input.token, payload: (input.payload ?? {}) as Json },   // parsed JSON (or XML wrapped in { raw }) from the gateway
    { onConflict: 'provider,event_id', ignoreDuplicates: true },
  );
  if (logError) return { error: `could not log event: ${logError.message}` };
  const { data: logged } = await db.from('payment_events').select('id, processed_at, outcome')
    .eq('provider', input.gateway).eq('event_id', input.eventId.slice(0, 200)).single();
  if (logged?.processed_at) return { outcome: String(logged.outcome ?? 'duplicate') };

  const result = await reprocessGatewayEvent(input.gateway, input.token);
  if ('outcome' in result && logged) {
    await db.from('payment_events').update({ outcome: result.outcome, processed_at: new Date().toISOString() }).eq('id', logged.id);
  }
  return result;
}

/** Settle the attempt a logged event refers to (also used by the retry worker). */
export async function reprocessGatewayEvent(gateway: Gateway, token: string | null): Promise<EventResult> {
  if (!token) return { outcome: 'ignored_event' };
  try {
    const db = createAdminClient();
    const row = await gatewayRowByToken(db, gateway, token);
    if (!row) return { outcome: 'unknown_reference' };
    const outcome = await settleGatewayRow(db, row);
    return outcome === 'pending' ? { pending: true } : { outcome };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
