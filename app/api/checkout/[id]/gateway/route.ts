import { NextResponse } from 'next/server';
import { loadCheckoutGroup, unpaidOrders } from '@/lib/payments/checkout-group';
import { UUID_RE } from '@/lib/uploads';
import { checkCanTransact } from '@/lib/platform-server';
import { startGatewayFromRequest } from '@/lib/payments/gateway-route';
import { latestAirtelPayment } from '@/lib/payments/gateways';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/checkout/:id/gateway — one DPO Pay / PayPal / Airtel Money payment for every unpaid order in a cart.
 * Body: { gateway, phone? } → { redirectUrl } | { paymentId, amount, currency }
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid checkout' }, { status: 400 });
  const { supabase, user, profile, group } = await loadCheckoutGroup(id);
  if (!user || !profile) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  if (profile.role !== 'importer') return NextResponse.json({ error: 'Importer account required' }, { status: 403 });
  const blocked = await checkCanTransact(supabase, user.id, 'checkout');
  if (blocked) return NextResponse.json({ error: blocked.error }, { status: blocked.status });
  if (!group) return NextResponse.json({ error: 'Checkout not found' }, { status: 404 });
  const unpaid = unpaidOrders(group);
  if (unpaid.length === 0) return NextResponse.json({ error: 'This checkout is already paid' }, { status: 409 });
  return startGatewayFromRequest(request, { kind: 'group', id, itemCount: unpaid.length }, user, profile);
}

/** GET /api/checkout/:id/gateway — status of the latest Airtel Money prompt for the cart. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid checkout' }, { status: 400 });
  const { user, group } = await loadCheckoutGroup(id);
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  if (!group) return NextResponse.json({ error: 'Checkout not found' }, { status: 404 });
  return NextResponse.json({ payment: await latestAirtelPayment({ kind: 'group', id }) });
}
