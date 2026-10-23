import { NextResponse } from 'next/server';
import { getSessionProfile } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { gatewayRowByToken, settleGatewayRow } from '@/lib/payments/gateways';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/payments/gateway/confirm  Body: { gateway: 'dpo' | 'paypal', token }
 * Called by the order / checkout page when the buyer returns from DPO Pay (TransactionToken) or
 * PayPal (token = PayPal order id). The result is re-checked with the gateway server-side (PayPal is
 * captured here); the client only names the token, and only one of its own payments.
 */
export async function POST(request: Request) {
  const { user } = await getSessionProfile();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const body = await request.json().catch(() => null) as { gateway?: unknown; token?: unknown } | null;
  const gateway = body?.gateway === 'dpo' || body?.gateway === 'paypal' ? body.gateway : null;
  const token = typeof body?.token === 'string' ? body.token.trim() : '';
  if (!gateway || !/^[A-Za-z0-9-]{6,80}$/.test(token)) return NextResponse.json({ error: 'Invalid payment' }, { status: 400 });

  const db = createAdminClient();
  const row = await gatewayRowByToken(db, gateway, token);
  if (!row || row.buyer_id !== user.id) return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
  try {
    return NextResponse.json({ outcome: await settleGatewayRow(db, row) });
  } catch (err) {
    console.warn(`[${gateway}] confirm could not verify yet — webhook / cron will settle`, { reference: row.reference, err: err instanceof Error ? err.message : err });
    return NextResponse.json({ outcome: 'pending' });
  }
}
