import { NextResponse } from 'next/server';
import { MpesaError, isMpesaConfigured, mpesaLimitMessage, normalizeKenyanPhone } from '@/lib/payments/mpesa';
import { buyerPaymentView, latestPayment, startMpesaPayment } from '@/lib/payments/mpesa-checkout';
import { loadCheckoutGroup, unpaidOrders } from '@/lib/payments/checkout-group';
import { friendlyError } from '@/lib/format';
import { UUID_RE } from '@/lib/uploads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/checkout/:id/mpesa — one STK Push for every unpaid order in the cart.
 * Body: { phone } → 201 { paymentId, amountKes, customerMessage }
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid checkout' }, { status: 400 });
  if (!isMpesaConfigured()) return NextResponse.json({ error: 'M-Pesa payments are not available right now' }, { status: 503 });

  const { user, profile, group } = await loadCheckoutGroup(id);
  if (!user || !profile) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  if (profile.role !== 'importer') return NextResponse.json({ error: 'Importer account required' }, { status: 403 });
  if (!group) return NextResponse.json({ error: 'Checkout not found' }, { status: 404 });
  if (unpaidOrders(group).length === 0) return NextResponse.json({ error: 'This checkout is already paid' }, { status: 409 });

  const body = await request.json().catch(() => null) as { phone?: string } | null;
  const phone = normalizeKenyanPhone(String(body?.phone ?? ''));
  if (!phone) return NextResponse.json({ error: 'Enter a Safaricom number, e.g. 0712 345 678' }, { status: 400 });

  try {
    const result = await startMpesaPayment({ target: { kind: 'group', id }, buyerId: user.id, phone });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : undefined;
    console.error('[mpesa] cart STK push failed', { id, message });
    const status = err instanceof MpesaError && err.httpStatus === 409 ? 409 : 502;
    return NextResponse.json({ error: status === 409 ? mpesaLimitMessage(friendlyError(message)) : 'Could not reach M-Pesa. Please try again.' }, { status });
  }
}

/** GET /api/checkout/:id/mpesa — latest M-Pesa attempt for the cart (polled; pending attempts are checked with STK Query). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid checkout' }, { status: 400 });

  const { user, group } = await loadCheckoutGroup(id);
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  if (!group) return NextResponse.json({ error: 'Checkout not found' }, { status: 404 });

  const payment = await latestPayment({ kind: 'group', id });
  return NextResponse.json({ payment: payment ? buyerPaymentView(payment) : null });
}
