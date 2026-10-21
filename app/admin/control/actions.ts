'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { getSessionProfile } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { friendlyError } from '@/lib/format';
import { UUID_RE } from '@/lib/uploads';
import { isPermanentAdmin, isSuperAdmin, requestFingerprint } from '@/lib/auth/admin-access';
import { TRACKING_RE, parseUsdToCents, planRefund, validateLandedCost, validateReason } from '@/lib/admin-overrides';
import { processPayout, type PayoutResult } from '@/lib/payments/payouts';
import { PaystackError, refundTransaction } from '@/lib/payments/paystack';
import { financialOverrideBlock } from '@/lib/security/two-factor-gate';
import { twoFactorState } from '@/lib/security/two-factor-server';

/** 2FA gate for money-moving overrides, checked BEFORE any provider call (Postgres re-checks on insert). */
async function moneyGate(ctx: { supabase: Parameters<typeof twoFactorState>[0] }): Promise<string | null> {
  return financialOverrideBlock(await twoFactorState(ctx.supabase));
}

export type ControlResult = { ok: boolean; message: string };

/**
 * Server actions are public POST endpoints: every one re-checks the caller here,
 * and the super_* / admin_* SQL functions re-check again (is_super_admin(),
 * is_permanent_admin()) before writing the immutable audit log with IP + UA.
 * The service-role client is used only after those checks, for provider steps
 * (payouts, Paystack lookups) the user's session cannot do.
 */
async function caller(level: 'super' | 'permanent') {
  const ctx = await getSessionProfile();
  if (!ctx.user || !(level === 'super' ? isSuperAdmin(ctx.profile) : isPermanentAdmin(ctx.profile))) return null;
  return { ...ctx, fp: requestFingerprint(await headers()) };
}

const done = (message: string, orderId?: string): ControlResult => {
  revalidatePath('/admin/control');
  if (orderId) revalidatePath(`/admin/orders/${orderId}/tracking`);
  return { ok: true, message };
};

export async function savePlatformSettings(input: { pauseNewOrders: boolean; pauseCheckout: boolean; maintenance: boolean; banner: string }): Promise<ControlResult> {
  const ctx = await caller('permanent');
  if (!ctx) return { ok: false, message: 'Only permanent admins can change platform switches.' };
  const { error } = await ctx.supabase.rpc('admin_set_platform_settings', {
    p_pause_new_orders: !!input.pauseNewOrders, p_pause_checkout: !!input.pauseCheckout, p_maintenance_mode: !!input.maintenance,
    p_banner_message: input.banner.slice(0, 300), p_ip: ctx.fp.ip, p_ua: ctx.fp.ua,
  });
  if (error) return { ok: false, message: friendlyError(error.message) };
  revalidatePath('/', 'layout');
  return { ok: true, message: input.maintenance ? 'Saved. Maintenance mode reaches every page within ~15 seconds.' : 'Platform switches saved.' };
}

function payoutMessage(r: PayoutResult): string {
  switch (r.action) {
    case 'initiated': return `payout sent (${r.payoutAmount} ${r.payoutCurrency}).`;
    case 'pending_reconciliation': return `payout is awaiting reconciliation: ${r.reason}`;
    case 'failed': return `payout failed: ${r.reason}. The retry cron will try again.`;
    case 'hold': return `payout on hold: ${r.reason}`;
    case 'skip': return `payout already ${r.status}.`;
  }
}

async function runPayout(ctx: NonNullable<Awaited<ReturnType<typeof caller>>>, orderId: string, action: string, reason: string) {
  let summary: string;
  let detail: Record<string, unknown>;
  try {
    const r = await processPayout(orderId);
    summary = payoutMessage(r);
    detail = { result: r.action, reason };
  } catch (err) {
    summary = `payout could not start (${err instanceof Error ? err.message : 'unknown error'}). Retry from here or wait for the cron.`;
    detail = { result: 'error', reason };
  }
  await ctx.supabase.rpc('log_admin_action', { p_action: action, p_target_type: 'order', p_target_id: orderId, p_detail: detail, p_ip: ctx.fp.ip, p_ua: ctx.fp.ua });
  return summary;
}

/** Force-release escrow, then start the normal supplier payout. */
export async function forceRelease(orderId: string, reason: string): Promise<ControlResult> {
  const ctx = await caller('super');
  if (!ctx) return { ok: false, message: 'Super admin access required.' };
  const blocked = await moneyGate(ctx);
  if (blocked) return { ok: false, message: blocked };
  if (!UUID_RE.test(orderId)) return { ok: false, message: 'Invalid order.' };
  const r = validateReason(reason);
  if (!r.ok) return { ok: false, message: r.error };
  const { error } = await ctx.supabase.rpc('super_force_release', { p_order_id: orderId, p_reason: r.reason, p_ip: ctx.fp.ip, p_ua: ctx.fp.ua });
  if (error) return { ok: false, message: friendlyError(error.message) };
  return done(`Escrow released; ${await runPayout(ctx, orderId, 'payout.after_force_release', r.reason)}`, orderId);
}

/** Retry / start the supplier payout for an already released order. */
export async function startPayout(orderId: string, reason: string): Promise<ControlResult> {
  const ctx = await caller('super');
  if (!ctx) return { ok: false, message: 'Super admin access required.' };
  const blocked = await moneyGate(ctx);
  if (blocked) return { ok: false, message: blocked };
  if (!UUID_RE.test(orderId)) return { ok: false, message: 'Invalid order.' };
  const r = validateReason(reason);
  if (!r.ok) return { ok: false, message: r.error };
  const { data: order } = await ctx.supabase.from('orders').select('escrow_status').eq('id', orderId).maybeSingle();
  if (!order) return { ok: false, message: 'Order not found.' };
  if (order.escrow_status !== 'released') return { ok: false, message: 'Payouts start only after escrow is released.' };
  const summary = await runPayout(ctx, orderId, 'payout.manual', r.reason);
  return done(summary.charAt(0).toUpperCase() + summary.slice(1), orderId);
}

/** Full or partial refund. Card → Paystack refund API; M-Pesa → recorded for finance to send manually. */
export async function refundOrder(orderId: string, mode: 'full' | 'partial', amountUsd: string, reason: string): Promise<ControlResult> {
  const ctx = await caller('super');
  if (!ctx) return { ok: false, message: 'Super admin access required.' };
  const blocked = await moneyGate(ctx);
  if (blocked) return { ok: false, message: blocked };
  if (!UUID_RE.test(orderId) || (mode !== 'full' && mode !== 'partial')) return { ok: false, message: 'Invalid request.' };
  const r = validateReason(reason);
  if (!r.ok) return { ok: false, message: r.error };

  let db;
  try { db = createAdminClient(); } catch { return { ok: false, message: 'SUPABASE_SERVICE_ROLE_KEY is not configured on the server.' }; }
  const { data: order } = await db.from('orders').select('id, total_cents, escrow_status, checkout_group_id').eq('id', orderId).maybeSingle();
  if (!order) return { ok: false, message: 'Order not found.' };

  // A cart (checkout group) is paid in one charge; refund this order's share of it.
  const cardQ = db.from('card_payments').select('provider_ref, currency, usd_rate, amount_minor').eq('status', 'succeeded');
  const mpesaQ = db.from('mpesa_payments').select('id, mpesa_receipt').eq('status', 'succeeded');
  const [{ data: card }, { data: mpesa }] = await Promise.all([
    (order.checkout_group_id ? cardQ.eq('checkout_group_id', order.checkout_group_id) : cardQ.eq('order_id', orderId))
      .order('completed_at', { ascending: false }).limit(1)
      .maybeSingle<{ provider_ref: string | null; currency: string; usd_rate: number | string; amount_minor: number | string }>(),
    (order.checkout_group_id ? mpesaQ.eq('checkout_group_id', order.checkout_group_id) : mpesaQ.eq('order_id', orderId))
      .order('created_at', { ascending: false }).limit(1).maybeSingle<{ id: string; mpesa_receipt: string | null }>(),
  ]);

  const plan = planRefund({
    order, mode, amountCents: mode === 'partial' ? parseUsdToCents(amountUsd) : null,
    card: card ? { ...card, usd_rate: Number(card.usd_rate), amount_minor: Number(card.amount_minor) } : null, mpesa,
  });
  if (!plan.ok) return { ok: false, message: plan.error };

  let status: 'sent' | 'manual_required' | 'failed' = 'manual_required';
  let providerRef: string | null = plan.provider === 'mpesa' ? plan.receipt : null;
  let providerNote = '';
  if (plan.provider === 'paystack') {
    try {
      const refund = await refundTransaction(plan.transaction, plan.amountMinor);
      status = 'sent'; providerRef = refund.id;
    } catch (err) {
      status = 'failed';
      providerNote = err instanceof PaystackError || err instanceof Error ? err.message : 'Paystack error';
    }
  }

  const { error } = await ctx.supabase.rpc('super_record_refund', {
    p_order_id: orderId, p_amount_cents: plan.amountCents, p_full: plan.full, p_provider: plan.provider, p_provider_ref: providerRef,
    p_status: status, p_reason: providerNote ? `${r.reason} [Paystack: ${providerNote}]`.slice(0, 1000) : r.reason, p_ip: ctx.fp.ip, p_ua: ctx.fp.ua,
  });
  if (error) {
    console.error('[control] refund recorded with error', { orderId, status, providerRef, error: error.message });
    return { ok: false, message: status === 'sent'
      ? `Paystack refund ${providerRef} was sent, but recording it failed: ${friendlyError(error.message)}. Reconcile this order manually.`
      : friendlyError(error.message) };
  }
  if (status === 'failed') return { ok: false, message: `Paystack refused the refund (${providerNote}). Nothing was changed; the attempt is logged.` };
  return done(status === 'sent'
    ? `${plan.full ? 'Full' : 'Partial'} card refund sent through Paystack (ref ${providerRef}).`
    : `${plan.full ? 'Full' : 'Partial'} refund recorded. Send it by M-Pesa B2C manually${plan.provider === 'mpesa' && plan.receipt ? ` (original receipt ${plan.receipt})` : ''}.`, orderId);
}

export async function setTrackingReference(orderId: string, trackingNumber: string, carrier: string, reason: string): Promise<ControlResult> {
  const ctx = await caller('super');
  if (!ctx) return { ok: false, message: 'Super admin access required.' };
  if (!UUID_RE.test(orderId)) return { ok: false, message: 'Invalid order.' };
  const tn = trackingNumber.trim();
  if (tn && !TRACKING_RE.test(tn)) return { ok: false, message: 'Tracking numbers are 3–80 letters, digits, spaces, dots, dashes or slashes.' };
  const r = validateReason(reason);
  if (!r.ok) return { ok: false, message: r.error };
  const { error } = await ctx.supabase.rpc('super_set_tracking_reference', {
    p_order_id: orderId, p_tracking_number: tn, p_carrier: carrier.trim().slice(0, 80), p_reason: r.reason, p_ip: ctx.fp.ip, p_ua: ctx.fp.ua,
  });
  if (error) return { ok: false, message: friendlyError(error.message) };
  return done('Tracking reference saved.', orderId);
}

export async function overrideLandedCost(orderId: string, goods: string, freight: string, customs: string, reason: string): Promise<ControlResult> {
  const ctx = await caller('super');
  if (!ctx) return { ok: false, message: 'Super admin access required.' };
  const blocked = await moneyGate(ctx);
  if (blocked) return { ok: false, message: blocked };
  if (!UUID_RE.test(orderId)) return { ok: false, message: 'Invalid order.' };
  const r = validateReason(reason);
  if (!r.ok) return { ok: false, message: r.error };
  const { data: order } = await ctx.supabase.from('orders').select('escrow_status, checkout_group_id').eq('id', orderId).maybeSingle();
  if (!order) return { ok: false, message: 'Order not found.' };
  const v = validateLandedCost(order, { goods, freight, customs });
  if (!v.ok) return { ok: false, message: v.error };
  const { error } = await ctx.supabase.rpc('super_override_landed_cost', {
    p_order_id: orderId, p_goods: v.goods, p_freight: v.freight, p_customs: v.customs, p_reason: r.reason, p_ip: ctx.fp.ip, p_ua: ctx.fp.ua,
  });
  if (error) return { ok: false, message: friendlyError(error.message) };
  return done('Landed cost updated. The buyer sees the new total at checkout.', orderId);
}
