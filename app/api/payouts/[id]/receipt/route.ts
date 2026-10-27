import { NextResponse } from 'next/server';
import { getSessionProfile } from '@/lib/supabase/server';
import { UUID_RE } from '@/lib/uploads';
import { payoutReceiptModel, receiptAvailable, type PayoutInput } from '@/lib/documents/model';
import { pdfResponse, renderDocument } from '@/lib/documents/pdf';
import { isAdmin } from '@/lib/auth/admin-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

/** GET /api/payouts/:id/receipt — payout receipt PDF for the supplier (or an admin). RLS-scoped read. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { supabase, user, profile } = await getSessionProfile();
  if (!user || !profile) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });

  const { data: p } = await supabase.from('payouts')
    .select(`id, order_id, supplier_id, reference, status, gross_cents, fee_cents, early, early_payout_fee_cents, amount_cents, currency, payout_currency, payout_amount,
             created_at, completed_at, flw_transfer_id,
             supplier:supplier_profiles!payouts_supplier_id_fkey ( company_name, country_code ),
             order:orders ( product:products ( title ) )`)
    .eq('id', id).maybeSingle();
  if (!p || (p.supplier_id !== user.id && !isAdmin(profile))) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!receiptAvailable(p.status)) return NextResponse.json({ error: 'A receipt is available once the payout has completed.' }, { status: 409 });

  const order = one(p.order as unknown as { product: unknown } | null);
  const input: PayoutInput = {
    ...p, supplier: one(p.supplier as unknown as PayoutInput['supplier']),
    product_title: one(order?.product as { title: string } | null)?.title ?? null,
  };
  const model = payoutReceiptModel(input);
  return pdfResponse(await renderDocument(model, { subject: `Payout ${p.reference}` }), `${model.number}.pdf`);
}
