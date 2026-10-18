import { NextResponse } from 'next/server';
import { getSessionProfile } from '@/lib/supabase/server';
import { createCheckout } from '@/lib/payments/checkout';
import { friendlyError } from '@/lib/format';
import { UUID_RE } from '@/lib/uploads';

/**
 * POST /api/orders/:id/checkout — start a Bank Card payment (Paystack) for an unpaid order.
 * Body: { billingName } → { card: { reference, accessCode, authorizationUrl, amountMinor, currency } }
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid order' }, { status: 400 });

  const { supabase, user, profile } = await getSessionProfile();
  if (!user || !profile) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  // RLS: buyers only see their own orders.
  const { data: order } = await supabase
    .from('orders').select('id, escrow_status, product:products ( title )').eq('id', id).maybeSingle();
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  if (order.escrow_status !== 'pending_payment') return NextResponse.json({ error: 'This order is already paid' }, { status: 409 });
  if (profile.role !== 'importer') return NextResponse.json({ error: 'Importer account required' }, { status: 403 });

  const body = await request.json().catch(() => null) as { billingName?: unknown } | null;
  const billingName = typeof body?.billingName === 'string' ? body.billingName.trim().slice(0, 120) : '';
  if (billingName.length < 2) return NextResponse.json({ error: 'Enter the name on your card' }, { status: 400 });

  try {
    const product = (Array.isArray(order.product) ? order.product[0] : order.product) as { title: string } | null;
    const card = await createCheckout({ kind: 'order', orderId: id, productTitle: product?.title ?? 'Trial Batch' }, user, profile, { billingName });
    return NextResponse.json({ card });
  } catch (err) {
    console.error('[orders] card checkout failed', { id, err });
    return NextResponse.json({ error: friendlyError(err instanceof Error ? err.message : undefined) }, { status: 502 });
  }
}
