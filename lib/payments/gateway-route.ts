import 'server-only';
import { NextResponse } from 'next/server';
import type { User } from '@supabase/supabase-js';
import { friendlyError } from '@/lib/format';
import type { Profile } from '@/lib/types';
import { airtelConfig, normalizeAirtelPhone } from '@/lib/payments/airtel';
import { GATEWAY_LABEL, GatewayInputError, gatewayConfigured, isGateway, startGatewayPayment, type GatewayTarget } from '@/lib/payments/gateways';

/**
 * Shared body of POST /api/orders/:id/gateway and /api/checkout/:id/gateway (callers have
 * already checked the session, role, kill switch and that something is due).
 * Body: { gateway: 'dpo' | 'paypal' | 'airtel_money', phone? }
 *   → 200 { redirectUrl } (DPO, PayPal) or 201 { paymentId, amount, currency } (Airtel prompt sent)
 */
export async function startGatewayFromRequest(request: Request, target: GatewayTarget, user: User, profile: Profile) {
  const body = await request.json().catch(() => null) as { gateway?: unknown; phone?: unknown } | null;
  const gateway = body?.gateway;
  if (!isGateway(gateway)) return NextResponse.json({ error: 'Choose a payment method' }, { status: 400 });
  if (!gatewayConfigured(gateway)) return NextResponse.json({ error: `${GATEWAY_LABEL[gateway]} is not available right now` }, { status: 503 });

  let phone: string | null = null;
  if (gateway === 'airtel_money') {
    phone = normalizeAirtelPhone(String(body?.phone ?? ''), airtelConfig().dial);
    if (!phone) return NextResponse.json({ error: 'Enter your Airtel Money number, e.g. 0733 123 456' }, { status: 400 });
  }
  try {
    const r = await startGatewayPayment({ gateway, target, user, profile, phone });
    return r.kind === 'redirect'
      ? NextResponse.json({ redirectUrl: r.url })
      : NextResponse.json({ paymentId: r.paymentId, amount: r.amount, currency: r.currency }, { status: 201 });
  } catch (err) {
    if (err instanceof GatewayInputError) return NextResponse.json({ error: friendlyError(err.message) }, { status: 409 });
    console.error(`[${gateway}] start failed`, { target: target.id, err: err instanceof Error ? err.message : err });
    return NextResponse.json({ error: `Could not reach ${GATEWAY_LABEL[gateway]}. Please try again or choose another method.` }, { status: 502 });
  }
}
