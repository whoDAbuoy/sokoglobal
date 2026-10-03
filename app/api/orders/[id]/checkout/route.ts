import { NextResponse } from 'next/server';
import { getSessionProfile } from '@/lib/supabase/server';
import { createCheckout } from '@/lib/payments/checkout';
import { friendlyError } from '@/lib/format';
import { UUID_RE } from '@/lib/uploads';

/** POST /api/orders/:id/checkout — new payment link for an unpaid order (abandoned/failed checkout). */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid order' }, { status: 400 });

  const { supabase, user, profile } = await getSessionProfile();
  if (!user || !profile) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  // RLS: buyers only see their own orders.
  const { data: order } = await supabase
    .from('orders').select('id, escrow_status, product:products ( title )').eq('id', id).maybeSingle();
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  if (order.escrow_status !== 'pending_payment') return NextResponse.json({ error: 'This order is already paid' }, { status: 409 });

  try {
    const product = (Array.isArray(order.product) ? order.product[0] : order.product) as { title: string } | null;
    const paymentLink = await createCheckout({ kind: 'order', orderId: id, productTitle: product?.title ?? 'Trial Batch' }, user, profile);
    return NextResponse.json({ paymentLink });
  } catch (err) {
    console.error('[orders] checkout retry failed', { id, err });
    return NextResponse.json({ error: friendlyError(err instanceof Error ? err.message : undefined) }, { status: 502 });
  }
}
