'use server';

import { revalidatePath } from 'next/cache';
import { getSessionProfile } from '@/lib/supabase/server';
import { friendlyError } from '@/lib/format';
import { validateProfileChange } from '@/lib/user-admin';

export type ProfileChangeState = { ok: boolean; message: string } | null;

/** File a profile change for admin approval (the live profile is not touched until it is approved). */
export async function requestProfileChange(_prev: ProfileChangeState, form: FormData): Promise<ProfileChangeState> {
  const { supabase, user, profile } = await getSessionProfile();
  if (!user || !profile) return { ok: false, message: 'Sign in first.' };
  const v = validateProfileChange({
    full_name: String(form.get('full_name') ?? ''),
    company_name: String(form.get('company_name') ?? ''),
    note: String(form.get('note') ?? ''),
  }, profile);
  if (!v.ok) return { ok: false, message: v.error };
  const { error } = await supabase.rpc('submit_profile_change', { p_full_name: v.full_name, p_company_name: v.company_name, p_note: v.note });
  if (error) return { ok: false, message: friendlyError(error.message) };
  revalidatePath('/dashboard/profile');
  return { ok: true, message: 'Sent for review. Your profile updates once an admin approves it.' };
}

export async function cancelProfileChange(): Promise<void> {
  const { supabase, user } = await getSessionProfile();
  if (!user) return;
  await supabase.rpc('cancel_profile_change');
  revalidatePath('/dashboard/profile');
}
