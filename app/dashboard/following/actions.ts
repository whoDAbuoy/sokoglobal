'use server';

import { revalidatePath } from 'next/cache';
import { getSessionProfile } from '@/lib/supabase/server';
import { UUID_RE } from '@/lib/uploads';
import { friendlyError } from '@/lib/format';
import { parseStars } from '@/lib/ratings';

export type RateResult = { ok: boolean; message: string };

/**
 * Rate a supplier 1–5 stars (or clear the rating with stars = null). Runs as the signed-in buyer: the RLS
 * policies in migration 032 allow it only after one of their orders from this supplier was released.
 */
export async function rateSupplier(supplierId: string, stars: number | null): Promise<RateResult> {
  if (!UUID_RE.test(supplierId)) return { ok: false, message: 'Unknown supplier.' };
  const { supabase, user } = await getSessionProfile();
  if (!user) return { ok: false, message: 'Sign in first.' };

  if (stars === null) {
    const { error } = await supabase.from('supplier_ratings').delete().eq('buyer_id', user.id).eq('supplier_id', supplierId);
    if (error) return { ok: false, message: friendlyError(error.message) };
  } else {
    const value = parseStars(stars);
    if (!value) return { ok: false, message: 'Choose 1 to 5 stars.' };
    const { error } = await supabase.from('supplier_ratings')
      .upsert({ buyer_id: user.id, supplier_id: supplierId, stars: value }, { onConflict: 'buyer_id,supplier_id' });
    if (error) {
      return { ok: false, message: /row-level security/i.test(error.message)
        ? 'You can rate a supplier once one of your orders from them has been released.' : friendlyError(error.message) };
    }
  }
  revalidatePath('/dashboard/following');
  revalidatePath(`/dashboard/users/${supplierId}`);
  return { ok: true, message: stars === null ? 'Rating removed.' : 'Thanks, your rating is saved.' };
}
