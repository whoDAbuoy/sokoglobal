import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { deadline, isAuthorizedCron } from '@/lib/cron';
import { retryWebhooks } from '@/lib/payments/webhook-retry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET|POST /api/cron/retry-webhooks   (Authorization: Bearer CRON_SECRET)
 * Dead-letter retry worker for payment webhooks — logic in lib/payments/webhook-retry.ts.
 * vercel.json runs it daily (Hobby limit); on Pro, run it every 15 minutes.
 */
async function run(request: Request) {
  if (!isAuthorizedCron(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return NextResponse.json(await retryWebhooks({ db: createAdminClient(), hasTime: deadline(45_000) }));
  } catch (err) {
    console.error('[cron:retry-webhooks]', err);
    return NextResponse.json({ error: 'Webhook retry failed' }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
