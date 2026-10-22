import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAuthorizedCron } from '@/lib/cron';
import { drainNotificationQueue } from '@/lib/notifications/dispatch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET|POST /api/cron/restock-reminders   (Authorization: Bearer CRON_SECRET)
 *
 * queue_restock_reminders() (migration 021): buyers whose order completed 30 or
 * 60 days ago, and who have not reordered that listing since, get a
 * "Time to restock?" email/SMS through notification_queue (respecting their
 * notification settings). Idempotent per order and milestone, so overlapping
 * runs and the pg_cron schedule never double-send. Then sends what is due.
 */
async function run(request: Request) {
  if (!isAuthorizedCron(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await createAdminClient().rpc('queue_restock_reminders', { p_limit: 500 });
  if (error) {
    console.error('[cron:restock-reminders] queue_restock_reminders failed', error.message);
    return NextResponse.json({ error: 'Queueing failed' }, { status: 500 });
  }
  const notifications = await drainNotificationQueue({ limit: 200, budgetMs: 40_000 });
  return NextResponse.json({ queued: Number(data ?? 0), notifications });
}

export const GET = run;
export const POST = run;
