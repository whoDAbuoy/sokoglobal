import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { deadline, isAuthorizedCron } from '@/lib/cron';
import { runEscrowReconciliation } from '@/lib/payments/escrow-reconcile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET|POST /api/cron/reconcile-escrow   (Authorization: Bearer CRON_SECRET)
 * Daily escrow reconciliation against Paystack / Daraja — logic in lib/payments/escrow-reconcile.ts.
 */
async function run(request: Request) {
  if (!isAuthorizedCron(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return NextResponse.json(await runEscrowReconciliation({ db: createAdminClient(), hasTime: deadline(45_000) }));
  } catch (err) {
    console.error('[cron:reconcile-escrow]', err);
    return NextResponse.json({ error: 'Escrow reconciliation failed' }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
