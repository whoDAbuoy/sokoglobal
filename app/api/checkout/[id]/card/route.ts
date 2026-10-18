import { NextResponse } from 'next/server';
import { createCheckout } from '@/lib/payments/checkout';
import { loadCheckoutGroup, unpaidOrders } from '@/lib/payments/checkout-group';
import { friendlyError } from '@/lib/format';
import { UUID_RE } from '@/lib/uploads';

/**
 * POST /api/checkout/:id/card — one Bank Card payment (Paystack) for every unpaid order in the cart.
 * Body: { billingName } → { card: { reference, accessCode, authorizationUrl, amountMinor, currency } }
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid checkout' }, { status: 400 });

  const { user, profile, group } = await loadCheckoutGroup(id);
  if (!user || !profile) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  if (profile.role !== 'importer') return NextResponse.json({ error: 'Importer account required' }, { status: 403 });
  if (!group) return NextResponse.json({ error: 'Checkout not found' }, { status: 404 });
  const unpaid = unpaidOrders(group);
  if (unpaid.length === 0) return NextResponse.json({ error: 'This checkout is already paid' }, { status: 409 });

  const body = await request.json().catch(() => null) as { billingName?: unknown } | null;
  const billingName = typeof body?.billingName === 'string' ? body.billingName.trim().slice(0, 120) : '';
  if (billingName.length < 2) return NextResponse.json({ error: 'Enter the name on your card' }, { status: 400 });

  try {
    const card = await createCheckout({ kind: 'group', groupId: id, itemCount: unpaid.length }, user, profile, { billingName });
    return NextResponse.json({ card });
  } catch (err) {
    console.error('[checkout] card link failed', { id, err });
    return NextResponse.json({ error: friendlyError(err instanceof Error ? err.message : undefined) }, { status: 502 });
  }
}
