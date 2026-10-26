/**
 * Indicative import-cost calculator for the buyer dashboard (pure, display only — nothing here prices an
 * order; Trial Batches carry their own Guaranteed Landed Cost computed in Postgres).
 *
 * Kenya, East African Community Common External Tariff (EAC CET). Customs value is taken as CIF
 * (goods + freight; insurance ignored). Import duty = CIF × CET band (0 for goods of EAC origin);
 * Import Declaration Fee 3.5 % and Railway Development Levy 2 % of CIF; VAT 16 % of (CIF + duty).
 * Excise duty, exemptions and KRA's own valuation are not modelled — the widget says it is an estimate.
 */

export const ORIGINS = [
  { code: 'CN', label: 'China', eac: false },
  { code: 'TR', label: 'Turkey', eac: false },
  { code: 'AE', label: 'UAE', eac: false },
  { code: 'US', label: 'USA', eac: false },
  { code: 'GB', label: 'United Kingdom', eac: false },
  { code: 'EU', label: 'European Union', eac: false },
  { code: 'UG', label: 'Uganda (EAC)', eac: true },
  { code: 'TZ', label: 'Tanzania (EAC)', eac: true },
] as const;
export type OriginCode = (typeof ORIGINS)[number]['code'];

/** EAC CET bands (2022 structure). */
export const DUTY_BANDS = [
  { rate: 0, label: '0 % · raw materials, capital goods' },
  { rate: 0.1, label: '10 % · intermediate goods' },
  { rate: 0.25, label: '25 % · finished goods' },
  { rate: 0.35, label: '35 % · sensitive goods (some textiles, dairy…)' },
] as const;

export const KE_IDF = 0.035;
export const KE_RDL = 0.02;
export const KE_VAT = 0.16;

export interface LandedEstimate {
  cifCents: number; dutyCents: number; idfCents: number; rdlCents: number; vatCents: number;
  /** Duties and taxes only (duty + IDF + RDL + VAT). */
  taxesCents: number;
  /** Goods + freight + duties and taxes. */
  totalCents: number;
}

const r = (n: number) => Math.round(n);

export function estimateKenyaLanded({ goodsCents, freightCents, origin, dutyRate }: {
  goodsCents: number; freightCents: number; origin: OriginCode; dutyRate: number;
}): LandedEstimate {
  const goods = Math.max(0, Number.isFinite(goodsCents) ? goodsCents : 0);
  const freight = Math.max(0, Number.isFinite(freightCents) ? freightCents : 0);
  const eac = ORIGINS.find((o) => o.code === origin)?.eac ?? false;
  const cif = goods + freight;
  const duty = eac ? 0 : r(cif * Math.max(0, dutyRate));
  const idf = r(cif * KE_IDF);
  const rdl = r(cif * KE_RDL);
  const vat = r((cif + duty) * KE_VAT);
  const taxes = duty + idf + rdl + vat;
  return { cifCents: cif, dutyCents: duty, idfCents: idf, rdlCents: rdl, vatCents: vat, taxesCents: taxes, totalCents: cif + taxes };
}

/**
 * Freight as a share of goods value seen on live listings, per origin country (from Trial Batches the page
 * already loaded). Used only to pre-fill the freight field; null when there is nothing to go on.
 */
export function freightShareByOrigin(listings: { origin_country: string; goods_cents: number; freight_cents: number }[]): Record<string, number> {
  const sums = new Map<string, { goods: number; freight: number }>();
  for (const l of listings) {
    if (!(l.goods_cents > 0) || !(l.freight_cents >= 0)) continue;
    const s = sums.get(l.origin_country) ?? { goods: 0, freight: 0 };
    s.goods += l.goods_cents; s.freight += l.freight_cents;
    sums.set(l.origin_country, s);
  }
  const out: Record<string, number> = {};
  for (const [k, v] of sums) if (v.goods > 0) out[k] = Math.round((v.freight / v.goods) * 1000) / 1000;
  return out;
}
