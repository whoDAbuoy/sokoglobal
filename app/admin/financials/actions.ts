'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { getSessionProfile } from '@/lib/supabase/server';
import { friendlyError } from '@/lib/format';
import { isSuperAdmin, requestFingerprint } from '@/lib/auth/admin-access';
import { parsePricingInput, pricingChanges, type PricingInput, type PricingKey } from '@/lib/pricing';
import { getPricing } from '@/lib/pricing-server';

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
