import { NextResponse } from 'next/server';
import { getSessionProfile } from '@/lib/supabase/server';
import { UUID_RE } from '@/lib/uploads';
import { invoiceAvailable, invoiceModel, type InvoiceInput } from '@/lib/documents/model';
import { pdfResponse, renderDocument } from '@/lib/documents/pdf';
import type { EscrowStatus } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

/**
 * GET /api/orders/:id/invoice — commercial invoice PDF for the buyer (or an admin).
 * Read with the signed-in user's client, so RLS decides who can see the order;
 * the explicit owner/admin check below is a second line of defence.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { supabase, user, profile } = await getSessionProfile();
  if (!user || !profile) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });

  const { data: order } = await supabase.from('orders')
    .select(`id, buyer_id, escrow_status, created_at, funded_at, released_at, quantity, goods_cents, freight_cents, customs_cents, total_cents,
             payment_provider, payment_ref, origin_label, destination_label,
             product:products ( title, brand, category, origin_country, supplier:profiles!products_supplier_id_fkey ( company_name, country_code ) ),
             buyer:profiles!orders_buyer_id_fkey ( company_name, full_name, country_code )`)
    .eq('id', id).maybeSingle();
  if (!order || (order.buyer_id !== user.id && profile.role !== 'admin')) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!invoiceAvailable(order.escrow_status as EscrowStatus)) {
    return NextResponse.json({ error: 'The invoice is available once the shipment has cleared customs.' }, { status: 409 });
  }

  const product = one(order.product as unknown as (InvoiceInput['product'] & { supplier: unknown }) | null);
  const input: InvoiceInput = {
    ...order, escrow_status: order.escrow_status as EscrowStatus,
    product: product ? { title: product.title, brand: product.brand, category: product.category, origin_country: product.origin_country } : null,
    supplier: one(product?.supplier as InvoiceInput['supplier']),
    buyer: one(order.buyer as unknown as InvoiceInput['buyer']),
  };
  const model = invoiceModel(input);
  const bytes = await renderDocument(model, { subject: `Order ${order.id}` });
  return pdfResponse(bytes, `${model.number}.pdf`);
}
