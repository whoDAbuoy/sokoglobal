import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isPaystackConfigured, verifyTransaction } from '@/lib/payments/paystack';
import { postSlack } from '@/lib/notifications/slack';
import { reconcileEscrow, type GatewayCharge, type ReconCardPayment, type ReconMpesaPayment, type ReconOrder } from '@/lib/payments/resilience';

const WINDOW_DAYS = 3;
const ORDER_COLUMNS = 'id, escrow_status, total_cents, funded_at, payment_provider, checkout_group_id, payment_structure, deposit_amount, final_paid_at';
const ROW_LIMIT = 1000;
const MAX_GATEWAY_CALLS = 150;

/**
 * Daily escrow reconciliation (used by /api/cron/reconcile-escrow and the admin
 * "Run now" button). Loads the last few days of orders and payments, asks
 * Paystack about every card payment (bounded), applies the rules in
 * resilience.ts and records the run plus any NEW discrepancies (an issue that is
 * already open is not duplicated). Read-only towards orders and payments.
 */
export async function runEscrowReconciliation({ db, hasTime, triggeredBy = 'cron', now = new Date() }: {
  db: SupabaseClient; hasTime: () => boolean; triggeredBy?: string; now?: Date;
}) {
  const from = new Date(now.getTime() - WINDOW_DAYS * 86_400_000).toISOString();
  const { data: run, error: runError } = await db.from('escrow_recon_runs')
    .insert({ window_from: from, window_to: now.toISOString(), triggered_by: triggeredBy }).select('id').single();
  if (runError) throw new Error(`start run: ${runError.message}`);

  try {
    const [orders, card, mpesa] = await Promise.all([
      db.from('orders').select(ORDER_COLUMNS)
        .or(`created_at.gte."${from}",funded_at.gte."${from}"`).limit(ROW_LIMIT),
      db.from('card_payments').select('reference, provider, kind, order_id, checkout_group_id, status, usd_cents, amount_minor, currency, created_at')
        .gte('created_at', from).limit(ROW_LIMIT),
      db.from('mpesa_payments').select('id, order_id, checkout_group_id, status, usd_cents, mpesa_receipt, created_at')
        .gte('created_at', from).limit(ROW_LIMIT),
    ]);
    for (const r of [orders, card, mpesa]) if (r.error) throw new Error(r.error.message);

    // Group payments cover orders that may have been created before the window: pull those orders too.
    const cardRows = (card.data ?? []) as ReconCardPayment[];
    const mpesaRows = (mpesa.data ?? []) as ReconMpesaPayment[];
    const orderRows = [...((orders.data ?? []) as ReconOrder[])];
    const haveOrders = new Set(orderRows.map((o) => o.id));
    const groups = [...new Set([...cardRows, ...mpesaRows].map((p) => p.checkout_group_id).filter((g): g is string => !!g))];
    if (groups.length) {
      const { data: extra } = await db.from('orders').select(ORDER_COLUMNS).in('checkout_group_id', groups);
      for (const o of (extra ?? []) as ReconOrder[]) if (!haveOrders.has(o.id)) { orderRows.push(o); haveOrders.add(o.id); }
    }

    const gateway = new Map<string, GatewayCharge>();
    let skippedGateway = 0;
    if (isPaystackConfigured()) {
      // Only Paystack charges can be verified with Paystack; DPO / PayPal / Airtel are confirmed by their own sync.
      for (const p of cardRows.filter((c) => c.status !== 'review' && (c.provider ?? 'paystack') === 'paystack')) {
        if (gateway.size >= MAX_GATEWAY_CALLS || !hasTime()) { skippedGateway += 1; continue; }
        try {
          const v = await verifyTransaction(p.reference);
          gateway.set(p.reference, { status: v.status, amountMinor: v.amountMinor, currency: v.currency });
        } catch (err) {
          gateway.set(p.reference, { error: err instanceof Error ? err.message : String(err) });
        }
      }
    }

    const { issues, summary } = reconcileEscrow({ orders: orderRows, card: cardRows, mpesa: mpesaRows, gateway, now });

    const { data: open } = issues.length
      ? await db.from('escrow_recon_issues').select('fingerprint').is('resolved_at', null).in('fingerprint', issues.map((i) => i.fingerprint))
      : { data: [] as { fingerprint: string }[] };
    const already = new Set((open ?? []).map((o) => o.fingerprint));
    const fresh = issues.filter((i) => !already.has(i.fingerprint));
    if (fresh.length) {
      const { error } = await db.from('escrow_recon_issues').insert(fresh.map((i) => ({ ...i, run_id: run.id })));
      if (error) throw new Error(`record issues: ${error.message}`);
    }

    const fullSummary = { ...summary, new_issues: fresh.length, still_open: issues.length - fresh.length, gateway_skipped: skippedGateway, paystack_configured: isPaystackConfigured() };
    await db.from('escrow_recon_runs').update({ finished_at: new Date().toISOString(), status: issues.length ? 'issues' : 'ok', summary: fullSummary }).eq('id', run.id);

    const newCritical = fresh.filter((i) => i.severity === 'critical');
    if (newCritical.length) {
      await postSlack({ text: `:rotating_light: Escrow reconciliation found ${newCritical.length} new critical discrepanc${newCritical.length === 1 ? 'y' : 'ies'}:\n`
        + newCritical.slice(0, 10).map((i) => `• ${i.kind} ${i.reference ?? i.order_id ?? ''} — ${i.message}`).join('\n') }).catch(() => undefined);
    }
    return { run_id: run.id as string, ...fullSummary };
  } catch (err) {
    await db.from('escrow_recon_runs').update({ finished_at: new Date().toISOString(), status: 'failed', summary: { error: err instanceof Error ? err.message : String(err) } }).eq('id', run.id);
    throw err;
  }
}
