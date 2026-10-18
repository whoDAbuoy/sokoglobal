import { NextResponse } from 'next/server';
import { getSessionProfile } from '@/lib/supabase/server';
import { createCheckout } from '@/lib/payments/checkout';
import { friendlyError } from '@/lib/format';
import { UUID_RE } from '@/lib/uploads';
import { MAX_BATCHES_PER_LINE } from '@/lib/cart';

/**
 * POST /api/orders — start a $500 Trial Batch and open escrow checkout.
 * Body: { productId, method?: 'card' | 'mpesa', quantity?: number (Trial Batches, 1–20) }
 * → 201 { order, paymentLink }   (redirect the browser to paymentLink;
 *   for M-Pesa paymentLink is null and the order page sends the STK prompt)
 *
 * The price is never taken from the client: create_trial_order() copies the
 * Guaranteed Landed Cost from the product row, and begin_payment_attempt()
 * reads the amount back from the order.
 */
export async function POST(request: Request) {
  const { supabase, user, profile } = await getSessionProfile();
  if (!user || !profile) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  if (profile.role !== 'importer') return NextResponse.json({ error: 'Importer account required' }, { status: 403 });

  const body = await request.json().catch(() => null) as { productId?: string; method?: string; quantity?: unknown } | null;
  if (!body?.productId || !UUID_RE.test(body.productId)) return NextResponse.json({ error: 'Invalid product' }, { status: 400 });
  const quantity = body.quantity === undefined ? 1 : Number(body.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_BATCHES_PER_LINE) {
    return NextResponse.json({ error: `Quantity must be between 1 and ${MAX_BATCHES_PER_LINE} Trial Batches` }, { status: 400 });
  }

  // Several batches → one order with everything multiplied (migration 010). Price always computed in Postgres.
  const { data: order, error } = quantity === 1
    ? await supabase.rpc('create_trial_order', { p_product_id: body.productId })
    : await supabase.rpc('create_trial_order', { p_product_id: body.productId, p_batches: quantity });
  if (error) return NextResponse.json({ error: friendlyError(error.message) }, { status: 400 });

  // M-Pesa: the STK prompt is sent from the order page once the buyer enters their number.
  if (body.method === 'mpesa') return NextResponse.json({ order, paymentLink: null }, { status: 201 });

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
