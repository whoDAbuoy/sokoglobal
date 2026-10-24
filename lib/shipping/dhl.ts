/**
 * DHL Express (pure): request builders and defensive response parsers for
 *   - MyDHL API  POST /rates        freight price, transit days, estimated delivery
 *   - MyDHL API  POST /landed-cost  estimated duties and taxes (needs an HS code)
 *   - Shipment Tracking (Unified)   GET /track/shipments?trackingNumber=…&service=express
 * Network calls and credentials live in lib/shipping/dhl-server.ts.
 *
 * Quote-only: a DHL quote is shown next to SokoGlobal's Guaranteed Landed Cost for
 * comparison. It never changes what an order charges (that stays in Postgres).
 *
 * Field names follow DHL's published references; DHL does not publish full response
 * schemas openly, so every parser treats every field as optional and type-checks it.
 * Confirm against the MyDHL / Tracking sandboxes before relying on a new field.
 */

// ── Inputs ──────────────────────────────────────────────────────────────────

export interface DhlParty { countryCode: string; cityName: string; postalCode?: string | null }
export interface DhlParcel { weightKg: number; lengthCm: number; widthCm: number; heightCm: number }
export interface QuoteRequest {
  origin: DhlParty; destination: DhlParty; parcel: DhlParcel;
  declaredValueCents: number; accountNumber: string; shipDate: Date;
  /** Landed-cost only: what is in the box. */
  item?: { title: string; units: number; hsCode: string | null };
}

/** What the checkout form sends (the server adds origin, value and account). */
export interface QuoteFormInput { destinationCity: string; destinationPostalCode: string | null; parcel: DhlParcel }
type FormField = 'destinationCity' | 'destinationPostalCode' | 'weightKg' | 'lengthCm' | 'widthCm' | 'heightCm';

const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : Number.NaN);
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** Validates the buyer's destination and parcel (DHL Express per-piece limits: 300 kg, 300 cm). */
export function validateQuoteForm(raw: Record<string, unknown>):
  { ok: true; value: QuoteFormInput } | { ok: false; errors: Partial<Record<FormField, string>> } {
  const errors: Partial<Record<FormField, string>> = {};
  const destinationCity = text(raw.destinationCity);
  const postal = text(raw.destinationPostalCode);
  if (destinationCity.length < 2 || destinationCity.length > 60 || !/^[\p{L}\p{M} .'-]+$/u.test(destinationCity)) errors.destinationCity = 'Enter the delivery city.';
  if (postal && !/^[A-Za-z0-9 -]{2,12}$/.test(postal)) errors.destinationPostalCode = 'Postal codes are 2–12 letters, digits or spaces.';
  const parcel = { weightKg: num(raw.weightKg), lengthCm: num(raw.lengthCm), widthCm: num(raw.widthCm), heightCm: num(raw.heightCm) };
  if (!(parcel.weightKg >= 0.1 && parcel.weightKg <= 300)) errors.weightKg = 'Weight must be 0.1–300 kg.';
  for (const k of ['lengthCm', 'widthCm', 'heightCm'] as const) if (!(parcel[k] >= 1 && parcel[k] <= 300)) errors[k] = '1–300 cm.';
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { destinationCity, destinationPostalCode: postal || null, parcel } };
}

/** "2026-10-26T10:00:00 GMT+00:00": the next weekday at 10:00 UTC (MyDHL's planned-shipping format). */
export function plannedShippingDate(from: Date): string {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + 1, 10));
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return `${d.toISOString().slice(0, 19)} GMT+00:00`;
}

const party = (p: DhlParty) => ({ postalCode: p.postalCode ?? '', cityName: p.cityName, countryCode: p.countryCode.toUpperCase() });
const pkg = (p: DhlParcel) => ({ weight: round2(p.weightKg), dimensions: { length: Math.ceil(p.lengthCm), width: Math.ceil(p.widthCm), height: Math.ceil(p.heightCm) } });
const round2 = (n: number) => Math.round(n * 100) / 100;

export function buildRateRequest(q: QuoteRequest) {
  return {
    customerDetails: { shipperDetails: party(q.origin), receiverDetails: party(q.destination) },
    accounts: [{ typeCode: 'shipper', number: q.accountNumber }],
    plannedShippingDateAndTime: plannedShippingDate(q.shipDate),
    unitOfMeasurement: 'metric',
    isCustomsDeclarable: true,
    monetaryAmount: [{ typeCode: 'declaredValue', value: round2(q.declaredValueCents / 100), currency: 'USD' }],
    estimatedDeliveryDate: { isRequested: true, typeCode: 'QDDC' },
    packages: [pkg(q.parcel)],
  };
}

export function buildLandedCostRequest(q: QuoteRequest & { item: NonNullable<QuoteRequest['item']> }, productCode: string) {
  const value = round2(q.declaredValueCents / 100);
  return {
    customerDetails: { shipperDetails: party(q.origin), receiverDetails: party(q.destination) },
    accounts: [{ typeCode: 'shipper', number: q.accountNumber }],
    productCode,
    unitOfMeasurement: 'metric',
    currencyCode: 'USD',
    isCustomsDeclarable: true,
    getCostBreakdown: true,
    shipmentPurpose: 'commercial',
    transportationMode: 'air',
    packages: [pkg(q.parcel)],
    items: [{
      number: 1, name: q.item.title.slice(0, 70), description: q.item.title.slice(0, 70), manufacturerCountry: q.origin.countryCode.toUpperCase(),
      quantity: Math.max(1, Math.round(q.item.units)), quantityType: 'prt', unitPrice: round2(value / Math.max(1, q.item.units)), unitPriceCurrencyCode: 'USD',
      customsValue: value, customsValueCurrencyCode: 'USD', ...(q.item.hsCode ? { commodityCode: q.item.hsCode } : {}),
      weight: round2(q.parcel.weightKg), weightUnitOfMeasurement: 'metric',
    }],
  };
}

// ── Rates ───────────────────────────────────────────────────────────────────

export interface DhlQuote {
  productName: string; productCode: string; currency: string; freightCents: number;
  transitDays: number | null; estimatedDelivery: string | null;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const cents = (v: unknown) => { const n = num(v); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null; };

/** Billing-currency price (BILLC), else the first priced entry. */
function price(totalPrice: unknown): { cents: number; currency: string } | null {
  const entries = arr(totalPrice).filter(isObj);
  const pick = entries.find((e) => e.currencyType === 'BILLC' && cents(e.price) !== null) ?? entries.find((e) => cents(e.price) !== null);
  if (!pick) return null;
  return { cents: cents(pick.price)!, currency: (str(pick.priceCurrency) ?? 'USD').toUpperCase() };
}

/** The Express Worldwide offer (code P) when present, else the cheapest priced product. */
export function parseRates(json: unknown): DhlQuote | null {
  const offers = arr(isObj(json) ? json.products : null).filter(isObj).flatMap((p) => {
    const pr = price(p.totalPrice);
    if (!pr) return [];
    const cap = isObj(p.deliveryCapabilities) ? p.deliveryCapabilities : {};
    const days = num(cap.totalTransitDays);
    return [{
      productName: str(p.productName) ?? 'DHL Express', productCode: str(p.productCode) ?? '', currency: pr.currency, freightCents: pr.cents,
      transitDays: Number.isInteger(days) && days >= 0 ? days : null, estimatedDelivery: str(cap.estimatedDeliveryDateAndTime),
    }];
  });
  if (!offers.length) return null;
  return offers.find((o) => o.productCode === 'P') ?? [...offers].sort((a, b) => a.freightCents - b.freightCents)[0];
}

// ── Landed cost (duties & taxes) ────────────────────────────────────────────

export interface DhlDuties { dutiesCents: number; taxesCents: number; currency: string }

/** Sums duty and tax lines from the landed-cost breakdown; null when DHL returned neither. */
export function parseLandedCost(json: unknown): DhlDuties | null {
  const products = arr(isObj(json) ? json.products : null).filter(isObj);
  let duties = 0, taxes = 0, found = false, currency: string | null = null;
  for (const p of products) {
    for (const block of arr(p.detailedPriceBreakdown).filter(isObj)) {
      currency ??= str(block.priceCurrency);
      for (const line of arr(block.breakdown).filter(isObj)) {
        const label = `${str(line.typeCode) ?? ''} ${str(line.name) ?? ''}`.toUpperCase();
        const c = cents(line.price);
        if (c === null) continue;
        if (/DUTY|DUTIES/.test(label)) { duties += c; found = true; }
        else if (/\bTAX|VAT|GST|EXCISE/.test(label)) { taxes += c; found = true; }
      }
    }
  }
  return found ? { dutiesCents: duties, taxesCents: taxes, currency: (currency ?? 'USD').toUpperCase() } : null;
}

// ── Tracking ────────────────────────────────────────────────────────────────

export interface TrackEvent { at: string; location: string | null; description: string; statusCode: string | null }
export type TrackStageKey = 'picked_up' | 'customs' | 'in_transit' | 'out_for_delivery' | 'delivered';
export interface TrackStage { key: TrackStageKey; label: string; state: 'done' | 'current' | 'upcoming'; at: string | null; location: string | null }
export interface DhlTracking { statusCode: string | null; status: string; estimatedDelivery: string | null; events: TrackEvent[]; stages: TrackStage[] }

export const TRACK_STAGE_LABEL: Record<TrackStageKey, string> = {
  picked_up: 'Shipment picked up', customs: 'Customs clearance', in_transit: 'In transit', out_for_delivery: 'Out for delivery', delivered: 'Delivered',
};
const STAGE_ORDER: TrackStageKey[] = ['picked_up', 'customs', 'in_transit', 'out_for_delivery', 'delivered'];

/** Which stage an event shows (null = informational checkpoint). */
export function eventStage(e: TrackEvent): TrackStageKey | null {
  const d = e.description.toLowerCase();
  if (e.statusCode === 'delivered' || /\bdelivered\b/.test(d)) return 'delivered';
  if (/out for delivery|out with courier|with delivery courier|on (the )?vehicle for delivery/.test(d)) return 'out_for_delivery';
  if (/customs|clearance|clearing/.test(d)) return 'customs';
  if (/picked up|pickup|collected/.test(d)) return 'picked_up';
  if (e.statusCode === 'transit' || /transit|departed|arrived|processed|forwarded/.test(d)) return 'in_transit';
  return null;
}

/**
 * Five-stage timeline. Each stage takes its first matching event's time and place; a later stage
 * reached marks every earlier one done (DHL does not always scan each step). The first open stage
 * is current unless the shipment failed or nothing has been scanned yet.
 */
export function trackingStages(events: readonly TrackEvent[], statusCode: string | null): TrackStage[] {
  const chronological = [...events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const first = new Map<TrackStageKey, TrackEvent>();
  for (const e of chronological) {
    const k = eventStage(e);
    if (k && !first.has(k)) first.set(k, e);
  }
  if (statusCode === 'delivered' && !first.has('delivered') && chronological.length) first.set('delivered', chronological[chronological.length - 1]);
  // Any scan at all means DHL has the parcel.
  if (!first.has('picked_up') && chronological.length) first.set('picked_up', chronological[0]);
  const reached = Math.max(-1, ...STAGE_ORDER.map((k, i) => (first.has(k) ? i : -1)));
  const live = reached >= 0 && statusCode !== 'failure';
  return STAGE_ORDER.map((key, i) => {
    const e = first.get(key) ?? null;
    return {
      key, label: TRACK_STAGE_LABEL[key],
      state: i <= reached ? 'done' : i === reached + 1 && live ? 'current' : 'upcoming',
      at: e?.at ?? null, location: e?.location ?? null,
    };
  });
}

const where = (loc: unknown) => {
  const a = isObj(loc) && isObj(loc.address) ? loc.address : null;
  return a ? str(a.addressLocality) : null;
};

/** GET /api/shipping/track response. */
export type TrackResponse = { configured: false } | { configured: true; waybill: string; tracking: DhlTracking | null };

/** First shipment of a Shipment Tracking (Unified) response; events newest first. */
export function parseTracking(json: unknown): DhlTracking | null {
  const s = arr(isObj(json) ? json.shipments : null).find(isObj);
  if (!s) return null;
  const events: TrackEvent[] = arr(s.events).filter(isObj).flatMap((e) => {
    const at = str(e.timestamp);
    if (!at || Number.isNaN(Date.parse(at))) return [];
    return [{ at, location: where(e.location), description: str(e.description) ?? str(e.status) ?? 'Update', statusCode: str(e.statusCode) }];
  }).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const status = isObj(s.status) ? s.status : {};
  const statusCode = str(status.statusCode);
  return {
    statusCode, status: str(status.description) ?? str(status.status) ?? events[0]?.description ?? 'No scans yet',
    estimatedDelivery: str(s.estimatedTimeOfDelivery), events, stages: trackingStages(events, statusCode),
  };
}

// ── Checkout comparison helpers ─────────────────────────────────────────────

/** Main export hub per supplier country (lib/countries SUPPLIER_COUNTRIES); a listing's `ship_from_city` attribute wins. */
const ORIGIN_HUB: Record<string, string> = {
  US: 'New York', GB: 'London', CA: 'Toronto', FR: 'Paris', DE: 'Frankfurt', IT: 'Milan', ES: 'Madrid', NL: 'Amsterdam',
  BE: 'Brussels', SE: 'Stockholm', KR: 'Seoul', JP: 'Tokyo', CN: 'Guangzhou', AE: 'Dubai', TR: 'Istanbul',
};
export function originCity(countryCode: string, attributes: Record<string, unknown> | null | undefined): string | null {
  const own = text(attributes?.ship_from_city);
  return own.length >= 2 ? own.slice(0, 60) : ORIGIN_HUB[countryCode.toUpperCase()] ?? null;
}

export interface QuoteLine { orderId: string; originCountry: string; attributes: Record<string, unknown> | null; units: number; goodsCents: number; title: string }

/** Σ per-unit `weight_kg` × units when every line lists it (rounded up to 0.5 kg); null otherwise. */
export function suggestedWeightKg(lines: readonly QuoteLine[]): number | null {
  if (!lines.length) return null;
  let kg = 0;
  for (const l of lines) {
    const w = num(l.attributes?.weight_kg);
    if (!(w > 0)) return null;
    kg += w * Math.max(1, l.units);
  }
  return Math.min(300, Math.ceil(kg * 2) / 2);
}

/**
 * A cart ships as one DHL parcel per origin country. The buyer's total weight is split by each
 * group's share of goods value; the box size is the buyer's for every group.
 */
export function splitByOrigin(lines: readonly QuoteLine[], parcel: DhlParcel): { originCountry: string; lines: QuoteLine[]; parcel: DhlParcel; goodsCents: number }[] {
  const groups = new Map<string, QuoteLine[]>();
  for (const l of lines) groups.set(l.originCountry.toUpperCase(), [...(groups.get(l.originCountry.toUpperCase()) ?? []), l]);
  const total = lines.reduce((s, l) => s + l.goodsCents, 0);
  return [...groups].map(([originCountry, ls]) => {
    const goodsCents = ls.reduce((s, l) => s + l.goodsCents, 0);
    const share = total > 0 ? goodsCents / total : 1 / groups.size;
    return { originCountry, lines: ls, goodsCents, parcel: { ...parcel, weightKg: Math.max(0.1, round2(parcel.weightKg * share)) } };
  });
}

export interface QuoteGroup {
  originCountry: string; originCity: string; productName: string; currency: string; freightCents: number;
  transitDays: number | null; estimatedDelivery: string | null; dutiesCents: number | null; taxesCents: number | null;
}
/** POST /api/shipping/rates response. */
export interface ShippingComparison {
  configured: boolean;
  groups?: QuoteGroup[];
  totals?: { currency: string | null; freightCents: number; dutiesCents: number | null; taxesCents: number | null; transitDays: number | null };
}

/**
 * Cart total across origin groups. Currency is null when DHL billed groups in different currencies
 * (then only per-group figures are meaningful); duties / taxes are null unless every group has them.
 */
export function combineQuotes(groups: readonly QuoteGroup[]): NonNullable<ShippingComparison['totals']> {
  const currencies = new Set(groups.map((g) => g.currency));
  const all = (k: 'dutiesCents' | 'taxesCents') => (groups.length && groups.every((g) => g[k] !== null) ? groups.reduce((s, g) => s + (g[k] ?? 0), 0) : null);
  const days = groups.map((g) => g.transitDays).filter((d): d is number => d !== null);
  return {
    currency: currencies.size === 1 ? [...currencies][0] : null,
    freightCents: groups.reduce((s, g) => s + g.freightCents, 0),
    dutiesCents: all('dutiesCents'), taxesCents: all('taxesCents'),
    transitDays: days.length === groups.length && days.length ? Math.max(...days) : null,
  };
}

/** Carrier names that should use DHL tracking ("DHL Express", "DHL"). */
export const isDhlCarrier = (name: string | null | undefined) => !!name && /\bdhl\b/i.test(name);
