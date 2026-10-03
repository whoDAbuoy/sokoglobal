import { NextResponse } from 'next/server';
import { getSessionProfile } from '@/lib/supabase/server';
import { processPayout } from '@/lib/payments/payouts';
import { friendlyError } from '@/lib/format';
import { UUID_RE } from '@/lib/uploads';

/**
 * POST /api/orders/:id/confirm — buyer verifies goods at the doorstep.
 *
 * 1. confirm_delivery()  (buyer's session; RLS + state check in Postgres)
 *    delivered_pending_verification → released
 * 2. processPayout()     (service role) → Flutterwave transfer to the
 *    supplier's verified payout account (number decrypted from Supabase
 *    Vault). USD accounts are paid in USD; KES/NGN/GHS/EUR/… accounts are
 *    quoted via GET /transfers/rates and paid in local currency, never
 *    debiting more than the supplier's USD net. Transfer id is written to
 *    payouts + escrow_events.
 *
 * A payout problem never undoes the buyer's confirmation: holds and failures
 * are recorded and retried by /api/cron/retry-payouts.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid order' }, { status: 400 });

  const { supabase, user } = await getSessionProfile();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { data: order, error } = await supabase.rpc('confirm_delivery', { p_order_id: id });
  if (error) return NextResponse.json({ error: friendlyError(error.message) }, { status: 409 });

  let payout: 'initiated' | 'scheduled' = 'scheduled';
  try {
    const result = await processPayout(id);
    if (result.action === 'initiated' || result.action === 'skip') payout = 'initiated';
    if (result.action !== 'initiated') console.warn('[confirm] payout not initiated', { orderId: id, result });
  } catch (err) {
    console.error('[confirm] payout error — will be retried by cron', { orderId: id, err });
  }

  // Buyers don't see supplier banking details or payout internals.
  return NextResponse.json({ order, payout });
}
