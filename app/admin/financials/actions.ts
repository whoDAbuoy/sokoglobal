'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { getSessionProfile } from '@/lib/supabase/server';
import { friendlyError } from '@/lib/format';
import { isSuperAdmin, requestFingerprint } from '@/lib/auth/admin-access';
import { parsePricingInput, pricingChanges, type PricingInput, type PricingKey } from '@/lib/pricing';
import { getPricing } from '@/lib/pricing-server';
import { createAdminClient } from '@/lib/supabase/admin';
import { UUID_RE } from '@/lib/uploads';
import { parseUsdToCents } from '@/lib/admin-overrides';
import { financialOverrideBlock } from '@/lib/security/two-factor-gate';
import { twoFactorState } from '@/lib/security/two-factor-server';
import { dispatchNotificationsAfterResponse } from '@/lib/notifications/dispatch';
import { SWIFT_FIELDS, WALLET_KEYS, swiftFieldError, validWallet, type CryptoWalletKey } from '@/lib/payment-methods';
import { fieldErrors, formatPeriodEnd, grantGoldInput, revokeGoldInput, type FieldErrors, type GrantGoldInput, type RevokeGoldInput } from '@/lib/gold-grant';

export type PricingResult = { ok: boolean; message: string; errors?: Partial<Record<PricingKey, string>> };

/**
 * Save platform pricing. Server Actions are public POST endpoints: the caller is
 * re-checked here and again by super_set_platform_pricing() (is_super_admin()),
 * which validates every value and writes the audit log with IP + UA. Only the
 * fields that changed are sent. New prices apply to orders, charges and
 * listings created from now on; nothing already priced changes.
 */
export async function savePricing(input: PricingInput): Promise<PricingResult> {
  const ctx = await getSessionProfile();
  if (!ctx.user || !isSuperAdmin(ctx.profile)) return { ok: false, message: 'Super admin access required.' };
  const parsed = parsePricingInput(input);
  if (!parsed.ok) return { ok: false, message: 'Please fix the highlighted fields.', errors: parsed.errors };

  const current = await getPricing(ctx.supabase);
  if (!current.available) return { ok: false, message: 'Run supabase/migrations/026_platform_monetization.sql first.' };
  const changes = pricingChanges(current.pricing, parsed.value);
  if (!Object.keys(changes).length) return { ok: true, message: 'Nothing changed.' };

  const fp = requestFingerprint(await headers());
  const { error } = await ctx.supabase.rpc('super_set_platform_pricing', { p_pricing: changes, p_ip: fp.ip, p_ua: fp.ua });
  if (error) return { ok: false, message: friendlyError(error.message) };
  revalidatePath('/admin/financials');
  revalidatePath('/supplier/subscription');
  return { ok: true, message: `Saved ${Object.keys(changes).length} change${Object.keys(changes).length === 1 ? '' : 's'}. New prices apply from now on.` };
}

export type PaymentSettingsInput = {
  flags: Record<'enable_dpo_pay' | 'enable_airtel_money' | 'enable_paypal' | 'enable_swift_wire' | 'enable_crypto', boolean>;
  swift_bank_details: Record<(typeof SWIFT_FIELDS)[number], string>;
  crypto_deposit_wallets: Record<CryptoWalletKey, string>;
  /** Percentage, e.g. "1" or "0.5". */
  crypto_markup: string;
};

/** Payment channel switches, SWIFT details and crypto wallets (super_set_payment_settings, migration 028; validated + audited). */
export async function savePaymentSettings(input: PaymentSettingsInput): Promise<PricingResult> {
  const ctx = await getSessionProfile();
  if (!ctx.user || !isSuperAdmin(ctx.profile)) return { ok: false, message: 'Super admin access required.' };
  for (const k of SWIFT_FIELDS) {
    const err = swiftFieldError(k, input.swift_bank_details[k] ?? '');
    if (err) return { ok: false, message: `${k.replace(/_/g, ' ')}: ${err}` };
  }
  for (const k of WALLET_KEYS) {
    if (!validWallet(k, input.crypto_deposit_wallets[k] ?? '')) return { ok: false, message: `${k.replace('_', ' ').toUpperCase()}: that doesn't look like a valid address.` };
  }
  const markup = input.crypto_markup.replace(/[%\s]/g, '');
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(markup) || Number(markup) > 5) return { ok: false, message: 'Crypto fee must be between 0% and 5%.' };

  const fp = requestFingerprint(await headers());
  const { error } = await ctx.supabase.rpc('super_set_payment_settings', {
    p: {
      ...input.flags,
      swift_bank_details: Object.fromEntries(SWIFT_FIELDS.map((k) => [k, (input.swift_bank_details[k] ?? '').trim()])),
      crypto_deposit_wallets: Object.fromEntries(WALLET_KEYS.map((k) => [k, (input.crypto_deposit_wallets[k] ?? '').trim()])),
      crypto_markup_percent: Math.round(Number(markup) * 100) / 10_000,
    },
    p_ip: fp.ip, p_ua: fp.ua,
  });
  if (error) return { ok: false, message: friendlyError(error.message) };
  revalidatePath('/admin/financials');
  return { ok: true, message: 'Payment settings saved. Buyers see the change on their next page load.' };
}

/**
 * Approve or reject a SWIFT / crypto transfer. Moving money into escrow needs a super admin with
 * 2FA (same gate as refunds and force-release). Funding runs with the service role — orders leave
 * pending_payment only from the server (migration 018) — and the function records the admin as actor.
 */
async function reviewer() {
  const ctx = await getSessionProfile();
  if (!ctx.user || !isSuperAdmin(ctx.profile)) return { error: 'Super admin access required.' } as const;
  const blocked = financialOverrideBlock(await twoFactorState(ctx.supabase));
  if (blocked) return { error: blocked } as const;
  return { ctx, fp: requestFingerprint(await headers()) } as const;
}

export async function approveManualPayment(paymentId: string, receivedUsd: string, note: string): Promise<PricingResult> {
  if (!UUID_RE.test(paymentId)) return { ok: false, message: 'Invalid payment.' };
  const r = await reviewer();
  if ('error' in r) return { ok: false, message: r.error ?? 'Not allowed.' };
  const cents = parseUsdToCents(receivedUsd);
  if (cents === null || cents <= 0) return { ok: false, message: 'Enter the amount that actually arrived, in USD.' };
  const { data, error } = await createAdminClient().rpc('approve_manual_payment', {
    p_id: paymentId, p_received_cents: cents, p_note: note.trim().slice(0, 1000) || null, p_actor: r.ctx.user!.id, p_ip: r.fp.ip, p_ua: r.fp.ua,
  });
  if (error) return { ok: false, message: friendlyError(error.message) };
  dispatchNotificationsAfterResponse();
  revalidatePath('/admin/financials');
  revalidatePath(`/dashboard/orders/${(data as { id: string }).id}`);
  return { ok: true, message: `Approved — order #${(data as { id: string }).id.slice(0, 8).toUpperCase()} is now ${String((data as { escrow_status: string }).escrow_status).replace(/_/g, ' ')}.` };
}

export async function rejectManualPayment(paymentId: string, note: string): Promise<PricingResult> {
  if (!UUID_RE.test(paymentId)) return { ok: false, message: 'Invalid payment.' };
  const r = await reviewer();
  if ('error' in r) return { ok: false, message: r.error ?? 'Not allowed.' };
  const { error } = await createAdminClient().rpc('reject_manual_payment', {
    p_id: paymentId, p_note: note.trim().slice(0, 1000), p_actor: r.ctx.user!.id, p_ip: r.fp.ip, p_ua: r.fp.ua,
  });
  if (error) return { ok: false, message: friendlyError(error.message) };
  dispatchNotificationsAfterResponse();
  revalidatePath('/admin/financials');
  return { ok: true, message: 'Rejected — the buyer has been told why and can pay again.' };
}

export type GoldGrantResult = { ok: boolean; message: string; errors?: FieldErrors };

/**
 * Complimentary Gold Supplier (super_grant_gold / super_revoke_gold, migration 034). Lowering a
 * supplier's commission is a financial override, so it needs a super admin with a verified 2FA
 * session; Postgres re-checks is_super_admin() and writes the audit log with IP + UA.
 * Runs as the signed-in admin (not the service role) so the audit records who did it.
 */
async function goldDesk() {
  const ctx = await getSessionProfile();
  if (!ctx.user || !isSuperAdmin(ctx.profile)) return { error: 'Super admin access required.' } as const;
  const blocked = financialOverrideBlock(await twoFactorState(ctx.supabase));
  if (blocked) return { error: blocked } as const;
  return { ctx, fp: requestFingerprint(await headers()) } as const;
}

export async function grantGold(input: GrantGoldInput): Promise<GoldGrantResult> {
  const parsed = grantGoldInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Please fix the highlighted fields.', errors: fieldErrors(parsed.error) };
  const r = await goldDesk();
  if ('error' in r) return { ok: false, message: r.error ?? 'Not allowed.' };
  const { email, months, reason } = parsed.data;
  const { data, error } = await r.ctx.supabase.rpc('super_grant_gold', { p_email: email, p_months: months, p_reason: reason, p_ip: r.fp.ip, p_ua: r.fp.ua });
  if (error) return { ok: false, message: friendlyError(error.message) };
  const res = data as { company_name: string; period_end: string };
  revalidatePath('/admin/financials');
  revalidatePath('/supplier/subscription');
  return { ok: true, message: `${res.company_name} is Gold until ${formatPeriodEnd(res.period_end)}.` };
}

export async function revokeGold(input: RevokeGoldInput): Promise<GoldGrantResult> {
  const parsed = revokeGoldInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Please fix the highlighted fields.', errors: fieldErrors(parsed.error) };
  const r = await goldDesk();
  if ('error' in r) return { ok: false, message: r.error ?? 'Not allowed.' };
  const { data, error } = await r.ctx.supabase.rpc('super_revoke_gold', { p_email: parsed.data.email, p_reason: parsed.data.reason, p_ip: r.fp.ip, p_ua: r.fp.ua });
  if (error) return { ok: false, message: friendlyError(error.message) };
  revalidatePath('/admin/financials');
  revalidatePath('/supplier/subscription');
  return { ok: true, message: `Gold ended for ${(data as { company_name: string }).company_name}.` };
}
