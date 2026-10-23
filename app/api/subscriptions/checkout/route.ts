import { NextResponse } from 'next/server';
import { getSessionProfile } from '@/lib/supabase/server';
import { createPurchaseCheckout } from '@/lib/payments/checkout';
import { friendlyError } from '@/lib/format';
import { checkCanTransact } from '@/lib/platform-server';

/**
 * POST /api/subscriptions/checkout — start a Bank Card payment for one month of Gold Supplier.
 * Body: { billingName } → { card }. The price comes from platform_settings in Postgres (begin_card_purchase);
 * the month starts when the verified charge settles (apply_card_payment).
 */
export async function POST(request: Request) {
  const { supabase, user, profile } = await getSessionProfile();
  if (!user || !profile) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  if (profile.role !== 'supplier') return NextResponse.json({ error: 'Gold Supplier is available to supplier accounts' }, { status: 403 });
  const blocked = await checkCanTransact(supabase, user.id, 'checkout');
  if (blocked) return NextResponse.json({ error: blocked.error }, { status: blocked.status });

  const body = await request.json().catch(() => null) as { billingName?: unknown } | null;
  const billingName = typeof body?.billingName === 'string' ? body.billingName.trim().slice(0, 120) : '';
  if (billingName.length < 2) return NextResponse.json({ error: 'Enter the name on your card' }, { status: 400 });

  try {
    const card = await createPurchaseCheckout({ kind: 'subscription' }, user, profile, { billingName });
    return NextResponse.json({ card });
  } catch (err) {
    console.error('[subscriptions] card checkout failed', { user: user.id, err });
    return NextResponse.json({ error: friendlyError(err instanceof Error ? err.message : undefined) }, { status: 502 });
  }
}
