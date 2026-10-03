import { NextResponse } from 'next/server';
import { getSessionProfile } from '@/lib/supabase/server';
import { createCheckout } from '@/lib/payments/checkout';
import { friendlyError } from '@/lib/format';
import { UUID_RE } from '@/lib/uploads';

/**
 * POST /api/pools/:id/join — pledge to a Trend Pool and open escrow checkout.
 * Body: { amountCents }   → 201 { membership, paymentLink }
 *
 * If the buyer already pledged but never paid (abandoned checkout), this
 * returns a fresh payment link for the existing pledge instead of erroring.
 * Funds are refunded automatically if the pool expires unfunded
 * (app/api/cron/expire-pools).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid pool' }, { status: 400 });

  const { supabase, user, profile } = await getSessionProfile();
  if (!user || !profile) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  if (profile.role !== 'importer') return NextResponse.json({ error: 'Importer account required' }, { status: 403 });

  const [{ data: pool }, { data: existing }] = await Promise.all([
    supabase.from('trend_pools').select('id, title').eq('id', id).maybeSingle(),
    supabase.from('pool_members').select('pool_id, contribution_cents, payment_status').eq('pool_id', id).eq('buyer_id', user.id).maybeSingle(),
  ]);
  if (!pool) return NextResponse.json({ error: 'Pool not found' }, { status: 404 });

  let membership = existing;
  if (existing && existing.payment_status !== 'pending_payment') {
    return NextResponse.json({ error: 'You have already paid into this pool' }, { status: 409 });
  }
  if (!existing) {
    const body = await request.json().catch(() => null) as { amountCents?: number } | null;
    const amount = body?.amountCents;
    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
      return NextResponse.json({ error: 'Enter a valid amount' }, { status: 400 });
    }
    const { data, error } = await supabase.rpc('join_trend_pool', { p_pool_id: id, p_amount_cents: amount });
    if (error) return NextResponse.json({ error: friendlyError(error.message) }, { status: 400 });
    membership = data;
  }

  try {
    const paymentLink = await createCheckout({ kind: 'pool', poolId: id, poolTitle: pool.title }, user, profile);
    return NextResponse.json({ membership, paymentLink }, { status: 201 });
  } catch (err) {
    console.error('[pools] checkout link failed', { id, err });
    return NextResponse.json({
      membership, paymentLink: null,
      error: 'Your pledge is saved, but we could not open the payment page. Click “Complete payment” to retry.',
    }, { status: 201 });
  }
}
