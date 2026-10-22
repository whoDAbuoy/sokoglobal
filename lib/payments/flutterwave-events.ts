import 'server-only';
import type { createAdminClient } from '@/lib/supabase/admin';
import {
  getTransfer, isFailedTransfer, isSuccessfulCharge, isSuccessfulTransfer, verifyTransaction, type NormalizedEvent,
} from '@/lib/payments/flutterwave';
import { dispatchNotificationsAfterResponse } from '@/lib/notifications/dispatch';

/**
 * Flutterwave event handlers, shared by the webhook route and the dead-letter
 * retry worker (moved here unchanged from app/api/webhooks/flutterwave/route.ts).
 * Throwing = transient (the caller retries); a returned string is the outcome.
 */
type Db = ReturnType<typeof createAdminClient>;

export async function handleCharge(db: Db, event: NormalizedEvent): Promise<string> {
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
  dispatchNotificationsAfterResponse();
  const outcome = String(data);
  if (['amount_mismatch', 'currency_mismatch', 'unknown_reference'].includes(outcome)) {
    console.error('[flutterwave] payment needs manual review', { outcome, txRef: tx.txRef, id: tx.id });
  }
  return outcome;
}

export async function handleTransfer(db: Db, event: NormalizedEvent): Promise<string> {
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

