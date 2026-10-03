'use server';

import { revalidatePath } from 'next/cache';
import { getSessionProfile } from '@/lib/supabase/server';
import { UUID_RE } from '@/lib/uploads';

async function requireAdmin() {
  const ctx = await getSessionProfile();
  return ctx.user && ctx.profile?.role === 'admin' ? ctx : null;
}

/** Agent reply. sender_id/sender_role are stamped by a DB trigger, not trusted from here. */
export async function replyToTicket(form: FormData) {
  const ctx = await requireAdmin();
  if (!ctx) return;
  const ticketId = String(form.get('ticketId') ?? '');
  const body = String(form.get('body') ?? '').trim().slice(0, 4000);
  if (!UUID_RE.test(ticketId) || !body) return;
  await ctx.supabase.from('support_messages').insert({ ticket_id: ticketId, body });
  revalidatePath('/admin/support');
}

export async function resolveTicket(form: FormData) {
  const ctx = await requireAdmin();
  if (!ctx) return;
  const ticketId = String(form.get('ticketId') ?? '');
  if (!UUID_RE.test(ticketId)) return;
  await ctx.supabase.from('support_tickets').update({ status: 'resolved' }).eq('id', ticketId);
  revalidatePath('/admin/support');
}
