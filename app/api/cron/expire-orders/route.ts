import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAuthorizedCron } from '@/lib/cron';
import { drainNotificationQueue } from '@/lib/notifications/dispatch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET|POST /api/cron/expire-orders   (Authorization: Bearer CRON_SECRET)
 *
 * expire_stale_unpaid_orders(): orders unpaid for 24 h (and with no payment
 * attempt in flight) → cancelled + expired_at. pg_cron also runs it hourly when
 * the extension is enabled (migration 020); this route is the fallback.
 * Buyers are told via the order.expired notification queued by the trigger.
 * Also closes requests for quote past their deadline (expire_stale_rfqs, migration 021) and marks
 * Gold Supplier months that ran out as past_due (expire_lapsed_subscriptions, migration 026).
 */
async function run(request: Request) {
  if (!isAuthorizedCron(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = createAdminClient();
  let expired = 0;
  for (let round = 0; round < 10; round += 1) {   // 500 per call; stop when a call comes back short
    const { data, error } = await db.rpc('expire_stale_unpaid_orders', { p_limit: 500 });
    if (error) {
      console.error('[cron:expire-orders] expire_stale_unpaid_orders failed', error.message);
      return NextResponse.json({ error: 'Expiry failed', expired }, { status: 500 });
    }
    expired += Number(data ?? 0);
    if (Number(data ?? 0) < 500) break;
  }
  const { data: rfqs, error: rfqError } = await db.rpc('expire_stale_rfqs', { p_limit: 500 });
  if (rfqError) console.error('[cron:expire-orders] expire_stale_rfqs failed', rfqError.message);
  const { data: lapsed, error: subError } = await db.rpc('expire_lapsed_subscriptions');
  if (subError) console.error('[cron:expire-orders] expire_lapsed_subscriptions failed', subError.message);
  const notifications = await drainNotificationQueue({ limit: 200, budgetMs: 30_000 });
  return NextResponse.json({ expired, expiredRfqs: Number(rfqs ?? 0), lapsedSubscriptions: Number(lapsed ?? 0), notifications });
}

export const GET = run;
export const POST = run;
