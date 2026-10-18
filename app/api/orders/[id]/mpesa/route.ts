import { NextResponse } from 'next/server';
import { getSessionProfile } from '@/lib/supabase/server';
import { MpesaError, describeResult, isMpesaConfigured, normalizeKenyanPhone } from '@/lib/payments/mpesa';
import { latestPayment, startMpesaPayment } from '@/lib/payments/mpesa-checkout';
import { friendlyError } from '@/lib/format';
import { UUID_RE } from '@/lib/uploads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function loadOrder(id: string) {
  const { supabase, user, profile } = await getSessionProfile();
  if (!user || !profile) return { error: NextResponse.json({ error: 'Not signed in' }, { status: 401 }) } as const;
  // RLS: buyers only see their own orders.
  const { data: order } = await supabase
    .from('orders').select('id, buyer_id, escrow_status, product:products ( title )').eq('id', id).maybeSingle();
  if (!order || order.buyer_id !== user.id) return { error: NextResponse.json({ error: 'Order not found' }, { status: 404 }) } as const;
  return { user, profile, order } as const;
}

/**
 * POST /api/orders/:id/mpesa — send an M-Pesa STK Push for an unpaid order.
 * Body: { phone } → 201 { paymentId, amountKes, customerMessage }
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid order' }, { status: 400 });
  if (!isMpesaConfigured()) return NextResponse.json({ error: 'M-Pesa payments are not available right now' }, { status: 503 });

  const ctx = await loadOrder(id);
  if ('error' in ctx) return ctx.error;
  if (ctx.profile.role !== 'importer') return NextResponse.json({ error: 'Importer account required' }, { status: 403 });
  if (ctx.order.escrow_status !== 'pending_payment') return NextResponse.json({ error: 'This order is already paid' }, { status: 409 });

  const body = await request.json().catch(() => null) as { phone?: string } | null;
  const phone = normalizeKenyanPhone(String(body?.phone ?? ''));
  if (!phone) return NextResponse.json({ error: 'Enter a Safaricom number, e.g. 0712 345 678' }, { status: 400 });

  try {
    const product = (Array.isArray(ctx.order.product) ? ctx.order.product[0] : ctx.order.product) as { title: string } | null;
    const result = await startMpesaPayment({ orderId: id, buyerId: ctx.user.id, phone, productTitle: product?.title ?? 'Trial Batch' });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : undefined;
    console.error('[mpesa] STK push failed', { id, message });
    const status = err instanceof MpesaError && err.httpStatus === 409 ? 409 : 502;
    return NextResponse.json({ error: status === 409 ? friendlyError(message) : 'Could not reach M-Pesa. Please try again.' }, { status });
  }
}

/**
 * GET /api/orders/:id/mpesa — status of the latest M-Pesa attempt (polled by
 * the order page). Pending attempts are checked with Daraja's STK Query.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid order' }, { status: 400 });

  const ctx = await loadOrder(id);
  if ('error' in ctx) return ctx.error;

  const payment = await latestPayment(id);
  if (!payment) return NextResponse.json({ payment: null });

  const status = payment.status === 'initiating' ? 'pending' : payment.status;
  return NextResponse.json({
    payment: {
      status,
      amountKes: payment.amount_kes,
      message: status === 'pending' ? null
        : status === 'review' ? 'We received your M-Pesa payment and our team is reviewing it. No need to pay again.'
        : describeResult(payment.result_code, payment.result_desc),
    },
  });
}
