import { NextResponse } from 'next/server';
import { getSessionProfile } from '@/lib/supabase/server';
import { UUID_RE } from '@/lib/uploads';
import { wireInstructionsModel, type WireInput } from '@/lib/documents/model';
import { pdfResponse, renderDocument } from '@/lib/documents/pdf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

/**
 * GET /api/orders/:id/wire-invoice — SWIFT payment instructions (PDF) for the buyer's open wire transfer:
 * escrow bank details, the unique reference and the amount, as frozen by begin_manual_payment().
 * Read with the buyer's own client, so RLS decides what is visible.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { supabase, user } = await getSessionProfile();
  if (!user) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });

  const [{ data: wire }, { data: order }] = await Promise.all([
    supabase.from('manual_payments').select('reference, usd_cents, leg, created_at, pay_to')
      .eq('order_id', id).eq('buyer_id', user.id).eq('method', 'swift_wire').in('status', ['awaiting', 'submitted'])
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('orders').select('id, product:products ( title ), buyer:profiles!orders_buyer_id_fkey ( company_name, full_name, country_code )')
      .eq('id', id).eq('buyer_id', user.id).maybeSingle(),
  ]);
  if (!wire || !order) return NextResponse.json({ error: 'Start a bank wire on the order page first.' }, { status: 404 });

  const model = wireInstructionsModel({
    ...wire, pay_to: (wire.pay_to ?? {}) as WireInput['pay_to'],
    order: { id: order.id as string, product_title: one(order.product as unknown as { title: string } | null)?.title ?? null },
    buyer: one(order.buyer as unknown as WireInput['buyer']),
  });
  return pdfResponse(await renderDocument(model, { subject: `Wire instructions ${wire.reference}` }), `${wire.reference}.pdf`);
}
