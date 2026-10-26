'use server';

import { revalidatePath } from 'next/cache';
import { getSessionProfile } from '@/lib/supabase/server';
import { friendlyError } from '@/lib/format';
import { UUID_RE } from '@/lib/uploads';

export type FollowResult = { ok: true; following: boolean } | { ok: false; following: boolean; message: string };

/**
 * Follow or unfollow a supplier with the user's own session: RLS (migration 030) only lets
 * you write your own rows and only follow active supplier accounts. Both directions are
 * idempotent, so a double tap or a retry lands in the requested state.
 */
export async function setFollow(supplierId: string, follow: boolean): Promise<FollowResult> {
  const { supabase, user } = await getSessionProfile();
  if (!user) return { ok: false, following: !follow, message: 'Sign in to follow suppliers.' };
  if (!UUID_RE.test(supplierId)) return { ok: false, following: !follow, message: 'Invalid supplier.' };
  if (supplierId === user.id) return { ok: false, following: false, message: 'You can’t follow your own account.' };

  const { error } = follow
    ? await supabase.from('follows').upsert({ follower_id: user.id, following_id: supplierId }, { onConflict: 'follower_id,following_id', ignoreDuplicates: true })
    : await supabase.from('follows').delete().eq('follower_id', user.id).eq('following_id', supplierId);
  if (error) {
    const blocked = /row-level security/i.test(error.message);
    return { ok: false, following: !follow, message: blocked ? 'This supplier can’t be followed.' : friendlyError(error.message) };
  }
  revalidatePath(`/dashboard/suppliers/${supplierId}`);
  revalidatePath(`/dashboard/users/${supplierId}`);   // follower count on the public profile
  revalidatePath('/dashboard');
  return { ok: true, following: follow };
}
