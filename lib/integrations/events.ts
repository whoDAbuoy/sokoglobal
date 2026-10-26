import { z } from 'zod';

/**
 * Integration events (pure). The payloads are written by the migration 033 triggers into
 * integration_outbox; these schemas re-check every row before it leaves the platform.
 *
 * n8n payloads are strict objects: a key the schema doesn't list (a buyer's name, say) fails
 * validation instead of reaching a supplier's WhatsApp. The CRM copies extend them with the
 * buyer and supplier identities the CRM needs.
 */

export const INTEGRATION_TARGETS = ['n8n', 'twenty'] as const;
export type IntegrationTarget = (typeof INTEGRATION_TARGETS)[number];

const id = z.guid();
const timestamp = z.iso.datetime({ offset: true });
// Postgres limits count characters; JS lengths count UTF-16 units (an emoji is 2), so allow double
// rather than permanently fail a row the database already accepted.
const text = (max: number) => z.string().min(1).max(max * 2);
const country = z.string().length(2);
const escrowStatus = z.enum([
  'pending_payment', 'deposit_paid', 'funded', 'in_transit', 'customs_cleared',
  'delivered_pending_verification', 'released', 'disputed', 'refunded', 'cancelled',
]);
export type EscrowStatusValue = z.infer<typeof escrowStatus>;

const buyerIdentity = { buyer_id: id, buyer_name: text(200), buyer_company: text(160), buyer_country: country };
const supplierIdentity = { supplier_id: id, supplier_company: text(160) };

const rfqFields = {
  rfq_id: id,
  title: text(140),
  description: z.string().max(1000).optional(),
  quantity: z.int().positive(),
  unit_of_measure: text(24).optional(),
  target_price_kes: z.number().positive().optional(),
  delivery_location: text(160),
  category_id: id.optional(),
  category_name: text(120).optional(),
  product_id: id.optional(),
  buyer_country: country.optional(),
  created_at: timestamp,
  expires_at: timestamp,
};

export const rfqCreatedN8n = z.strictObject(rfqFields);
export const rfqCreatedCrm = z.object({ ...rfqFields, ...supplierIdentity, ...buyerIdentity });

export const quoteSubmittedCrm = z.object({
  rfq_id: id,
  quote_id: id,
  title: text(140),
  quantity: z.int().positive(),
  unit_price_kes: z.number().positive(),
  price_tiers: z.array(z.object({ min_qty: z.int().positive(), unit_price_kes: z.number().positive() })).max(5),
  moq: z.int().positive(),
  valid_until: timestamp,
  created_at: timestamp,
  ...supplierIdentity,
  ...buyerIdentity,
});

export const escrowChangedN8n = z.strictObject({
  order_id: id,
  from_status: escrowStatus.optional(),
  to_status: escrowStatus,
  product_title: text(200).optional(),
  total_cents: z.int().nonnegative(),
  currency: z.string().min(3).max(3).optional(),
  payment_structure: z.string().max(40).optional(),
  buyer_id: id,
  supplier_id: id.optional(),
  occurred_at: timestamp,
});

const inquiryFields = {
  thread_id: id,
  product_id: id.optional(),
  product_title: text(200).optional(),
  ...supplierIdentity,
  buyer_company: text(160),
  buyer_country: country,
  created_at: timestamp,
};
export const inquiryCreatedN8n = z.strictObject(inquiryFields);
export const inquiryCreatedCrm = z.object({ ...inquiryFields, buyer_id: id, buyer_name: text(200) });

export const profileViewedCrm = z.object({ ...supplierIdentity, ...buyerIdentity, viewed_on: z.iso.date() });

/** Which events each target handles, with the schema its payload must pass. */
export const EVENT_SCHEMAS = {
  n8n: {
    'rfq.created': rfqCreatedN8n,
    'escrow.status_changed': escrowChangedN8n,
    'lead.inquiry_created': inquiryCreatedN8n,
  },
  twenty: {
    'rfq.created': rfqCreatedCrm,
    'rfq.quote_submitted': quoteSubmittedCrm,
    'lead.inquiry_created': inquiryCreatedCrm,
    'supplier.profile_viewed': profileViewedCrm,
  },
} as const;

export type N8nEventType = keyof typeof EVENT_SCHEMAS.n8n;
export type CrmEventType = keyof typeof EVENT_SCHEMAS.twenty;
export type N8nEvent = { [K in N8nEventType]: { type: K; data: z.infer<(typeof EVENT_SCHEMAS.n8n)[K]> } }[N8nEventType];
export type CrmEvent = { [K in CrmEventType]: { type: K; data: z.infer<(typeof EVENT_SCHEMAS.twenty)[K]> } }[CrmEventType];

export type ParsedEvent<E> = { ok: true; event: E } | { ok: false; error: string };

function parseWith<E>(schemas: Record<string, z.ZodType>, type: string, payload: unknown): ParsedEvent<E> {
  const schema = Object.hasOwn(schemas, type) ? schemas[type] : undefined;
  if (!schema) return { ok: false, error: `Unsupported event type ${type}` };
  const result = schema.safeParse(payload);
  if (!result.success) return { ok: false, error: `Invalid ${type} payload: ${z.prettifyError(result.error).slice(0, 500)}` };
  return { ok: true, event: { type, data: result.data } as E };
}

export const parseN8nEvent = (type: string, payload: unknown) => parseWith<N8nEvent>(EVENT_SCHEMAS.n8n, type, payload);
export const parseCrmEvent = (type: string, payload: unknown) => parseWith<CrmEvent>(EVENT_SCHEMAS.twenty, type, payload);

// ── n8n envelope ────────────────────────────────────────────────────────────

/** A party's own contact row (rfq_supplier_recipients / integration_contacts). */
export const contactRow = z.object({
  id: id.optional(),
  supplier_id: id.optional(),
  role: z.enum(['supplier', 'importer', 'admin']).optional(),
  company_name: z.string(),
  country_code: z.string().nullable().optional(),
  phone_number: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  email_notifications: z.boolean().nullable().optional(),
  sms_alerts: z.boolean().nullable().optional(),
});
export type ContactRow = z.infer<typeof contactRow>;

export interface Recipient {
  party: 'supplier' | 'buyer';
  user_id: string;
  company: string;
  country: string | null;
  email: string | null;
  /** E.164, e.g. +254712345678 — for SMS, Telegram contact lookup, etc. */
  phone_e164: string | null;
  /** The same number without "+", as the WhatsApp Cloud API expects it. */
  whatsapp_id: string | null;
  opt_in: { email: boolean; sms: boolean };
  /** Where this party acts on the event. */
  url: string;
}

export interface N8nEnvelope {
  id: string;
  type: N8nEventType;
  occurred_at: string;
  attempt: number;
  data: N8nEvent['data'];
  recipients: Recipient[];
  /** Ready-to-send plain text (WhatsApp / Telegram / WeChat / SMS); recipients carry their own link. */
  message: string;
}

const E164 = /^\+[1-9][0-9]{7,14}$/;

export function toRecipient(row: ContactRow, party: Recipient['party'], url: string): Recipient | null {
  const userId = row.supplier_id ?? row.id;
  if (!userId) return null;
  const phone = row.phone_number && E164.test(row.phone_number) ? row.phone_number : null;
  return {
    party, user_id: userId, company: row.company_name, country: row.country_code ?? null,
    email: row.email ?? null, phone_e164: phone, whatsapp_id: phone ? phone.slice(1) : null,
    opt_in: { email: row.email_notifications ?? true, sms: row.sms_alerts ?? false },
    url,
  };
}

const ESCROW_MILESTONE: Record<EscrowStatusValue, string> = {
  pending_payment: 'is awaiting payment',
  deposit_paid: 'has its 30% deposit in escrow',
  funded: 'is paid in full and held in escrow',
  in_transit: 'is in transit',
  customs_cleared: 'has cleared customs',
  delivered_pending_verification: 'was delivered and is awaiting the buyer\'s verification',
  released: 'was verified; escrow is released to the supplier',
  disputed: 'has a dispute open; escrow funds are frozen',
  refunded: 'was refunded to the buyer',
  cancelled: 'was cancelled',
};

const kes = (n: number) => `KES ${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export function n8nMessage(event: N8nEvent): string {
  switch (event.type) {
    case 'rfq.created': {
      const r = event.data;
      const qty = `${r.quantity.toLocaleString('en-US')}${r.unit_of_measure ? ` ${r.unit_of_measure}` : ''}`;
      const target = r.target_price_kes ? ` Target ${kes(r.target_price_kes)}/unit.` : '';
      const from = r.buyer_country ? ` from a buyer in ${r.buyer_country}` : '';
      return `New request for quotes on SokoGlobal${from}: "${r.title}" — ${qty}, delivered to ${r.delivery_location}.${target} Quote before ${day(r.expires_at)}.`;
    }
    case 'escrow.status_changed': {
      const o = event.data;
      return `SokoGlobal order ${o.order_id.slice(0, 8)}${o.product_title ? ` (${o.product_title})` : ''} ${ESCROW_MILESTONE[o.to_status]}.`;
    }
    case 'lead.inquiry_created': {
      const l = event.data;
      return `New buyer inquiry on SokoGlobal: ${l.buyer_company} (${l.buyer_country}) asked about ${l.product_title ? `"${l.product_title}"` : 'one of your listings'}. Reply in your inbox.`;
    }
  }
}

/** Contacts needed to address an event, so the dispatcher can look them up. */
export function n8nContactIds(event: N8nEvent): { supplier: string[]; buyer: string[] } {
  switch (event.type) {
    case 'rfq.created': return { supplier: [], buyer: [] };   // resolved by rfq_supplier_recipients()
    case 'escrow.status_changed': return { supplier: event.data.supplier_id ? [event.data.supplier_id] : [], buyer: [event.data.buyer_id] };
    case 'lead.inquiry_created': return { supplier: [event.data.supplier_id], buyer: [] };
  }
}

/** Link each party opens for an event. */
export function partyUrl(event: N8nEvent, party: Recipient['party'], site: string): string {
  switch (event.type) {
    case 'rfq.created': return `${site}/supplier/rfqs`;
    case 'escrow.status_changed': return party === 'buyer' ? `${site}/dashboard/orders/${event.data.order_id}` : `${site}/supplier/orders/${event.data.order_id}`;
    case 'lead.inquiry_created': return `${site}/supplier/messages`;
  }
}

export function buildN8nEnvelope(
  row: { id: number | string; created_at: string; attempts: number },
  event: N8nEvent,
  recipients: Recipient[],
): N8nEnvelope {
  return {
    id: `evt_${row.id}`,
    type: event.type,
    occurred_at: row.created_at,
    attempt: row.attempts,
    data: event.data,
    recipients,
    message: n8nMessage(event),
  };
}
