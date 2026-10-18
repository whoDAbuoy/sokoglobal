import { NextResponse } from 'next/server';
import { createCheckout } from '@/lib/payments/checkout';
import { loadCheckoutGroup, unpaidOrders } from '@/lib/payments/checkout-group';
import { friendlyError } from '@/lib/format';
import { UUID_RE } from '@/lib/uploads';

/** POST /api/checkout/:id/card — Flutterwave hosted checkout for every unpaid order in the cart (tx_ref grp_<id>). */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid checkout' }, { status: 400 });

  const { user, profile, group } = await loadCheckoutGroup(id);
  if (!user || !profile) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  if (profile.role !== 'importer') return NextResponse.json({ error: 'Importer account required' }, { status: 403 });
  if (!group) return NextResponse.json({ error: 'Checkout not found' }, { status: 404 });
  const unpaid = unpaidOrders(group);
  if (unpaid.length === 0) return NextResponse.json({ error: 'This checkout is already paid' }, { status: 409 });

  try {
    const paymentLink = await createCheckout({ kind: 'group', groupId: id, itemCount: unpaid.length }, user, profile);
    return NextResponse.json({ paymentLink });
  } catch (err) {
    console.error('[checkout] card link failed', { id, err });
    return NextResponse.json({ error: friendlyError(err instanceof Error ? err.message : undefined) }, { status: 502 });
  }
}
