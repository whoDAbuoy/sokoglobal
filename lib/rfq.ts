/**
 * Request-for-quote rules (pure). Mirrors migration 021: submit_rfq(),
 * submit_rfq_quote(), accept_rfq_quote(), rfq_unit_price_kes() and the RFQ
 * status machine. Prices are KES per unit; the order is priced in USD cents
 * at the exchange_rates USD rate when the buyer accepts.
 */
import type { PaymentStructure } from './milestone';

export type RfqStatus = 'open' | 'quoted' | 'accepted' | 'rejected' | 'expired';
export type QuoteStatus = 'pending' | 'accepted' | 'rejected';
export type PriceTier = { min_qty: number; unit_price_kes: number };

export const RFQ_STATUS_LABEL: Record<RfqStatus, string> = {
  open: 'Waiting for quotes', quoted: 'Quotes received', accepted: 'Accepted', rejected: 'Closed', expired: 'Expired',
};

export const MAX_TIERS = 5;
export const MAX_QUANTITY = 100_000_000;
export const MAX_PRICE_KES = 10_000_000_000;
/** Payment options a supplier can offer today (trade credit is reserved in the schema, not offered). */
export const QUOTABLE_STRUCTURES: PaymentStructure[] = ['full', 'milestone_30_70'];

// ── Status machine ──────────────────────────────────────────────────────────

export type RfqEvent = 'quote_submitted' | 'last_quote_closed' | 'accept' | 'close' | 'expire';

/** Next status, or null when the event is not allowed from `status`. */
export function rfqTransition(status: RfqStatus, event: RfqEvent): RfqStatus | null {
  const live = status === 'open' || status === 'quoted';
  switch (event) {
    case 'quote_submitted': return live ? 'quoted' : null;
    case 'last_quote_closed': return status === 'quoted' ? 'open' : status === 'open' ? 'open' : null;
    case 'accept': return live ? 'accepted' : null;
    case 'close': return live ? 'rejected' : null;
    case 'expire': return live ? 'expired' : null;
  }
}

/** Status as the user should see it: a live request past its deadline is expired even before the cron runs. */
export function effectiveRfqStatus(rfq: { status: RfqStatus; expires_at: string }, now = Date.now()): RfqStatus {
  return (rfq.status === 'open' || rfq.status === 'quoted') && Date.parse(rfq.expires_at) <= now ? 'expired' : rfq.status;
}

// ── Pricing ─────────────────────────────────────────────────────────────────

/** The highest tier the quantity reaches, else the base price. */
export function unitPriceForQuantity(basePriceKes: number, tiers: readonly PriceTier[], quantity: number): number {
  let best: PriceTier | null = null;
  for (const t of tiers) if (t.min_qty <= quantity && (!best || t.min_qty > best.min_qty)) best = t;
  return best ? best.unit_price_kes : basePriceKes;
}

export interface QuotePricing { unit_price_kes: number; price_tiers: readonly PriceTier[]; moq: number }

/**
 * What accepting a quote orders: at least the supplier's MOQ, at the tier price
 * for that quantity, converted to USD cents at `usdRateToKes` (KES per USD).
 */
export function quoteOrderLine(rfqQuantity: number, quote: QuotePricing, usdRateToKes: number) {
  const quantity = Math.max(rfqQuantity, quote.moq);
  const unitPriceKes = unitPriceForQuantity(quote.unit_price_kes, quote.price_tiers, quantity);
  const totalKes = Math.round(unitPriceKes * quantity * 100) / 100;
  const goodsCents = Math.round((totalKes * 100) / usdRateToKes);
  return { quantity, unitPriceKes, totalKes, goodsCents, raisedToMoq: quantity > rfqQuantity };
}

// ── Acceptance ──────────────────────────────────────────────────────────────

export function canAcceptQuote(
  rfq: { status: RfqStatus; expires_at: string },
  quote: { status: QuoteStatus; valid_until: string; allowed_payment_structures: readonly string[] },
  structure: PaymentStructure,
  now = Date.now(),
): { ok: true } | { ok: false; reason: string } {
  if (rfq.status !== 'open' && rfq.status !== 'quoted') return { ok: false, reason: `This request is already ${RFQ_STATUS_LABEL[rfq.status].toLowerCase()}` };
  if (Date.parse(rfq.expires_at) <= now) return { ok: false, reason: 'This request has expired' };
  if (quote.status !== 'pending') return { ok: false, reason: 'This quote is no longer open' };
  if (Date.parse(quote.valid_until) <= now) return { ok: false, reason: 'This quote has expired — ask the supplier to re-quote' };
  if (structure === 'credit_30_days') return { ok: false, reason: 'Trade credit terms are not available yet' };
  if (!quote.allowed_payment_structures.includes(structure)) return { ok: false, reason: 'The supplier did not offer that payment option' };
  return { ok: true };
}

// ── Form validation (server actions re-run these; Postgres checks again) ───

type Errors<K extends string> = Partial<Record<K | 'form', string>>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
/** "1,250.50" → 1250.5; blank → null; anything else → NaN. */
export function parseAmount(v: unknown): number | null {
  const s = text(v).replace(/[,\s]/g, '');
  if (!s) return null;
  return /^\d+(\.\d{1,2})?$/.test(s) ? Number(s) : Number.NaN;
}
const parseInteger = (v: unknown) => {
  const s = text(v).replace(/[,\s]/g, '');
  return /^\d+$/.test(s) ? Number(s) : Number.NaN;
};

export interface RfqDraft {
  title: string; description: string; quantity: number; unitOfMeasure: string | null; deliveryLocation: string;
  targetPriceKes: number | null; categoryId: string | null; productId: string | null; expiresInDays: number;
}
type RfqField = 'title' | 'description' | 'quantity' | 'unitOfMeasure' | 'deliveryLocation' | 'targetPriceKes' | 'categoryId' | 'expiresInDays';

export function validateRfqDraft(input: Record<string, unknown>): { ok: true; value: RfqDraft } | { ok: false; errors: Errors<RfqField> } {
  const errors: Errors<RfqField> = {};
  const title = text(input.title);
  const description = text(input.description);
  const quantity = parseInteger(input.quantity);
  const unit = text(input.unitOfMeasure);
  const deliveryLocation = text(input.deliveryLocation);
  const target = parseAmount(input.targetPriceKes);
  const categoryId = text(input.categoryId) || null;
  const productId = text(input.productId) || null;
  const expiresInDays = input.expiresInDays === undefined || text(input.expiresInDays) === '' ? 14 : parseInteger(input.expiresInDays);

  if (title.length < 3 || title.length > 140) errors.title = 'Give the request a title of 3–140 characters.';
  if (description.length < 10 || description.length > 4000) errors.description = 'Describe what you need in 10–4,000 characters (specs, grade, packaging).';
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) errors.quantity = 'Enter a whole quantity of at least 1.';
  if (unit.length > 24) errors.unitOfMeasure = 'Keep the unit under 24 characters (e.g. kg, pieces, cartons).';
  if (deliveryLocation.length < 2 || deliveryLocation.length > 160) errors.deliveryLocation = 'Enter the delivery town or address (2–160 characters).';
  if (target !== null && !(target > 0 && target <= MAX_PRICE_KES)) errors.targetPriceKes = 'Target price must be a positive KES amount with at most 2 decimals.';
  if (categoryId && !UUID.test(categoryId)) errors.categoryId = 'Choose a category from the list.';
  if (productId && !UUID.test(productId)) errors.form = 'Invalid listing.';
  if (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 60) errors.expiresInDays = 'Collect quotes for 1 to 60 days.';
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { title, description, quantity, unitOfMeasure: unit || null, deliveryLocation, targetPriceKes: target, categoryId, productId, expiresInDays } };
}

export interface QuoteDraft {
  productId: string; unitPriceKes: number; moq: number; validDays: number; leadTimeDays: number | null;
  termsNote: string | null; priceTiers: PriceTier[]; allowedStructures: PaymentStructure[];
}
type QuoteField = 'productId' | 'unitPriceKes' | 'moq' | 'validDays' | 'leadTimeDays' | 'termsNote' | 'priceTiers' | 'allowedStructures';

/** Tiers must have distinct whole quantities and positive prices; higher quantities may not cost more per unit. */
export function validateTiers(tiers: readonly PriceTier[], basePriceKes: number): string | null {
  if (tiers.length > MAX_TIERS) return `At most ${MAX_TIERS} price tiers.`;
  const seen = new Set<number>();
  for (const t of tiers) {
    if (!Number.isInteger(t.min_qty) || t.min_qty < 1 || t.min_qty > MAX_QUANTITY) return 'Each tier needs a whole minimum quantity.';
    if (!(t.unit_price_kes > 0 && t.unit_price_kes <= MAX_PRICE_KES)) return 'Each tier needs a positive KES unit price.';
    if (seen.has(t.min_qty)) return 'Two tiers start at the same quantity.';
    seen.add(t.min_qty);
  }
  const sorted = [...tiers].sort((a, b) => a.min_qty - b.min_qty);
  let last = basePriceKes;
  for (const t of sorted) {
    if (t.unit_price_kes > last) return 'Bulk tiers should not cost more per unit than smaller quantities.';
    last = t.unit_price_kes;
  }
  return null;
}

export function validateQuoteDraft(input: {
  productId?: unknown; unitPriceKes?: unknown; moq?: unknown; validDays?: unknown; leadTimeDays?: unknown; termsNote?: unknown;
  tiers?: { minQty?: unknown; unitPriceKes?: unknown }[]; allowedStructures?: unknown[];
}): { ok: true; value: QuoteDraft } | { ok: false; errors: Errors<QuoteField> } {
  const errors: Errors<QuoteField> = {};
  const productId = text(input.productId);
  const unitPriceKes = parseAmount(input.unitPriceKes);
  const moq = parseInteger(input.moq);
  const validDays = parseInteger(input.validDays);
  const leadRaw = text(input.leadTimeDays);
  const leadTimeDays = leadRaw ? parseInteger(leadRaw) : null;
  const termsNote = text(input.termsNote);
  const allowed = [...new Set((input.allowedStructures ?? []).map(text))].filter((s): s is PaymentStructure => (QUOTABLE_STRUCTURES as string[]).includes(s));
  const tiers: PriceTier[] = [];
  for (const row of input.tiers ?? []) {
    const q = text(row.minQty), p = text(row.unitPriceKes);
    if (!q && !p) continue;   // empty row in the form
    tiers.push({ min_qty: parseInteger(q), unit_price_kes: parseAmount(p) ?? Number.NaN });
  }

  if (!UUID.test(productId)) errors.productId = 'Choose which of your listings this quote is for.';
  if (unitPriceKes === null || !(unitPriceKes > 0 && unitPriceKes <= MAX_PRICE_KES)) errors.unitPriceKes = 'Enter your unit price in KES (at most 2 decimals).';
  if (!Number.isInteger(moq) || moq < 1 || moq > MAX_QUANTITY) errors.moq = 'Enter your minimum order quantity.';
  if (!Number.isInteger(validDays) || validDays < 1 || validDays > 90) errors.validDays = 'A quote can stay valid for 1 to 90 days.';
  if (leadTimeDays !== null && (!Number.isInteger(leadTimeDays) || leadTimeDays < 1 || leadTimeDays > 365)) errors.leadTimeDays = 'Lead time must be 1–365 days.';
  if (termsNote.length > 2000) errors.termsNote = 'Keep the terms under 2,000 characters.';
  if (!allowed.length) errors.allowedStructures = 'Offer at least one payment option.';
  if (!errors.unitPriceKes) {
    const tierError = validateTiers(tiers, unitPriceKes as number);
    if (tierError) errors.priceTiers = tierError;
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: {
    productId, unitPriceKes: unitPriceKes as number, moq, validDays, leadTimeDays, termsNote: termsNote || null,
    priceTiers: [...tiers].sort((a, b) => a.min_qty - b.min_qty), allowedStructures: allowed,
  } };
}

/** jsonb price_tiers from Postgres → typed tiers (drops malformed entries). */
export function parseTiers(raw: unknown): PriceTier[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((t: { min_qty?: unknown; unit_price_kes?: unknown }) => ({ min_qty: Number(t?.min_qty), unit_price_kes: Number(t?.unit_price_kes) }))
    .filter((t) => Number.isInteger(t.min_qty) && t.min_qty > 0 && t.unit_price_kes > 0)
    .sort((a, b) => a.min_qty - b.min_qty);
}

// ── Categories ──────────────────────────────────────────────────────────────

/** Same as category_within() in SQL: the listing's category is the requested one or sits below it. */
export function categoryWithin(categoryId: string | null, ancestorId: string | null, parentOf: ReadonlyMap<string, string | null>): boolean {
  if (!ancestorId) return true;
  let id = categoryId;
  for (let depth = 0; id && depth < 6; depth += 1) {
    if (id === ancestorId) return true;
    id = parentOf.get(id) ?? null;
  }
  return false;
}

/** "Agriculture › Spices › Vanilla" labels for a category picker, in tree order. */
export function categoryOptions(rows: readonly { id: string; parent_id: string | null; name: string; sort_order?: number }[]) {
  const byParent = new Map<string | null, typeof rows[number][]>();
  for (const r of rows) byParent.set(r.parent_id, [...(byParent.get(r.parent_id) ?? []), r]);
  const out: { id: string; label: string }[] = [];
  const walk = (parent: string | null, trail: string[], depth: number) => {
    if (depth > 4) return;
    for (const r of [...(byParent.get(parent) ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name))) {
      const label = [...trail, r.name];
      out.push({ id: r.id, label: label.join(' › ') });
      walk(r.id, label, depth + 1);
    }
  };
  walk(null, [], 0);
  return out;
}

// ── Deletion & sharing (migration 022) ─────────────────────────────────────

/** Who sees a Delete button on a request: its buyer and super admins (migrations 022, 023). */
export const showsRfqDelete = (who: { isOwner: boolean; isSuperAdmin: boolean }) => who.isOwner || who.isSuperAdmin;

/**
 * Why a request can't be deleted right now (null = it can). Mirrors the delete policies: the buyer
 * while no quote is accepted, a super admin always — and nobody once a quote became an escrow order.
 */
export function rfqDeleteBlock(r: { status: RfqStatus; hasOrder: boolean }, who: { isOwner: boolean; isSuperAdmin: boolean }): string | null {
  if (!showsRfqDelete(who)) return 'Only the buyer who posted this request can delete it.';
  if (r.hasOrder) return 'This request became an escrow order, so it is kept with the order. Cancel or refund the order instead.';
  if (!who.isSuperAdmin && r.status === 'accepted') return 'A quote on this request was accepted, so it can no longer be deleted.';
  return null;
}

export const canDeleteRfq = (r: { status: RfqStatus; hasOrder: boolean }, who: { isOwner: boolean; isSuperAdmin: boolean }) => rfqDeleteBlock(r, who) === null;

/** Link that opens a request directly (signed-in users; RLS shows live requests to everyone). */
export function rfqShareUrl(origin: string, rfqId: string): string {
  return `${origin.replace(/\/+$/, '')}/rfqs/${encodeURIComponent(rfqId)}`;
}
