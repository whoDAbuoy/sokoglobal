import { NextResponse } from 'next/server';
import { getSessionProfile } from '@/lib/supabase/server';
import { createCheckout } from '@/lib/payments/checkout';
import { friendlyError } from '@/lib/format';
import { UUID_RE } from '@/lib/uploads';
import { checkCanTransact } from '@/lib/platform-server';
import { paymentStep, type PayableOrder } from '@/lib/milestone';

/**
 * POST /api/orders/:id/checkout — start a Bank Card payment (Paystack) for what is due on an order:
 * the full total, a milestone deposit, or (once dispatched) the milestone balance. Postgres picks the amount.
 * Body: { billingName } → { card: { reference, accessCode, authorizationUrl, amountMinor, currency } }
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid order' }, { status: 400 });

  const { supabase, user, profile } = await getSessionProfile();
  if (!user || !profile) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  // RLS: buyers only see their own orders.
  const { data: order } = await supabase
    .from('orders').select('id, escrow_status, total_cents, payment_structure, deposit_amount, remaining_balance, final_paid_at, current_status, product:products ( title )')
    .eq('id', id).maybeSingle();
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  const step = paymentStep(order as PayableOrder);
  if (step.kind === 'balance_waiting') return NextResponse.json({ error: 'The balance becomes payable once the supplier dispatches your order' }, { status: 409 });
  if (step.kind === 'none') return NextResponse.json({ error: 'This order is already paid' }, { status: 409 });
  if (profile.role !== 'importer') return NextResponse.json({ error: 'Importer account required' }, { status: 403 });
  const blocked = await checkCanTransact(supabase, user.id, 'checkout');
  if (blocked) return NextResponse.json({ error: blocked.error }, { status: blocked.status });

  const body = await request.json().catch(() => null) as { billingName?: unknown } | null;
  const billingName = typeof body?.billingName === 'string' ? body.billingName.trim().slice(0, 120) : '';
  if (billingName.length < 2) return NextResponse.json({ error: 'Enter the name on your card' }, { status: 400 });

  try {
    const product = (Array.isArray(order.product) ? order.product[0] : order.product) as { title: string } | null;
    const leg = step.kind === 'pay_deposit' ? ' (30% deposit)' : step.kind === 'pay_balance' ? ' (70% balance)' : '';
    const card = await createCheckout({ kind: 'order', orderId: id, productTitle: `${product?.title ?? 'Trial Batch'}${leg}` }, user, profile, { billingName });
    return NextResponse.json({ card });
  } catch (err) {
    console.error('[orders] card checkout failed', { id, err });
    return NextResponse.json({ error: friendlyError(err instanceof Error ? err.message : undefined) }, { status: 502 });
  }
}
