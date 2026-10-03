import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  findTransferByReference as realFind, getTransfer as realGet, isFailedTransfer, isSuccessfulTransfer,
  type TransferRecord,
} from '@/lib/payments/flutterwave';

/** Don't touch a payout whose POST /transfers may still be in flight. */
const MIN_AGE_MS = 30 * 60_000;
/** Only conclude "never created" after Flutterwave has had ample time to index it. */
const NOT_FOUND_FAIL_AFTER_MS = 2 * 60 * 60_000;
/** Transfers with an id but no completion webhook: re-check after this long. */
const WEBHOOK_GRACE_MS = 6 * 60 * 60_000;
const BATCH = 50;

type StuckPayout = {
  id: string; order_id: string; reference: string; amount_cents: number; currency: string;
  payout_currency: string | null; payout_amount: string | number | null; updated_at: string; flw_transfer_id: string | null;
};

/**
 * Payout reconciliation engine (used by /api/cron/reconcile-payouts).
 *
 * Pass 1: payouts stuck in 'processing' with NO flw_transfer_id — the POST
 * /transfers call timed out or 5xx'd, so we don't know if money moved. Ask
 * Flutterwave by our unique reference (GET /v3/transfers?reference=…):
 *
 *   found · successful   → complete_payout(success)  → status 'succeeded', transfer id stored
 *   found · failed       → complete_payout(failure)  → status 'failed' → retry-payouts re-sends
 *                                                      under a NEW reference
 *   found · new/pending  → finish_payout(initiated)  → transfer id stored, stays 'processing';
 *                                                      the transfer.completed webhook settles it
 *   not found (≥ 2h old) → finish_payout(failed)     → safe to retry: Flutterwave confirms no
 *                                                      transfer exists for that reference
 *   not found (< 2h old) → wait for the next run
 *   amount/currency mismatch → left untouched + logged (stays on the Slack alert list)
 *
 * Pass 2: 'processing' payouts WITH a transfer id but no completion webhook
 * after 6h → GET /transfers/:id and settle (covers lost webhooks).
 *
 * Every transition goes through the existing row-locked SQL functions, which
 * only act on status = 'processing', so this job is idempotent and safe to run
 * concurrently with webhooks and with itself.
 */
export interface ReconcileDeps {
  db: Pick<SupabaseClient, 'from' | 'rpc'>;
  findTransferByReference?: typeof realFind;
  getTransfer?: (id: string) => Promise<Pick<TransferRecord, 'id' | 'reference' | 'status' | 'message'>>;
  now?: number;
  hasTime?: () => boolean;
}

export interface ReconcileReport {
  scanned: { noTransferId: number; noWebhook: number };
  results: Record<string, number>;
  needsHuman: { reference: string; reason: string }[];
}

export async function reconcilePayouts(deps: ReconcileDeps): Promise<ReconcileReport> {
  const { db } = deps;
  const findTransferByReference = deps.findTransferByReference ?? realFind;
  const getTransfer = deps.getTransfer ?? realGet;
  const now = deps.now ?? Date.now();
  const hasTime = deps.hasTime ?? (() => true);
  const tally: Record<string, number> = {};
  const bump = (k: string) => { tally[k] = (tally[k] ?? 0) + 1; };
  const needsHuman: { reference: string; reason: string }[] = [];

  // ── Pass 1: unknown outcome (no transfer id) ───────────────────────────────
  const { data: stuck, error } = await db
    .from('payouts')
    .select('id, order_id, reference, amount_cents, currency, payout_currency, payout_amount, updated_at, flw_transfer_id')
    .eq('status', 'processing')
    .is('flw_transfer_id', null)
    .lt('updated_at', new Date(now - MIN_AGE_MS).toISOString())
    .order('updated_at', { ascending: true })
    .limit(BATCH);
  if (error) throw new Error(`Reconcile query failed: ${error.message}`);

  for (const p of (stuck ?? []) as StuckPayout[]) {
    if (!hasTime()) { bump('deferred_out_of_time'); continue; }
    let transfer: TransferRecord | null;
    try {
      transfer = await findTransferByReference(p.reference);
    } catch (err) {
      bump('lookup_error');
      console.error('[cron:reconcile] lookup failed', p.reference, err instanceof Error ? err.message : err);
      continue;   // leave untouched; next run retries, Slack alert stays open
    }

    if (!transfer) {
      if (now - Date.parse(p.updated_at) < NOT_FOUND_FAIL_AFTER_MS) { bump('not_found_waiting'); continue; }
      await db.rpc('finish_payout', {
        p_payout_id: p.id, p_initiated: false, p_transfer_id: null,
        p_error: `Reconciled: no Flutterwave transfer exists for reference ${p.reference}; safe to retry`,
      });
      bump('not_found_marked_failed');
      continue;
    }

    const mismatch = amountMismatch(p, transfer);
    if (mismatch) {
      bump('mismatch_needs_human');
      needsHuman.push({ reference: p.reference, reason: mismatch });
      console.error('[cron:reconcile] amount/currency mismatch — not touching', { reference: p.reference, mismatch, transfer });
      continue;
    }
    bump(await settle(db, p, transfer));
  }

  // ── Pass 2: transfer id known, completion webhook never arrived ────────────
  const { data: silent } = await db
    .from('payouts')
    .select('id, order_id, reference, amount_cents, currency, payout_currency, payout_amount, updated_at, flw_transfer_id')
    .eq('status', 'processing')
    .not('flw_transfer_id', 'is', null)
    .lt('updated_at', new Date(now - WEBHOOK_GRACE_MS).toISOString())
    .order('updated_at', { ascending: true })
    .limit(BATCH);

  for (const p of (silent ?? []) as StuckPayout[]) {
    if (!hasTime()) { bump('deferred_out_of_time'); continue; }
    try {
      const t = await getTransfer(p.flw_transfer_id!);
      if (t.reference !== p.reference) {
        bump('mismatch_needs_human');
        needsHuman.push({ reference: p.reference, reason: `Transfer ${t.id} carries reference ${t.reference}` });
        continue;
      }
      bump(await settle(db, p, t));
    } catch (err) {
      bump('lookup_error');
      console.error('[cron:reconcile] transfer lookup failed', p.flw_transfer_id, err instanceof Error ? err.message : err);
    }
  }

  return { scanned: { noTransferId: stuck?.length ?? 0, noWebhook: silent?.length ?? 0 }, results: tally, needsHuman };
}

type Db = ReconcileDeps['db'];

/** Apply Flutterwave's final/pending state through the row-locked SQL functions. */
async function settle(db: Db, p: StuckPayout, t: Pick<TransferRecord, 'id' | 'status' | 'message'>): Promise<string> {
  if (isSuccessfulTransfer(t.status) || isFailedTransfer(t.status)) {
    const ok = isSuccessfulTransfer(t.status);
    const { data, error } = await db.rpc('complete_payout', {
      p_reference: p.reference, p_transfer_id: t.id, p_success: ok,
      p_message: `Reconciled from Flutterwave: ${t.message || t.status}`,
    });
    if (error) { console.error('[cron:reconcile] complete_payout failed', p.reference, error.message); return 'db_error'; }
    return String(data) === 'already_processed' ? 'already_settled' : ok ? 'reconciled_succeeded' : 'reconciled_failed';
  }
  if (!p.flw_transfer_id) {
    // Still NEW/PENDING at Flutterwave: record the id; the webhook will finish it.
    const { error } = await db.rpc('finish_payout', { p_payout_id: p.id, p_initiated: true, p_transfer_id: t.id, p_error: null });
    if (error) { console.error('[cron:reconcile] finish_payout failed', p.reference, error.message); return 'db_error'; }
    return 'transfer_id_recorded_pending';
  }
  return 'still_pending';
}

/** Expected amount: FX payouts store the local amount; USD payouts are amount_cents / 100. */
function amountMismatch(p: StuckPayout, t: TransferRecord): string | null {
  const expectedCurrency = (p.payout_currency ?? p.currency).toUpperCase();
  const expectedAmount = p.payout_amount != null ? Number(p.payout_amount) : p.amount_cents / 100;
  if (t.currency && t.currency !== expectedCurrency) return `currency ${t.currency} ≠ expected ${expectedCurrency}`;
  if (Number.isFinite(t.amount) && Math.abs(t.amount - expectedAmount) > 0.01) return `amount ${t.amount} ≠ expected ${expectedAmount}`;
  return null;
}
