// Run: npx tsx --conditions=react-server --test lib/documents/pdf.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { renderDocument } from './pdf.ts';
import { invoiceModel } from './model.ts';

test('renders a one-page A4 PDF, even with non-Latin names', async () => {
  const model = invoiceModel({
    id: '1234abcd-0000-4000-8000-000000000000', escrow_status: 'released', created_at: '2026-10-01T09:00:00Z', funded_at: '2026-10-01T10:00:00Z',
    quantity: 10, goods_cents: 30_000, freight_cents: 12_000, customs_cents: 8_000, total_cents: 50_000, payment_provider: 'paystack', payment_ref: 'ref_1234567890',
    product: { title: 'A very long product name that keeps going and going well beyond the width of the description column', origin_country: 'CN' },
    buyer: { company_name: 'Glow Boutique', country_code: 'KE' }, supplier: { company_name: '上海贸易有限公司', country_code: 'CN' },
  });
  const bytes = await renderDocument(model, { subject: 'test' });
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), '%PDF-');
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), 1);
  assert.equal(doc.getTitle(), 'Commercial Invoice INV-1234ABCD');
  assert.equal(Math.round(doc.getPage(0).getWidth()), 595);
});
