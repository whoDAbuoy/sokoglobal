import { NextResponse } from 'next/server';
import { isAuthorizedCron } from '@/lib/cron';
import { drainNotificationQueue } from '@/lib/notifications/dispatch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET|POST /api/cron/dispatch-notifications   (Authorization: Bearer CRON_SECRET)
 *
 * Sweeps notification_queue: anything the in-request dispatch missed, plus
 * retries (backoff 2–32 min, 5 attempts). Most rows are already sent seconds
 * after the event by dispatchNotificationsAfterResponse().
 */
async function run(request: Request) {
  if (!isAuthorizedCron(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const result = await drainNotificationQueue({ limit: 500, budgetMs: 45_000 });
  if (!result.channels.length) console.warn('[cron:dispatch-notifications] no provider configured (RESEND_API_KEY / AT_API_KEY)');
  return NextResponse.json(result);
}

export const GET = run;   // Vercel Cron uses GET
export const POST = run;
