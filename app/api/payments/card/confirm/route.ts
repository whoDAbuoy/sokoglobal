import { NextResponse } from 'next/server';
import { getSessionProfile } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { gatewayRowByReference, settleGatewayRow } from '@/lib/payments/gateways';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/payments/card/confirm  Body: { reference }
 * Called by the browser right after Paystack's card form reports success, so
 * escrow is funded without waiting for the webhook. The amount and status are
 * always re-checked with Paystack server-side; the client only names the
 * reference, and only its own.
 */
export async function POST(request: Request) {
  const { user } = await getSessionProfile();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const body = await request.json().catch(() => null) as { reference?: unknown } | null;
  const reference = typeof body?.reference === 'string' ? body.reference : '';
  if (!/^[A-Za-z0-9.=-]{8,120}$/.test(reference)) return NextResponse.json({ error: 'Invalid reference' }, { status: 400 });

  const db = createAdminClient();
  const payment = await gatewayRowByReference(db, reference);
  if (!payment || payment.buyer_id !== user.id) return NextResponse.json({ error: 'Payment not found' }, { status: 404 });

  try {
    // Paystack, or (migration 028) whichever gateway took this attempt.
    return NextResponse.json({ outcome: await settleGatewayRow(db, payment) });
  } catch (err) {
    console.warn('[card] confirm could not verify yet — webhook will settle', { reference, err: err instanceof Error ? err.message : err });
    return NextResponse.json({ outcome: 'pending' });
  }
}
