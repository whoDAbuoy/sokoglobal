import { NextResponse } from 'next/server';
import { getSessionProfile } from '@/lib/supabase/server';
import { friendlyError } from '@/lib/format';
import { UUID_RE } from '@/lib/uploads';
import { MAX_BATCHES_PER_LINE, MAX_CART_LINES as MAX_ITEMS } from '@/lib/cart';

/**
 * POST /api/checkout — turn the cart into one escrow order per product (quantity = Trial Batches),
 * grouped for a single payment.
 * Body: { items: { productId, quantity }[] } (or legacy { productIds }) → 201 { checkout: { id } }
 *
 * Prices are never taken from the client: create_cart_checkout() copies each
 * product's Guaranteed Landed Cost server-side. Payment happens on
 * /dashboard/checkout/:id (M-Pesa or card).
 */
export async function POST(request: Request) {
  const { supabase, user, profile } = await getSessionProfile();
  if (!user || !profile) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  if (profile.role !== 'importer') return NextResponse.json({ error: 'Importer account required' }, { status: 403 });

  const body = await request.json().catch(() => null) as { items?: unknown; productIds?: unknown } | null;
  const raw: { productId: string; quantity: number }[] = Array.isArray(body?.items)
    ? body.items.map((i) => ({ productId: String((i as { productId?: unknown })?.productId ?? ''), quantity: Number((i as { quantity?: unknown })?.quantity ?? 1) }))
    : Array.isArray(body?.productIds) ? body.productIds.map((id) => ({ productId: String(id), quantity: 1 })) : [];
  // Same product twice → one line with the quantities added.
  const lines = new Map<string, number>();
  for (const { productId, quantity } of raw) lines.set(productId, (lines.get(productId) ?? 0) + quantity);
  const ids = [...lines.keys()];
  const quantities = [...lines.values()];

  if (ids.length === 0) return NextResponse.json({ error: 'Your cart is empty' }, { status: 400 });
  if (ids.length > MAX_ITEMS) return NextResponse.json({ error: `A cart can hold at most ${MAX_ITEMS} products` }, { status: 400 });
  if (!ids.every((id) => UUID_RE.test(id))) return NextResponse.json({ error: 'Invalid product in cart' }, { status: 400 });
  if (!quantities.every((q) => Number.isInteger(q) && q >= 1 && q <= MAX_BATCHES_PER_LINE)) {
    return NextResponse.json({ error: `Each quantity must be between 1 and ${MAX_BATCHES_PER_LINE} Trial Batches` }, { status: 400 });
  }

  // All single batches → the original function (works before migration 010); otherwise the quantity overload.
  const { data, error } = quantities.every((q) => q === 1)
    ? await supabase.rpc('create_cart_checkout', { p_product_ids: ids })
    : await supabase.rpc('create_cart_checkout', { p_product_ids: ids, p_quantities: quantities });
  if (error) return NextResponse.json({ error: friendlyError(error.message) }, { status: 400 });
  return NextResponse.json({ checkout: { id: (data as { id: string }).id } }, { status: 201 });
}
