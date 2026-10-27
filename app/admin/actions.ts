'use server';

import { revalidatePath, revalidateTag } from 'next/cache';
import { PUBLIC_CATALOG_TAG } from '@/lib/public-catalog';
import { getSessionProfile } from '@/lib/supabase/server';
import { friendlyError, formatUSD } from '@/lib/format';
import { MEDIA_BUCKET, UUID_RE } from '@/lib/uploads';
import type { ProductRemovalResult } from '@/lib/types';
import { headers } from 'next/headers';
import { PRODUCT_STATES, type ProductStateOverride } from '@/lib/admin-overrides';
import { isAdmin, isSuperAdmin, requestFingerprint } from '@/lib/auth/admin-access';

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
  if (!ctx.user || !isAdmin(ctx.profile)) return null;
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

  revalidatePath('/admin', 'layout'); // overview counts + /admin/review
  revalidatePath('/dashboard');
  revalidateTag(PUBLIC_CATALOG_TAG);   // public /products pages and sitemap
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

  revalidatePath('/admin', 'layout');
  return { ok: true, message: 'Sent back to the supplier with your notes.' };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Remove a product. admin_remove_product() re-checks the role and decides:
 * never ordered/pooled → hard delete (media rows cascade, files removed here);
 * otherwise → archived (soft delete) so escrow, payouts and disputes keep
 * their product. Both paths are written to moderation_log.
 */
export async function removeProduct(productId: string, reason: string): Promise<{ ok: boolean; message: string }> {
  const ctx = await requireAdmin();
  if (!ctx) return { ok: false, message: 'Admin access required.' };
  if (!UUID_RE.test(productId)) return { ok: false, message: 'Invalid product.' };

  const { data, error } = await ctx.supabase.rpc('admin_remove_product', {
    p_product_id: productId, p_reason: reason.slice(0, 2000),
  });
  if (error) return { ok: false, message: friendlyError(error.message) };
  const result = data as unknown as ProductRemovalResult;   // jsonb built by admin_remove_product()

  revalidatePath('/admin', 'layout');
  revalidatePath('/dashboard');
  revalidatePath('/supplier');
  revalidateTag(PUBLIC_CATALOG_TAG);

  if (result.mode === 'archived') {
    const notes = [
      result.cancelled_pools > 0 && `${plural(result.cancelled_pools, 'Trend Pool')} cancelled — paid pledges will be refunded.`,
      result.cancelled_orders > 0 && `${plural(result.cancelled_orders, 'unpaid order')} cancelled.`,
      result.open_orders > 0 && `${plural(result.open_orders, 'open order')} unaffected — follow up in Shipments.`,
    ].filter(Boolean);
    return { ok: true, message: ['Removed from the catalogue and archived (it has order history).', ...notes].join(' ') };
  }

  // The DB row is already gone, so a storage failure only leaves orphaned
  // files; their paths are kept in the moderation_log snapshot.
  const paths = result.storage_paths;
  if (paths.length > 0) {
    const { data: removed, error: storageError } = await ctx.supabase.storage.from(MEDIA_BUCKET).remove(paths);
    const orphaned = paths.length - (removed?.length ?? 0);
    if (storageError || orphaned > 0) {
      console.error('[moderation] product deleted but media cleanup incomplete', { productId, orphaned, storageError });
      return { ok: true, message: `Deleted permanently, but ${plural(orphaned, 'media file')} could not be removed from storage.` };
    }
  }
  return { ok: true, message: `Deleted permanently${paths.length ? ` with ${plural(paths.length, 'media file')}` : ''}.` };
}


/** Super admin catalogue override (migration 015: super_set_product_state, audited with IP). */
export async function setProductState(productId: string, state: ProductStateOverride, reason: string): Promise<{ ok: boolean; message: string }> {
  const ctx = await getSessionProfile();
  if (!ctx.user || !isSuperAdmin(ctx.profile)) return { ok: false, message: 'Super admin access required.' };
  if (!UUID_RE.test(productId) || !PRODUCT_STATES.includes(state)) return { ok: false, message: 'Invalid request.' };
  if (reason.trim().length < 5) return { ok: false, message: 'Give a reason (5+ characters). It is written to the audit log.' };
  const fp = requestFingerprint(await headers());
  const { error } = await ctx.supabase.rpc('super_set_product_state', {
    p_product_id: productId, p_state: state, p_reason: reason.trim().slice(0, 1000), p_ip: fp.ip, p_ua: fp.ua,
  });
  if (error) return { ok: false, message: friendlyError(error.message) };
  revalidatePath('/admin', 'layout');
  revalidatePath('/dashboard', 'layout');
  revalidateTag(PUBLIC_CATALOG_TAG);
  return { ok: true, message: `Listing is now ${state.replace('_', ' ')}.` };
}
