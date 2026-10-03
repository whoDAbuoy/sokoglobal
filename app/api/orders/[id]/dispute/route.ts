import { NextResponse } from 'next/server';
import { getSessionProfile } from '@/lib/supabase/server';
import { friendlyError } from '@/lib/format';
import { UUID_RE } from '@/lib/uploads';

const REASONS = {
  not_received: 'Goods not received',
  not_as_described: 'Goods not as described',
  damaged: 'Damaged in transit',
  wrong_quantity: 'Wrong quantity or sizes/shades',
  counterfeit: 'Suspected counterfeit',
  other: 'Other',
} as const;
export type DisputeReason = keyof typeof REASONS;

/**
 * POST /api/orders/:id/dispute — freeze escrow and open a support case.
 * Body: { reason: DisputeReason, details: string (30–2000 chars) }
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid order' }, { status: 400 });

  const { supabase, user } = await getSessionProfile();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const body = await request.json().catch(() => null) as { reason?: string; details?: string } | null;
  const reason = body?.reason as DisputeReason | undefined;
  const details = (body?.details ?? '').trim();
  if (!reason || !(reason in REASONS)) return NextResponse.json({ error: 'Choose a reason' }, { status: 400 });
  if (details.length < 30 || details.length > 2000) {
    return NextResponse.json({ error: 'Describe the problem in 30–2000 characters' }, { status: 400 });
  }

  // Freezes funds (state-checked in Postgres; only the buyer can do this).
  const { error } = await supabase.rpc('open_dispute', { p_order_id: id, p_reason: `${REASONS[reason]}: ${details}` });
  if (error) return NextResponse.json({ error: friendlyError(error.message) }, { status: 409 });

  // Open a support case linked to the order so an agent picks it up.
  const { data: ticket, error: ticketError } = await supabase
    .from('support_tickets')
    .insert({ user_id: user.id, order_id: id, category: 'dispute', subject: `Dispute: ${REASONS[reason]}` })
    .select('id')
    .single();
  if (!ticketError && ticket) {
    await supabase.from('support_messages').insert({ ticket_id: ticket.id, body: details });
  } else {
    console.error('[dispute] escrow frozen but ticket not created', { id, ticketError });
  }

  return NextResponse.json({ ok: true, ticketId: ticket?.id ?? null }, { status: 201 });
}
