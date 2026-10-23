/**
 * Platform pricing (pure). Contract: platform_settings pricing columns and
 * super_set_platform_pricing() in migration 026. Prices are dollars and rates
 * are fractions (0.05 = 5%) as stored; the app charges and displays cents.
 * Postgres computes every real charge — these helpers only preview and validate.
 */
export interface PlatformPricing {
  supplier_gold_monthly_price: number;
  supplier_gold_commission_rate: number;
  default_supplier_commission_rate: number;
  featured_rfq_price: number;
  white_glove_sourcing_fee: number;
  escrow_fee_percent: number;
  fx_spread_percent: number;
  early_payout_discount_fee: number;
  logistics_markup_percent: number;
}
export type PricingKey = keyof PlatformPricing;

export const DEFAULT_PRICING: PlatformPricing = {
  supplier_gold_monthly_price: 49, supplier_gold_commission_rate: 0.03, default_supplier_commission_rate: 0.05,
  featured_rfq_price: 15, white_glove_sourcing_fee: 25, escrow_fee_percent: 0.02, fx_spread_percent: 0.01,
  early_payout_discount_fee: 0.03, logistics_markup_percent: 0.08,
};
export const PRICING_KEYS = Object.keys(DEFAULT_PRICING) as PricingKey[];

/** Fields edited as USD prices; the rest are rates edited as percentages. */
export const PRICE_FIELDS: readonly PricingKey[] = ['supplier_gold_monthly_price', 'featured_rfq_price', 'white_glove_sourcing_fee'];
export const isPriceField = (k: PricingKey) => PRICE_FIELDS.includes(k);

/** Bounds as in super_set_platform_pricing() (rates as fractions). */
export const PRICING_BOUNDS: Record<PricingKey, { min: number; max: number; label: string }> = {
  supplier_gold_monthly_price: { min: 1, max: 10_000, label: 'Gold Supplier monthly price' },
  supplier_gold_commission_rate: { min: 0, max: 0.30, label: 'Gold commission' },
  default_supplier_commission_rate: { min: 0, max: 0.30, label: 'Standard commission' },
  featured_rfq_price: { min: 1, max: 10_000, label: 'Featured RFQ price' },
  white_glove_sourcing_fee: { min: 1, max: 10_000, label: 'White-glove sourcing fee' },
  escrow_fee_percent: { min: 0, max: 0.10, label: 'Escrow fee' },
  fx_spread_percent: { min: 0, max: 0.10, label: 'FX spread' },
  early_payout_discount_fee: { min: 0, max: 0.20, label: 'Early payout fee' },
  logistics_markup_percent: { min: 0, max: 1, label: 'Logistics markup' },
};

/** platform_settings row → pricing; missing or malformed fields (before migration 026) fall back to the defaults. */
export function parsePricing(raw: unknown): PlatformPricing {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out = { ...DEFAULT_PRICING };
  for (const k of PRICING_KEYS) {
    const n = typeof r[k] === 'number' ? (r[k] as number) : Number(r[k]);
    if (r[k] !== null && r[k] !== undefined && Number.isFinite(n) && n >= PRICING_BOUNDS[k].min && n <= PRICING_BOUNDS[k].max) out[k] = n;
  }
  return out;
}

export const dollarsToCents = (d: number) => Math.round(d * 100);

/** "5%", "2.5%", "0.75%". */
export function formatRate(rate: number): string {
  const pct = Math.round(rate * 10_000) / 100;
  return `${pct.toLocaleString('en-US', { maximumFractionDigits: 2 })}%`;
}

/** Mirrors orders_platform_fees(): round half up of (goods + freight + customs) × rate. */
export function escrowFeeCents(landedCents: number, rate: number): number {
  if (!Number.isFinite(landedCents) || landedCents <= 0 || !(rate > 0)) return 0;
  return Math.round(landedCents * rate + 1e-9);
}

/** Mirrors the fee lines in begin_payout(): commission and early fee are floored separately. */
export function earlyPayoutBreakdown(goodsCents: number, commissionRate: number, earlyFeeRate: number) {
  const commissionCents = Math.floor(goodsCents * commissionRate);
  const feeCents = Math.floor(goodsCents * earlyFeeRate);
  return { grossCents: goodsCents, commissionCents, feeCents, netCents: goodsCents - commissionCents - feeCents };
}

/** Freight the buyer sees for a carrier cost, as admin_approve_product() stores it. */
export const markedUpFreightCents = (carrierCents: number, markup: number) => Math.round(carrierCents * (1 + markup));

export type PricingInput = Record<PricingKey, string>;
export type PricingParse = { ok: true; value: PlatformPricing } | { ok: false; errors: Partial<Record<PricingKey, string>> };

/**
 * Financials form → pricing. Prices are dollars ("$49", "1,250.50"); rates are
 * percentages ("3", "2.5%") with at most two decimals. Same bounds as Postgres,
 * plus Gold commission ≤ standard commission.
 */
export function parsePricingInput(input: PricingInput): PricingParse {
  const errors: Partial<Record<PricingKey, string>> = {};
  const value = { ...DEFAULT_PRICING };
  for (const k of PRICING_KEYS) {
    const b = PRICING_BOUNDS[k];
    const s = String(input[k] ?? '').replace(/[,\s$%]/g, '');
    if (!/^\d{1,6}(\.\d{1,2})?$/.test(s)) {
      errors[k] = isPriceField(k) ? 'Enter dollars, e.g. 49 or 49.99.' : 'Enter a percentage, e.g. 3 or 2.5.';
      continue;
    }
    const n = isPriceField(k) ? Number(s) : Math.round(Number(s) * 100) / 10_000;
    if (n < b.min || n > b.max) {
      errors[k] = isPriceField(k)
        ? `${b.label} must be between $${b.min.toLocaleString('en-US')} and $${b.max.toLocaleString('en-US')}.`
        : `${b.label} must be between ${formatRate(b.min)} and ${formatRate(b.max)}.`;
      continue;
    }
    value[k] = n;
  }
  if (!errors.supplier_gold_commission_rate && !errors.default_supplier_commission_rate
      && value.supplier_gold_commission_rate > value.default_supplier_commission_rate) {
    errors.supplier_gold_commission_rate = 'Gold commission can’t be higher than the standard commission.';
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value };
}

/** Pricing → form strings (percentages for rates). */
export function pricingToInput(p: PlatformPricing): PricingInput {
  return Object.fromEntries(PRICING_KEYS.map((k) => [k, isPriceField(k)
    ? p[k].toFixed(2)
    : String(Math.round(p[k] * 10_000) / 100)])) as PricingInput;
}

/** Only the fields that differ (what super_set_platform_pricing() receives). */
export function pricingChanges(before: PlatformPricing, after: PlatformPricing): Partial<PlatformPricing> {
  return Object.fromEntries(PRICING_KEYS.filter((k) => before[k] !== after[k]).map((k) => [k, after[k]])) as Partial<PlatformPricing>;
}

// ── Revenue (super_platform_revenue()) ──────────────────────────────────────

export const REVENUE_KEYS = [
  'subscriptions_cents', 'rfq_featured_cents', 'rfq_white_glove_cents', 'escrow_fees_cents', 'logistics_markup_cents',
  'fx_margin_cents', 'commission_cents', 'early_payout_fees_cents', 'active_gold_suppliers', 'early_payout_exposure_cents',
  'early_payouts_open', 'white_glove_open',
] as const;
export type RevenueSummary = Record<(typeof REVENUE_KEYS)[number], number>;

export function parseRevenue(raw: unknown): RevenueSummary {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return Object.fromEntries(REVENUE_KEYS.map((k) => {
    const n = Number(r[k]);
    return [k, Number.isFinite(n) && n > 0 ? Math.round(n) : 0];
  })) as RevenueSummary;
}

/** Everything the platform earned (USD cents), and the RFQ promotion total the dashboard shows as one card. */
export function revenueTotals(r: RevenueSummary) {
  const rfqPromotions = r.rfq_featured_cents + r.rfq_white_glove_cents;
  return {
    rfqPromotions,
    total: r.subscriptions_cents + rfqPromotions + r.escrow_fees_cents + r.logistics_markup_cents + r.fx_margin_cents
      + r.commission_cents + r.early_payout_fees_cents,
  };
}

// ── Gold Supplier ───────────────────────────────────────────────────────────

export type GoldState = { kind: 'none' } | { kind: 'active'; until: string } | { kind: 'lapsed'; endedAt: string };

/** Subscription row → what the supplier sees (status 'active' past its period end counts as lapsed, as in is_gold_supplier()). */
export function goldState(row: { status: string; current_period_end: string | null } | null, now = Date.now()): GoldState {
  if (!row?.current_period_end) return { kind: 'none' };
  const end = Date.parse(row.current_period_end);
  if (!Number.isFinite(end)) return { kind: 'none' };
  if (row.status === 'active' && end > now) return { kind: 'active', until: row.current_period_end };
  return { kind: 'lapsed', endedAt: row.current_period_end };
}

// ── RFQ add-ons ─────────────────────────────────────────────────────────────

export const RFQ_ADDONS = ['featured', 'white_glove'] as const;
export type RfqAddon = (typeof RFQ_ADDONS)[number];
export const RFQ_ADDON_LABEL: Record<RfqAddon, string> = { featured: 'Promote as Featured RFQ', white_glove: 'White-Glove Sourcing' };

/** Unique, known add-ons in a stable order; anything else is dropped. */
export function parseAddons(raw: unknown): RfqAddon[] {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
  return RFQ_ADDONS.filter((a) => list.includes(a));
}

export function addonsCents(addons: readonly RfqAddon[], p: PlatformPricing): number {
  return (addons.includes('featured') ? dollarsToCents(p.featured_rfq_price) : 0)
    + (addons.includes('white_glove') ? dollarsToCents(p.white_glove_sourcing_fee) : 0);
}
