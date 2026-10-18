import { NextResponse } from 'next/server';
import { getSessionProfile } from '@/lib/supabase/server';
import { friendlyError } from '@/lib/format';
import { UUID_RE } from '@/lib/uploads';
import { MAX_BATCHES_PER_LINE } from '@/lib/cart';

/**
 * POST /api/orders — start a $500 Trial Batch and open escrow checkout.
 * Body: { productId, method?: 'card' | 'mpesa', quantity?: number (Trial Batches, 1–20) }
 * → 201 { order }. Payment happens on the order page: M-Pesa STK prompt or
 *   Bank Card (Paystack secure card form).
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

  return NextResponse.json({ order }, { status: 201 });
}
