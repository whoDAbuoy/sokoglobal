'use server';

import { revalidatePath } from 'next/cache';
import { getSessionProfile } from '@/lib/supabase/server';
import { friendlyError, formatUSD } from '@/lib/format';
import { UUID_RE } from '@/lib/uploads';

export type ReviewState = { ok: boolean; message: string } | null;

/** "1,234.50" | "1234.5" → 123450 cents; anything else → null. */
function dollarsToCents(value: FormDataEntryValue | null): number | null {
  const s = String(value ?? '').replace(/,/g, '').trim();
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number.parseFloat(s) * 100);
}

/**
 * Server Actions are public POST endpoints — re-check the role on every call.
 * The SQL functions check `current_role_is('admin')` again (defence in depth).
 */
async function requireAdmin() {
  const ctx = await getSessionProfile();
  if (!ctx.user || ctx.profile?.role !== 'admin') return null;
  return ctx;
}

export async function approveProduct(_prev: ReviewState, form: FormData): Promise<ReviewState> {
  const ctx = await requireAdmin();
  if (!ctx) return { ok: false, message: 'Admin access required.' };

  const productId = String(form.get('productId') ?? '');
  const freight = dollarsToCents(form.get('freight'));
  const customs = dollarsToCents(form.get('customs'));
  const notes = String(form.get('notes') ?? '').slice(0, 2000);

  if (!UUID_RE.test(productId)) return { ok: false, message: 'Invalid product.' };
  if (freight === null || customs === null) {
    return { ok: false, message: 'Enter freight and customs as dollar amounts, e.g. 112.00.' };
  }

  const { data, error } = await ctx.supabase.rpc('admin_approve_product', {
    p_product_id: productId, p_freight_cents: freight, p_customs_cents: customs, p_notes: notes,
  });
  if (error) return { ok: false, message: friendlyError(error.message) };

  revalidatePath('/admin');
  revalidatePath('/dashboard');
  return { ok: true, message: `Approved — live at ${formatUSD(data.trial_landed_cost_cents, true)} landed.` };
}

export async function rejectProduct(_prev: ReviewState, form: FormData): Promise<ReviewState> {
  const ctx = await requireAdmin();
  if (!ctx) return { ok: false, message: 'Admin access required.' };

  const productId = String(form.get('productId') ?? '');
  const notes = String(form.get('notes') ?? '').trim();
  if (!UUID_RE.test(productId)) return { ok: false, message: 'Invalid product.' };
  if (notes.length < 10) return { ok: false, message: 'Add a note (10+ characters) telling the supplier what to fix.' };

  const { error } = await ctx.supabase.rpc('admin_reject_product', { p_product_id: productId, p_notes: notes });
  if (error) return { ok: false, message: friendlyError(error.message) };

  revalidatePath('/admin');
  return { ok: true, message: 'Sent back to the supplier with your notes.' };
}
