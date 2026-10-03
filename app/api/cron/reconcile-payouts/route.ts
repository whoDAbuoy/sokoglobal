import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { deadline, isAuthorizedCron } from '@/lib/cron';
import { reconcilePayouts } from '@/lib/payments/reconcile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET|POST /api/cron/reconcile-payouts   (Authorization: Bearer CRON_SECRET)
 * Scheduled at :20 each hour (vercel.json) — before retry-payouts at :35, so
 * payouts this job marks 'failed' are re-sent in the same hour.
 * Logic and decision table: lib/payments/reconcile.ts
 */
async function run(request: Request) {
  if (!isAuthorizedCron(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const report = await reconcilePayouts({ db: createAdminClient(), hasTime: deadline(45_000) });
    if (report.needsHuman.length) console.error('[cron:reconcile] needs human', report.needsHuman);
    return NextResponse.json(report);
  } catch (err) {
    console.error('[cron:reconcile]', err);
    return NextResponse.json({ error: 'Reconciliation failed' }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
