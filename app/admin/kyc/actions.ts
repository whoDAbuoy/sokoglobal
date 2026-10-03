'use server';

import { revalidatePath } from 'next/cache';
import { getSessionProfile } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { processPayout } from '@/lib/payments/payouts';
import { friendlyError } from '@/lib/format';
import { UUID_RE } from '@/lib/uploads';

export type KycActionState = { ok: boolean; message: string } | null;

async function requireAdmin() {
  const ctx = await getSessionProfile();
  return ctx.user && ctx.profile?.role === 'admin' ? ctx : null;
}

/**
 * Approve: admin_approve_kyc() (admin session; role re-checked in Postgres)
 * sets profiles.kyc_verified = true and verifies the payout account. Payouts
 * that were on hold for this supplier are then released immediately.
 */
export async function approveKyc(_prev: KycActionState, form: FormData): Promise<KycActionState> {
  const ctx = await requireAdmin();
  if (!ctx) return { ok: false, message: 'Admin access required.' };
  const supplierId = String(form.get('supplierId') ?? '');
  if (!UUID_RE.test(supplierId)) return { ok: false, message: 'Invalid supplier.' };

  const { error } = await ctx.supabase.rpc('admin_approve_kyc', {
    p_supplier_id: supplierId, p_notes: String(form.get('notes') ?? '').slice(0, 2000),
  });
  if (error) return { ok: false, message: friendlyError(error.message) };

  let released = 0;
  try {
    const { data: held } = await createAdminClient()
      .from('payouts').select('order_id').eq('supplier_id', supplierId).eq('status', 'on_hold').limit(20);
    for (const p of held ?? []) {
      const r = await processPayout(p.order_id);
      if (r.action === 'initiated') released += 1;
    }
  } catch (err) {
    console.error('[kyc] approved, but releasing held payouts failed — cron will retry', err);
  }

  revalidatePath('/admin/kyc');
  return { ok: true, message: `KYC approved.${released ? ` ${released} held payout(s) sent.` : ''}` };
}

/**
 * Decrypt a payout account number from Supabase Vault for verification.
 * admin_reveal_payout_account() re-checks the admin role and writes an
 * audit row (who, whom, why, when) to sensitive_access_log on every call.
 */
export async function revealPayoutAccount(supplierId: string, reason: string): Promise<{ ok: boolean; value?: string; message?: string }> {
  const ctx = await requireAdmin();
  if (!ctx) return { ok: false, message: 'Admin access required.' };
  if (!UUID_RE.test(supplierId)) return { ok: false, message: 'Invalid supplier.' };
  const { data, error } = await ctx.supabase.rpc('admin_reveal_payout_account', { p_supplier_id: supplierId, p_reason: reason.slice(0, 500) });
  if (error) return { ok: false, message: friendlyError(error.message) };
  return { ok: true, value: String(data) };
}

export async function rejectKyc(_prev: KycActionState, form: FormData): Promise<KycActionState> {
  const ctx = await requireAdmin();
  if (!ctx) return { ok: false, message: 'Admin access required.' };
  const supplierId = String(form.get('supplierId') ?? '');
  const notes = String(form.get('notes') ?? '').trim();
  if (!UUID_RE.test(supplierId)) return { ok: false, message: 'Invalid supplier.' };
  if (notes.length < 10) return { ok: false, message: 'Tell the supplier what to fix (10+ characters).' };

  const { error } = await ctx.supabase.rpc('admin_reject_kyc', { p_supplier_id: supplierId, p_notes: notes });
  if (error) return { ok: false, message: friendlyError(error.message) };
  revalidatePath('/admin/kyc');
  return { ok: true, message: 'Sent back to the supplier with your notes.' };
}
