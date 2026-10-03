import { NextResponse } from 'next/server';
import { getSessionProfile } from '@/lib/supabase/server';
import { createCheckout } from '@/lib/payments/checkout';
import { friendlyError } from '@/lib/format';
import { UUID_RE } from '@/lib/uploads';

/**
 * POST /api/orders — start a $500 Trial Batch and open escrow checkout.
 * Body: { productId }
 * → 201 { order, paymentLink }   (redirect the browser to paymentLink)
 *
 * The price is never taken from the client: create_trial_order() copies the
 * Guaranteed Landed Cost from the product row, and begin_payment_attempt()
 * reads the amount back from the order.
 */
export async function POST(request: Request) {
  const { supabase, user, profile } = await getSessionProfile();
  if (!user || !profile) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  if (profile.role !== 'importer') return NextResponse.json({ error: 'Importer account required' }, { status: 403 });

  const body = await request.json().catch(() => null) as { productId?: string } | null;
  if (!body?.productId || !UUID_RE.test(body.productId)) return NextResponse.json({ error: 'Invalid product' }, { status: 400 });

  const { data: order, error } = await supabase.rpc('create_trial_order', { p_product_id: body.productId });
  if (error) return NextResponse.json({ error: friendlyError(error.message) }, { status: 400 });

  const { data: product } = await supabase.from('products').select('title').eq('id', body.productId).single();

  try {
    const paymentLink = await createCheckout({ kind: 'order', orderId: order.id, productTitle: product?.title ?? 'Trial Batch' }, user, profile);
    return NextResponse.json({ order, paymentLink }, { status: 201 });
  } catch (err) {
    // The order exists and stays pending_payment; the buyer can retry from the order page.
    console.error('[orders] checkout link failed', { orderId: order.id, err });
    return NextResponse.json({
      order, paymentLink: null,
      error: 'Your order is saved, but we could not open the payment page. Retry from your order.',
    }, { status: 201 });
  }
}
