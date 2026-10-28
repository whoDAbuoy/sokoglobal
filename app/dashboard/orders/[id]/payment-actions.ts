'use server';

import { revalidatePath } from 'next/cache';
import { getSessionProfile } from '@/lib/supabase/server';
import { friendlyError } from '@/lib/format';
import { UUID_RE } from '@/lib/uploads';
import { checkCanTransact } from '@/lib/platform-server';
import type { CryptoNetwork, ManualPaymentView } from '@/lib/payment-methods';
import { mimeFromPath } from '@/lib/file-signature';
import { storedFileMatches } from '@/lib/storage-sniff-server';
import { createAdminClient } from '@/lib/supabase/admin';

export type ManualResult = { ok: true; payment: ManualPaymentView } | { ok: false; message: string };

const COLUMNS = 'id, method, network, leg, usd_cents, fee_cents, charge_cents, reference, pay_to, tx_hash, proof_path, status, review_note, created_at, submitted_at';
const METHODS = ['swift_wire', 'crypto_usdt', 'crypto_usdc'] as const;
const NETWORKS: CryptoNetwork[] = ['trc20', 'erc20', 'polygon'];

async function buyer() {
  const ctx = await getSessionProfile();
  return ctx.user && ctx.profile?.role === 'importer' ? ctx : null;
}

/**
 * Start (or reopen) a SWIFT wire or crypto payment for what is due on an order. begin_manual_payment()
 * (migration 028) re-checks the order, the switches and wallets, freezes the amount and issues the reference.
 */
export async function startManualPayment(orderId: string, method: (typeof METHODS)[number], network: CryptoNetwork | null): Promise<ManualResult> {
  if (!UUID_RE.test(orderId) || !METHODS.includes(method) || (network !== null && !NETWORKS.includes(network))) return { ok: false, message: 'Invalid request.' };
  const ctx = await buyer();
  if (!ctx) return { ok: false, message: 'Sign in with your importer account.' };
  const blocked = await checkCanTransact(ctx.supabase, ctx.user!.id, 'checkout');
  if (blocked) return { ok: false, message: blocked.error };
  const { data, error } = await ctx.supabase.rpc('begin_manual_payment', { p_order_id: orderId, p_method: method, p_network: network });
  if (error) return { ok: false, message: friendlyError(error.message) };
  const { data: row } = await ctx.supabase.from('manual_payments').select(COLUMNS).eq('id', (data as { id: string }).id).single();
  revalidatePath(`/dashboard/orders/${orderId}`);
  return { ok: true, payment: row as ManualPaymentView };
}

/** Report the transfer: the uploaded bank receipt (wire) or the transaction hash (crypto, screenshot optional). */
export async function submitManualPayment(paymentId: string, txHash: string | null, proofPath: string | null): Promise<ManualResult> {
  if (!UUID_RE.test(paymentId)) return { ok: false, message: 'Invalid request.' };
  const ctx = await buyer();
  if (!ctx) return { ok: false, message: 'Sign in with your importer account.' };
  if (proofPath) {
    // Receipts live under the buyer's own folder; the bytes must really be the PDF / JPG / PNG the name says.
    if (!proofPath.startsWith(`${ctx.user!.id}/`)) return { ok: false, message: 'Upload the receipt again.' };
    if (!(await storedFileMatches('payment-proofs', proofPath, mimeFromPath(proofPath) ?? ''))) {
      await createAdminClient().storage.from('payment-proofs').remove([proofPath]).catch(() => undefined);
      return { ok: false, message: "That receipt isn't a readable PDF, JPG or PNG. Save or photograph it again and upload it." };
    }
  }
  const { data, error } = await ctx.supabase.rpc('submit_manual_payment', {
    p_id: paymentId, p_tx_hash: txHash?.trim() || null, p_proof_path: proofPath || null,
  });
  if (error) return { ok: false, message: friendlyError(error.message) };
  const { data: row } = await ctx.supabase.from('manual_payments').select(COLUMNS).eq('id', paymentId).single();
  revalidatePath(`/dashboard/orders/${(data as { order_id: string }).order_id}`);
  return { ok: true, payment: row as ManualPaymentView };
}

export async function cancelManualPayment(paymentId: string): Promise<{ ok: boolean; message: string }> {
  if (!UUID_RE.test(paymentId)) return { ok: false, message: 'Invalid request.' };
  const ctx = await buyer();
  if (!ctx) return { ok: false, message: 'Sign in with your importer account.' };
  const { data, error } = await ctx.supabase.rpc('cancel_manual_payment', { p_id: paymentId });
  if (error) return { ok: false, message: friendlyError(error.message) };
  revalidatePath(`/dashboard/orders/${(data as { order_id: string }).order_id}`);
  return { ok: true, message: 'Cancelled. Choose another way to pay.' };
}
