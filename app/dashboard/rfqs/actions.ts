'use server';

import { revalidatePath } from 'next/cache';
import { getSessionProfile } from '@/lib/supabase/server';
import { friendlyError } from '@/lib/format';
import { UUID_RE } from '@/lib/uploads';
import { validateRfqDraft } from '@/lib/rfq';
import type { PaymentStructure } from '@/lib/milestone';
import { checkCanTransact } from '@/lib/platform-server';
import { dispatchNotificationsAfterResponse } from '@/lib/notifications/dispatch';

export type RfqFormState = { ok: boolean; message: string; errors?: Record<string, string> } | null;
export type RfqResult = { ok: true; orderId?: string } | { ok: false; message: string };

const str = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v : '');

async function importer() {
  const ctx = await getSessionProfile();
  return ctx.user && ctx.profile?.role === 'importer' ? ctx : null;
}

/** Post a request for quotes. submit_rfq() re-checks role, KYC, limits and the category. */
export async function createRfq(_prev: RfqFormState, form: FormData): Promise<RfqFormState> {
  const ctx = await importer();
  if (!ctx) return { ok: false, message: 'Sign in with your importer account.' };
  const r = validateRfqDraft(Object.fromEntries([...form.entries()].map(([k, v]) => [k, str(v)])));
  if (!r.ok) return { ok: false, message: r.errors.form ?? 'Please fix the highlighted fields.', errors: r.errors as Record<string, string> };
  const v = r.value;
  const { error } = await ctx.supabase.rpc('submit_rfq', {
    p_title: v.title, p_description: v.description, p_quantity: v.quantity, p_delivery_location: v.deliveryLocation,
    p_target_price_kes: v.targetPriceKes, p_category_id: v.categoryId, p_product_id: v.productId,
    p_unit_of_measure: v.unitOfMeasure, p_expires_in_days: v.expiresInDays,
  });
  if (error) return { ok: false, message: friendlyError(error.message) };
  revalidatePath('/dashboard/rfqs');
  return { ok: true, message: 'Request posted. Matching suppliers can now quote.' };
}

/** Accept a quote → a locked escrow order (paid from its order page). */
export async function acceptQuote(quoteId: string, structure: PaymentStructure): Promise<RfqResult> {
  if (!UUID_RE.test(quoteId) || (structure !== 'full' && structure !== 'milestone_30_70')) return { ok: false, message: 'Invalid request.' };
  const ctx = await importer();
  if (!ctx) return { ok: false, message: 'Sign in with your importer account.' };
  const blocked = await checkCanTransact(ctx.supabase, ctx.user!.id, 'order');
  if (blocked) return { ok: false, message: blocked.error };
  const { data, error } = await ctx.supabase.rpc('accept_rfq_quote', { p_quote_id: quoteId, p_payment_structure: structure });
  if (error) return { ok: false, message: friendlyError(error.message) };
  dispatchNotificationsAfterResponse();
  revalidatePath('/dashboard/rfqs');
  return { ok: true, orderId: (data as { id: string }).id };
}

export async function rejectQuote(quoteId: string): Promise<RfqResult> {
  if (!UUID_RE.test(quoteId)) return { ok: false, message: 'Invalid request.' };
  const ctx = await importer();
  if (!ctx) return { ok: false, message: 'Sign in with your importer account.' };
  const { error } = await ctx.supabase.rpc('reject_rfq_quote', { p_quote_id: quoteId });
  if (error) return { ok: false, message: friendlyError(error.message) };
  revalidatePath('/dashboard/rfqs');
  return { ok: true };
}

export async function closeRfq(rfqId: string): Promise<RfqResult> {
  if (!UUID_RE.test(rfqId)) return { ok: false, message: 'Invalid request.' };
  const ctx = await importer();
  if (!ctx) return { ok: false, message: 'Sign in with your importer account.' };
  const { error } = await ctx.supabase.rpc('close_rfq', { p_rfq_id: rfqId });
  if (error) return { ok: false, message: friendlyError(error.message) };
  revalidatePath('/dashboard/rfqs');
  return { ok: true };
}
