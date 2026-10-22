'use server';

import { revalidatePath } from 'next/cache';
import { getSessionProfile } from '@/lib/supabase/server';
import { friendlyError } from '@/lib/format';
import { UUID_RE } from '@/lib/uploads';
import type { PaymentStructure } from '@/lib/milestone';

export type StructureResult = { ok: true } | { ok: false; message: string };

/**
 * Buyer picks "pay in full" or "milestone escrow" before paying. Postgres
 * (set_order_payment_structure) re-checks ownership, eligibility, that nothing
 * is paid yet and that no charge is in flight; RFQ orders are locked there.
 */
export async function chooseStructure(orderId: string, structure: PaymentStructure): Promise<StructureResult> {
  if (!UUID_RE.test(orderId) || (structure !== 'full' && structure !== 'milestone_30_70')) return { ok: false, message: 'Invalid request.' };
  const { supabase, user, profile } = await getSessionProfile();
  if (!user || profile?.role !== 'importer') return { ok: false, message: 'Sign in with your importer account.' };
  const { error } = await supabase.rpc('set_order_payment_structure', { p_order_id: orderId, p_structure: structure });
  if (error) return { ok: false, message: friendlyError(error.message) };
  revalidatePath(`/dashboard/orders/${orderId}`);
  return { ok: true };
}
