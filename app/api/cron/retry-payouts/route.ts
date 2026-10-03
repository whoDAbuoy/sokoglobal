import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { deadline, isAuthorizedCron } from '@/lib/cron';
import { processPayout } from '@/lib/payments/payouts';
import { sendOpsAlert, type OpsAlertItem } from '@/lib/notifications/slack';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET|POST /api/cron/retry-payouts   (Authorization: Bearer CRON_SECRET)
 *
 * 1. Retry: payouts that failed definitively (4xx / FX quote) or were on hold
 *    (e.g. KYC approved since) and have < 5 attempts.
 * 2. Reconcile & alert: pending_ops_alerts() aggregates everything that needs
 *    a human — payouts with no transfer id, payouts without a completion
 *    webhook, 5× failed payouts/refunds, stuck refunds, payment mismatches —
 *    de-duplicated so each item is re-alerted at most once per 24h.
 *    Items are marked "sent" only after Slack accepts the message.
 */
async function run(request: Request) {
  if (!isAuthorizedCron(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = createAdminClient();
  const hasTime = deadline(40_000);

  // ── 1. Retries ─────────────────────────────────────────────────────────────
  const { data: due, error } = await db
    .from('payouts').select('order_id')
    .in('status', ['failed', 'on_hold']).lt('attempts', 5)
    .order('updated_at', { ascending: true }).limit(25);
  if (error) return NextResponse.json({ error: 'Query failed' }, { status: 500 });

  const tally: Record<string, number> = {};
  for (const row of due ?? []) {
    if (!hasTime()) break;
    try {
      const result = await processPayout(row.order_id);
      tally[result.action] = (tally[result.action] ?? 0) + 1;
    } catch (err) {
      tally.error = (tally.error ?? 0) + 1;
      console.error('[cron:retry-payouts]', row.order_id, err);
    }
  }

  // ── 2. Manual-review aggregation → Slack ───────────────────────────────────
  const { data: pending, error: alertError } = await db.rpc('pending_ops_alerts', { p_realert_after: '24 hours' });
  if (alertError) console.error('[cron:retry-payouts] pending_ops_alerts failed', alertError.message);
  const items = (pending ?? []) as OpsAlertItem[];

  let slack: { ok: boolean; sent: number; error?: string } = { ok: true, sent: 0 };
  if (items.length > 0) {
    const site = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '');
    slack = await sendOpsAlert(items, {
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'unknown',
      dashboardUrl: site ? `${site}/admin` : undefined,
    });
    if (slack.ok) {
      await db.rpc('mark_ops_alerts_sent', { p_keys: items.map((i) => i.key) });
    } else {
      // Not marked → retried on the next run. Logs keep the references visible.
      console.error('[cron:retry-payouts] Slack alert failed', slack.error, items.map((i) => `${i.kind}:${i.reference}`));
    }
  }

  return NextResponse.json({
    retried: (due ?? []).length,
    results: tally,
    needsManualReview: {
      newOrDue: items.length,
      byKind: items.reduce<Record<string, number>>((acc, i) => ({ ...acc, [i.kind]: (acc[i.kind] ?? 0) + 1 }), {}),
      references: items.map((i) => ({ kind: i.kind, reference: i.reference })),
    },
    slack: { delivered: slack.ok, sent: slack.sent, ...(slack.error ? { error: slack.error } : {}) },
  });
}

export const GET = run;
export const POST = run;
