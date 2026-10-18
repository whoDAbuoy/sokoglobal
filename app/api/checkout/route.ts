import { NextResponse } from 'next/server';
import { getSessionProfile } from '@/lib/supabase/server';
import { friendlyError } from '@/lib/format';
import { UUID_RE } from '@/lib/uploads';

const MAX_ITEMS = 10;   // mirrors create_cart_checkout()

/**
 * POST /api/checkout — turn the cart into one escrow order per Trial Batch,
 * grouped for a single payment.
 * Body: { productIds: string[] } → 201 { checkout: { id } }
 *
 * Prices are never taken from the client: create_cart_checkout() copies each
 * product's Guaranteed Landed Cost server-side. Payment happens on
 * /dashboard/checkout/:id (M-Pesa or card).
 */
export async function POST(request: Request) {
  const { supabase, user, profile } = await getSessionProfile();
  if (!user || !profile) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  if (profile.role !== 'importer') return NextResponse.json({ error: 'Importer account required' }, { status: 403 });

  const body = await request.json().catch(() => null) as { productIds?: unknown } | null;
  const ids = Array.isArray(body?.productIds) ? [...new Set(body.productIds.map(String))] : [];
  if (ids.length === 0) return NextResponse.json({ error: 'Your cart is empty' }, { status: 400 });
  if (ids.length > MAX_ITEMS) return NextResponse.json({ error: `A cart can hold at most ${MAX_ITEMS} Trial Batches` }, { status: 400 });
  if (!ids.every((id) => UUID_RE.test(id))) return NextResponse.json({ error: 'Invalid product in cart' }, { status: 400 });

  const { data, error } = await supabase.rpc('create_cart_checkout', { p_product_ids: ids });
  if (error) return NextResponse.json({ error: friendlyError(error.message) }, { status: 400 });
  return NextResponse.json({ checkout: { id: (data as { id: string }).id } }, { status: 201 });
}
