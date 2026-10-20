'use server';

import { revalidatePath } from 'next/cache';
import { getSessionProfile } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { deadline } from '@/lib/cron';
import { friendlyError } from '@/lib/format';
import { retryWebhooks } from '@/lib/payments/webhook-retry';
import { runEscrowReconciliation } from '@/lib/payments/escrow-reconcile';
import { isAdmin } from '@/lib/auth/admin-access';

export type ReconActionResult = { ok: boolean; message: string };

/** Server actions are public POST endpoints: re-check the admin role first, and only then use the service-role client. */
async function requireAdmin() {
  const ctx = await getSessionProfile();
  if (!ctx.user || !isAdmin(ctx.profile)) return null;
  return ctx;
}

export async function runReconciliationNow(): Promise<ReconActionResult> {
  const ctx = await requireAdmin();
  if (!ctx) return { ok: false, message: 'Admin access required.' };
  try {
    const r = await runEscrowReconciliation({ db: createAdminClient(), hasTime: deadline(40_000), triggeredBy: `admin:${ctx.user.id}` });
    revalidatePath('/admin/reconciliation');
    return { ok: true, message: `Run finished — ${r.critical} critical, ${r.warnings} warnings (${r.new_issues} new).` };
  } catch (err) {
    return { ok: false, message: `Reconciliation failed: ${err instanceof Error ? err.message : 'unknown error'}` };
  }
}

export async function retryWebhooksNow(): Promise<ReconActionResult> {
  const ctx = await requireAdmin();
  if (!ctx) return { ok: false, message: 'Admin access required.' };
  try {
    const r = await retryWebhooks({ db: createAdminClient(), hasTime: deadline(40_000) });
    revalidatePath('/admin/reconciliation');
    return { ok: true, message: `Retried ${r.examined} event(s): ${r.settled} settled, ${r.still_pending} pending, ${r.dead_lettered.length} dead-lettered; ${r.mpesa_synced} M-Pesa prompt(s) synced.` };
  } catch (err) {
    return { ok: false, message: `Retry failed: ${err instanceof Error ? err.message : 'unknown error'}` };
  }
}

export async function resolveIssue(issueId: number, resolution: string): Promise<ReconActionResult> {
  const ctx = await requireAdmin();
  if (!ctx) return { ok: false, message: 'Admin access required.' };
  const { error } = await ctx.supabase.rpc('admin_resolve_recon_issue', { p_issue_id: issueId, p_resolution: resolution });
  if (error) return { ok: false, message: friendlyError(error.message) };
  revalidatePath('/admin/reconciliation');
  return { ok: true, message: 'Marked resolved.' };
}

export async function requeueEvent(eventId: number): Promise<ReconActionResult> {
  const ctx = await requireAdmin();
  if (!ctx) return { ok: false, message: 'Admin access required.' };
  const { error } = await ctx.supabase.rpc('admin_requeue_payment_event', { p_event_id: eventId });
  if (error) return { ok: false, message: friendlyError(error.message) };
  revalidatePath('/admin/reconciliation');
  return { ok: true, message: 'Requeued — it will be retried on the next worker run.' };
}
