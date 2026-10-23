import { NextResponse } from 'next/server';
import { getSessionProfile } from '@/lib/supabase/server';
import { UUID_RE } from '@/lib/uploads';
import { checkCanTransact } from '@/lib/platform-server';
import { paymentStep, type PayableOrder } from '@/lib/milestone';
import { startGatewayFromRequest } from '@/lib/payments/gateway-route';
import { latestAirtelPayment } from '@/lib/payments/gateways';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/orders/:id/gateway — pay what is due on an order (full total, milestone deposit, or the balance
 * once dispatched) with DPO Pay, PayPal or Airtel Money. Postgres picks the amount (begin_gateway_payment).
 * Body: { gateway, phone? } → { redirectUrl } | { paymentId, amount, currency }
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid order' }, { status: 400 });
  const { supabase, user, profile } = await getSessionProfile();
  if (!user || !profile) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  if (profile.role !== 'importer') return NextResponse.json({ error: 'Importer account required' }, { status: 403 });

  // RLS: buyers only see their own orders.
  const { data: order } = await supabase.from('orders')
    .select('id, escrow_status, total_cents, payment_structure, deposit_amount, remaining_balance, final_paid_at, current_status, product:products ( title )')
    .eq('id', id).maybeSingle();
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  const step = paymentStep(order as PayableOrder);
  if (step.kind === 'balance_waiting') return NextResponse.json({ error: 'The balance becomes payable once the supplier dispatches your order' }, { status: 409 });
  if (step.kind === 'none') return NextResponse.json({ error: 'This order is already paid' }, { status: 409 });
  const blocked = await checkCanTransact(supabase, user.id, 'checkout');
  if (blocked) return NextResponse.json({ error: blocked.error }, { status: blocked.status });

  const product = (Array.isArray(order.product) ? order.product[0] : order.product) as { title: string } | null;
  return startGatewayFromRequest(request, { kind: 'order', id, title: product?.title ?? 'Trial Batch' }, user, profile);
}

/** GET /api/orders/:id/gateway — status of the latest Airtel Money prompt (polled by the order page). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid order' }, { status: 400 });
  const { supabase, user } = await getSessionProfile();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const { data: order } = await supabase.from('orders').select('id').eq('id', id).eq('buyer_id', user.id).maybeSingle();
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  return NextResponse.json({ payment: await latestAirtelPayment({ kind: 'order', id }) });
}
