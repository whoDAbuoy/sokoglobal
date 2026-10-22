'use server';

import { revalidatePath } from 'next/cache';
import { getSessionProfile } from '@/lib/supabase/server';
import { friendlyError } from '@/lib/format';
import { UUID_RE } from '@/lib/uploads';
import { MAX_TIERS, validateQuoteDraft } from '@/lib/rfq';
import { dispatchNotificationsAfterResponse } from '@/lib/notifications/dispatch';

export type QuoteFormState = { ok: boolean; message: string; errors?: Record<string, string> } | null;

const str = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v : '');

/**
 * Send or revise a private quote. submit_rfq_quote() re-checks the supplier
 * role, KYC, that the request is still open, that the listing is theirs, live
 * and in the requested category, and the price-tier shape.
 */
export async function submitQuote(_prev: QuoteFormState, form: FormData): Promise<QuoteFormState> {
  const { supabase, user, profile } = await getSessionProfile();
  if (!user || profile?.role !== 'supplier') return { ok: false, message: 'Supplier access required.' };
  const rfqId = str(form.get('rfqId'));
  if (!UUID_RE.test(rfqId)) return { ok: false, message: 'Invalid request.' };

  const r = validateQuoteDraft({
    productId: str(form.get('productId')), unitPriceKes: str(form.get('unitPriceKes')), moq: str(form.get('moq')),
    validDays: str(form.get('validDays')), leadTimeDays: str(form.get('leadTimeDays')), termsNote: str(form.get('termsNote')),
    tiers: Array.from({ length: MAX_TIERS }, (_, i) => ({ minQty: str(form.get(`tierQty${i}`)), unitPriceKes: str(form.get(`tierPrice${i}`)) })),
    allowedStructures: form.getAll('allowed').map(str),
  });
  if (!r.ok) return { ok: false, message: r.errors.form ?? 'Please fix the highlighted fields.', errors: r.errors as Record<string, string> };

  const v = r.value;
  const { error } = await supabase.rpc('submit_rfq_quote', {
    p_rfq_id: rfqId, p_product_id: v.productId, p_unit_price_kes: v.unitPriceKes, p_moq: v.moq,
    p_valid_until: new Date(Date.now() + v.validDays * 86_400_000).toISOString(), p_terms_note: v.termsNote,
    p_price_tiers: v.priceTiers, p_allowed_structures: v.allowedStructures, p_lead_time_days: v.leadTimeDays,
  });
  if (error) return { ok: false, message: friendlyError(error.message) };
  dispatchNotificationsAfterResponse();
  revalidatePath('/supplier/rfqs');
  return { ok: true, message: 'Quote sent. The buyer has been notified.' };
}

export async function withdrawQuote(quoteId: string): Promise<{ ok: boolean; message?: string }> {
  if (!UUID_RE.test(quoteId)) return { ok: false, message: 'Invalid request.' };
  const { supabase, user, profile } = await getSessionProfile();
  if (!user || profile?.role !== 'supplier') return { ok: false, message: 'Supplier access required.' };
  const { error } = await supabase.rpc('withdraw_rfq_quote', { p_quote_id: quoteId });
  if (error) return { ok: false, message: friendlyError(error.message) };
  revalidatePath('/supplier/rfqs');
  return { ok: true };
}
