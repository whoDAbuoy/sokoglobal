import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { deadline, isAuthorizedCron } from '@/lib/cron';
import { FlutterwaveError, refundTransaction } from '@/lib/payments/flutterwave';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BATCH = 25;
const MAX_REFUNDS_PER_RUN = 200;

type Claimed = { pool_id: string; buyer_id: string; transaction_id: string; amount_cents: number; attempt: number };

/**
 * GET|POST /api/cron/expire-pools   (Authorization: Bearer CRON_SECRET)
 *
 * 1. expire_due_pools(): open/funded pools past their deadline whose PAID
 *    (escrow-funded) total is below target → 'expired'. Unpaid pledges are
 *    cancelled; paid pledges are queued for refund.
 * 2. Drain the refund queue: claim_pool_refunds() (SKIP LOCKED, so overlapping
 *    runs never claim the same member) → Flutterwave full refund →
 *    finish_pool_refund(). Failures go back to the queue; after 5 attempts
 *    they're parked as 'failed' for manual handling.
 *
 * Refunds are retried freely because Flutterwave rejects refunding a
 * transaction that's already fully refunded — a retry can't pay out twice.
 */
async function run(request: Request) {
  if (!isAuthorizedCron(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = createAdminClient();
  const hasTime = deadline(45_000);

  const { data: expired, error: expireError } = await db.rpc('expire_due_pools');
  if (expireError) {
    console.error('[cron:expire-pools] expire_due_pools failed', expireError.message);
    return NextResponse.json({ error: 'Expiry step failed' }, { status: 500 });
  }

  const results = { refunded: 0, retrying: 0, failed: 0 };
  let processed = 0;

  while (hasTime() && processed < MAX_REFUNDS_PER_RUN) {
    const { data: batch, error } = await db.rpc('claim_pool_refunds', { p_limit: BATCH });
    if (error) { console.error('[cron:expire-pools] claim failed', error.message); break; }
    const claimed = (batch ?? []) as Claimed[];
    if (claimed.length === 0) break;

    for (const m of claimed) {
      processed += 1;
      try {
        const refund = await refundTransaction(m.transaction_id);
        await db.rpc('finish_pool_refund', {
          p_pool_id: m.pool_id, p_buyer_id: m.buyer_id, p_success: true, p_refund_ref: refund.id, p_error: null,
        });
        results.refunded += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const permanent = err instanceof FlutterwaveError && !err.retryable;
        await db.rpc('finish_pool_refund', {
          p_pool_id: m.pool_id, p_buyer_id: m.buyer_id, p_success: false, p_refund_ref: null, p_error: message,
        });
        if (permanent && m.attempt >= 5) results.failed += 1; else results.retrying += 1;
        console.error('[cron:expire-pools] refund failed', { pool: m.pool_id, buyer: m.buyer_id, attempt: m.attempt, message });
      }
    }
  }

  // Health signals for alerting: refunds that need a human.
  const staleCutoff = new Date(Date.now() - 30 * 60_000).toISOString();
  const [{ count: stuck }, { count: parked }] = await Promise.all([
    db.from('pool_members').select('pool_id', { count: 'exact', head: true })
      .eq('refund_status', 'processing').lt('refund_claimed_at', staleCutoff),
    db.from('pool_members').select('pool_id', { count: 'exact', head: true }).eq('refund_status', 'failed'),
  ]);

  const summary = {
    expiredPools: (expired ?? []).length,
    pools: expired ?? [],
    refunds: results,
    needsManualReview: { stuckProcessing: stuck ?? 0, failedAfterRetries: parked ?? 0 },
  };
  if ((stuck ?? 0) > 0 || (parked ?? 0) > 0) console.warn('[cron:expire-pools] refunds need attention', summary.needsManualReview);
  return NextResponse.json(summary);
}

export const GET = run;   // Vercel Cron uses GET
export const POST = run;
