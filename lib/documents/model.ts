/**
 * Pure document models for the commercial invoice (importer) and the payout
 * receipt (supplier). No I/O; rendered to PDF by lib/documents/pdf.ts.
 */
import type { EscrowStatus } from '../types';

/** Orders that have cleared customs (or later) get a commercial invoice. */
export const INVOICE_STATUSES: readonly EscrowStatus[] = ['customs_cleared', 'delivered_pending_verification', 'released'];
export const invoiceAvailable = (s: EscrowStatus) => INVOICE_STATUSES.includes(s);

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
export const money = (cents: number, currency = 'USD') =>
  currency === 'USD' ? usd.format(cents / 100) : new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');

export interface Party { company_name: string; full_name?: string | null; country_code: string }

export interface InvoiceInput {
  id: string; escrow_status: EscrowStatus; created_at: string; funded_at: string | null; released_at?: string | null;
  quantity: number; goods_cents: number; freight_cents: number; customs_cents: number; total_cents: number;
  /** Migration 026: part of total_cents; 0 / absent on older orders. */
  escrow_fee_cents?: number | null;
  payment_provider: string | null; payment_ref: string | null;
  product: { title: string; brand?: string | null; category?: string | null; origin_country?: string | null; hs_code?: string | null } | null;
  buyer: Party | null; supplier: Party | null;
  destination_label?: string | null; origin_label?: string | null;
}

export interface DocLine { label: string; value: string; strong?: boolean }
export interface DocModel {
  title: string; number: string; issued: string; status: string;
  parties: { heading: string; lines: string[] }[];
  facts: DocLine[];
  table: { head: [string, string, string, string]; rows: [string, string, string, string][] };
  totals: DocLine[];
  notes: string[];
}

/** Mask a provider reference: keep the last 6 characters. */
export const maskRef = (ref: string | null | undefined) => (!ref ? '—' : ref.length <= 6 ? ref : `…${ref.slice(-6)}`);

const providerLabel = (p: string | null) => (p === 'mpesa' ? 'M-Pesa' : p === 'paystack' ? 'Bank card (Paystack)' : p === 'flutterwave' ? 'Card (Flutterwave)' : p ?? '—');

const STATUS_LABEL: Partial<Record<EscrowStatus, string>> = {
  customs_cleared: 'Customs cleared - in escrow',
  delivered_pending_verification: 'Delivered - awaiting buyer verification',
  released: 'Completed - escrow released',
};

export function invoiceModel(o: InvoiceInput, issuedAt = new Date()): DocModel {
  const unit = o.quantity > 0 ? Math.round(o.goods_cents / o.quantity) : o.goods_cents;
  const party = (p: Party | null, extra: string[] = []) => (p ? [p.company_name, ...(p.full_name ? [`Attn: ${p.full_name}`] : []), p.country_code.toUpperCase(), ...extra] : ['—']);
  const fee = o.escrow_fee_cents ?? 0;
  return {
    title: 'Commercial Invoice',
    number: `INV-${o.id.slice(0, 8).toUpperCase()}`,
    issued: day(issuedAt.toISOString()),
    status: STATUS_LABEL[o.escrow_status] ?? o.escrow_status.replace(/_/g, ' '),
    parties: [
      { heading: 'Seller / exporter', lines: party(o.supplier, o.origin_label ? [`Ships from: ${o.origin_label}`] : []) },
      { heading: 'Buyer / importer', lines: party(o.buyer, o.destination_label ? [`Deliver to: ${o.destination_label}`] : []) },
    ],
    facts: [
      { label: 'Order', value: `#${o.id.slice(0, 8).toUpperCase()}` },
      { label: 'Order date', value: day(o.created_at) },
      { label: 'Paid into escrow', value: day(o.funded_at) },
      { label: 'Incoterm', value: 'DDP - Delivered Duty Paid' },
      { label: 'Country of origin', value: (o.product?.origin_country ?? '—').toUpperCase() },
      { label: 'Payment', value: `${providerLabel(o.payment_provider)} · ref ${maskRef(o.payment_ref)}` },
    ],
    table: {
      head: ['Description', 'Qty', 'Unit price', 'Amount'],
      rows: [
        [[o.product?.brand, o.product?.title].filter(Boolean).join(' - ') || 'Goods', String(o.quantity), money(unit), money(o.goods_cents)],
        ['Consolidated air freight', '1', money(o.freight_cents), money(o.freight_cents)],
        ['Customs clearance & import duties', '1', money(o.customs_cents), money(o.customs_cents)],
        ...(fee > 0 ? [['Escrow protection fee (SokoGlobal)', '1', money(fee), money(fee)] as [string, string, string, string]] : []),
      ],
    },
    totals: fee > 0 ? [
      { label: 'Guaranteed Landed Cost', value: money(o.total_cents - fee) },
      { label: 'Escrow protection fee', value: money(fee) },
      { label: 'Total paid (USD)', value: money(o.total_cents), strong: true },
    ] : [
      { label: 'Goods value', value: money(o.goods_cents) },
      { label: 'Freight', value: money(o.freight_cents) },
      { label: 'Duties & clearance', value: money(o.customs_cents) },
      { label: 'Guaranteed Landed Cost (USD)', value: money(o.total_cents), strong: true },
    ],
    notes: [
      'Funds are held in escrow by SokoGlobal and released to the seller only after the buyer verifies delivery.',
      'All amounts are in US dollars. Duties and clearance were prepaid as part of the Guaranteed Landed Cost.',
    ],
  };
}

export interface PayoutInput {
  id: string; order_id: string; reference: string; status: string;
  gross_cents: number; fee_cents: number; amount_cents: number; currency: string;
  /** Migration 026: part of fee_cents when the supplier took an instant early payout. */
  early_payout_fee_cents?: number | null; early?: boolean | null;
  payout_currency?: string | null; payout_amount?: string | number | null;
  created_at: string; completed_at: string | null; flw_transfer_id?: string | null;
  supplier: Party | null; product_title?: string | null;
}

export const receiptAvailable = (status: string) => status === 'succeeded';

export function payoutReceiptModel(p: PayoutInput, issuedAt = new Date()): DocModel {
  const local = p.payout_currency && p.payout_amount != null && p.payout_currency !== p.currency
    ? [{ label: `Paid out in ${p.payout_currency}`, value: `${Number(p.payout_amount).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${p.payout_currency}` }]
    : [];
  return {
    title: 'Payout Receipt',
    number: `PAY-${p.id.slice(0, 8).toUpperCase()}`,
    issued: day(issuedAt.toISOString()),
    status: p.status === 'succeeded' ? 'Paid' : p.status,
    parties: [
      { heading: 'Payee (supplier)', lines: p.supplier ? [p.supplier.company_name, p.supplier.country_code.toUpperCase()] : ['—'] },
      { heading: 'Payer', lines: ['SokoGlobal escrow', p.early ? 'Instant early payout, funded by SokoGlobal on dispatch' : 'Released after buyer verification'] },
    ],
    facts: [
      { label: 'Order', value: `#${p.order_id.slice(0, 8).toUpperCase()}` },
      ...(p.product_title ? [{ label: 'Product', value: p.product_title }] : []),
      { label: 'Payout reference', value: p.reference },
      { label: 'Transfer id', value: maskRef(p.flw_transfer_id) },
      { label: 'Initiated', value: day(p.created_at) },
      { label: 'Completed', value: day(p.completed_at) },
    ],
    table: {
      head: ['Item', '', '', 'Amount'],
      rows: [
        ['Goods value released from escrow', '', '', money(p.gross_cents, p.currency)],
        ...(p.early_payout_fee_cents
          ? [['Platform commission', '', '', `-${money(p.fee_cents - p.early_payout_fee_cents, p.currency)}`],
             ['Instant early payout fee', '', '', `-${money(p.early_payout_fee_cents, p.currency)}`]] as [string, string, string, string][]
          : [['Platform fee', '', '', `-${money(p.fee_cents, p.currency)}`] as [string, string, string, string]]),
      ],
    },
    totals: [{ label: `Net payout (${p.currency})`, value: money(p.amount_cents, p.currency), strong: true }, ...local],
    notes: ['This receipt confirms the transfer from SokoGlobal escrow to your registered payout account.'],
  };
}

/**
 * The standard PDF fonts only cover WinAnsi (Latin-1). Map common typography
 * to ASCII and replace anything else (e.g. CJK company names) with "?" so PDF
 * generation never throws.
 */
export function winAnsi(s: string): string {
  return s
    .replace(/[–—−]/g, '-').replace(/[‘’‚]/g, "'").replace(/[“”„]/g, '"')
    .replace(/…/g, '...').replace(/ /g, ' ').replace(/[•·]/g, '·')
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x20-\x7E -ÿ]/g, '?');
}
