import { NextResponse } from 'next/server';
import { getSessionProfile } from '@/lib/supabase/server';
import { createPurchaseCheckout } from '@/lib/payments/checkout';
import { friendlyError } from '@/lib/format';
import { UUID_RE } from '@/lib/uploads';
import { checkCanTransact } from '@/lib/platform-server';
import { parseAddons } from '@/lib/pricing';

/**
 * POST /api/rfqs/:id/addons — start a Bank Card payment for RFQ add-ons on the buyer's own open request.
 * Body: { billingName, addons: ['featured' | 'white_glove'] } → { card }. Prices come from platform_settings
 * in Postgres (begin_card_purchase); the request is featured / flagged once the verified charge settles.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const { supabase, user, profile } = await getSessionProfile();
  if (!user || !profile) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  if (profile.role !== 'importer') return NextResponse.json({ error: 'Importer account required' }, { status: 403 });

  // RLS: the buyer sees their own requests.
  const { data: rfq } = await supabase.from('rfqs').select('id, title, buyer_id').eq('id', id).eq('buyer_id', user.id).maybeSingle();
  if (!rfq) return NextResponse.json({ error: 'Request not found' }, { status: 404 });
  const blocked = await checkCanTransact(supabase, user.id, 'checkout');
  if (blocked) return NextResponse.json({ error: blocked.error }, { status: blocked.status });

  const body = await request.json().catch(() => null) as { billingName?: unknown; addons?: unknown } | null;
  const billingName = typeof body?.billingName === 'string' ? body.billingName.trim().slice(0, 120) : '';
  if (billingName.length < 2) return NextResponse.json({ error: 'Enter the name on your card' }, { status: 400 });
  const addons = parseAddons(body?.addons);
  if (!addons.length) return NextResponse.json({ error: 'Choose at least one add-on' }, { status: 400 });

  try {
    const card = await createPurchaseCheckout({ kind: 'rfq_addon', rfqId: id, rfqTitle: rfq.title as string, addons }, user, profile, { billingName });
    return NextResponse.json({ card });
  } catch (err) {
    console.error('[rfqs] add-on checkout failed', { id, err });
    return NextResponse.json({ error: friendlyError(err instanceof Error ? err.message : undefined) }, { status: 502 });
  }
}
