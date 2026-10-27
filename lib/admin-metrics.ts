/**
 * Pure helpers for the admin Overview dashboard (no React, no Supabase), so the
 * numbers shown to ops are unit-tested. Inputs are rows the admin RLS policies
 * already let an admin read (orders, escrow_events, products) and the
 * admin_order_metrics() totals.
 */
import type { EscrowStatus } from './types';

export const DAY_MS = 86_400_000;

/** Percentage change from `previous` to `current`, rounded to 1 dp. null when there is no baseline. */
export function percentChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/** "+18.2%" / "-8.7%" / "0%" — or "New" when there was nothing last period. */
export function formatChange(change: number | null, current = 0): string {
  if (change === null) return current > 0 ? 'New' : '—';
  if (change === 0) return '0%';
  return `${change > 0 ? '+' : ''}${change}%`;
}

/** Rolling window [now - days*offsetEnd... ] helper: start/end ISO strings for "this period" and "last period". */
export function periodWindows(now: Date, days: number) {
  const end = now.getTime();
  const start = end - days * DAY_MS;
  const prevStart = start - days * DAY_MS;
  const iso = (t: number) => new Date(t).toISOString();
  return { current: { from: iso(start), to: iso(end) }, previous: { from: iso(prevStart), to: iso(start) } };
}

/** Admin transaction status pill (Paid / Pending / Refunded …) for an order's escrow status. */
export type TxnTone = 'success' | 'warning' | 'danger' | 'muted' | 'escrow';
export function txnStatus(status: EscrowStatus): { label: string; tone: TxnTone } {
  switch (status) {
    case 'pending_payment': return { label: 'Pending', tone: 'warning' };
    case 'deposit_paid': return { label: 'Deposit paid', tone: 'escrow' };
    case 'funded':
    case 'in_transit':
    case 'customs_cleared':
    case 'delivered_pending_verification': return { label: 'Paid', tone: 'escrow' };
    case 'released': return { label: 'Released', tone: 'success' };
    case 'disputed': return { label: 'Disputed', tone: 'danger' };
    case 'refunded': return { label: 'Refunded', tone: 'muted' };
    case 'cancelled': return { label: 'Cancelled', tone: 'muted' };
    default: return { label: String(status).replace(/_/g, ' '), tone: 'muted' };
  }
}

/** Transaction table filter → the escrow statuses it covers. '' = everything. */
export const TXN_FILTERS = [
  ['', 'All'],
  ['paid', 'Paid'],
  ['pending', 'Pending'],
  ['released', 'Released'],
  ['disputed', 'Disputed'],
  ['refunded', 'Refunded'],
] as const;
export type TxnFilter = (typeof TXN_FILTERS)[number][0];

export function txnFilterStatuses(filter: string): EscrowStatus[] | null {
  switch (filter) {
    case 'paid': return ['deposit_paid', 'funded', 'in_transit', 'customs_cleared', 'delivered_pending_verification'];
    case 'pending': return ['pending_payment'];
    case 'released': return ['released'];
    case 'disputed': return ['disputed'];
    case 'refunded': return ['refunded', 'cancelled'];
    default: return null;
  }
}

/** "Paid by" badge. orders.payment_provider is set by the payment functions; card brand is not stored. */
export type PaymentKind = 'mpesa' | 'card' | 'flutterwave' | 'other' | 'none';
export function paymentMethod(provider: string | null | undefined): { label: string; kind: PaymentKind } {
  const p = (provider ?? '').toLowerCase();
  if (!p) return { label: '—', kind: 'none' };
  if (p === 'mpesa' || p === 'm-pesa' || p === 'daraja') return { label: 'M-Pesa', kind: 'mpesa' };
  if (p === 'paystack' || p === 'card' || p === 'stripe') return { label: 'Card', kind: 'card' };
  if (p === 'flutterwave') return { label: 'Flutterwave', kind: 'flutterwave' };
  return { label: provider!, kind: 'other' };
}

/**
 * Page buttons for a paginator: 1-based, with '…' gaps, always showing the
 * first and last page and the neighbours of the current one.
 */
export function pageList(current: number, totalPages: number): (number | '…')[] {
  if (totalPages <= 1) return [1];
  const keep = new Set([1, totalPages, current - 1, current, current + 1].filter((n) => n >= 1 && n <= totalPages));
  const sorted = [...keep].sort((a, b) => a - b);
  const out: (number | '…')[] = [];
  for (const n of sorted) {
    const last = out[out.length - 1];
    if (typeof last === 'number' && n - last === 2) out.push(last + 1);
    else if (typeof last === 'number' && n - last > 2) out.push('…');
    out.push(n);
  }
  return out;
}

/** Clamp a ?page= value to a valid 1-based page. */
export function parsePage(value: string | undefined, totalPages = Number.POSITIVE_INFINITY): number {
  const n = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, Math.max(1, totalPages));
}

/** admin_order_metrics() (migration 041): figures over every paid order, summed in Postgres. */
export interface OrderMetricsRow {
  paid_count: number;
  gmv: number;
  held: number;
  released: number;
  refunded: number;
  disputed: number;
  buyers: number;
  repeat_buyers: number;
  by_category: { category: string; cents: number }[];
  /** Rolling 30 days ending now, by orders.payment_provider. */
  month: { gmv: number; by_provider: { provider: string; cents: number; count: number }[] };
  prev_month_gmv: number;
  /** Orders paid per UTC day ('YYYY-MM-DD'), last 7 days. */
  paid_days: Record<string, number>;
}

/** Money and buyer-cohort figures for the overview, with the percentages and payment-method labels derived. */
export function orderMetrics(row: OrderMetricsRow) {
  const byMethod = new Map<string, { label: string; kind: PaymentKind; cents: number; count: number }>();
  for (const p of row.month.by_provider) {
    const m = paymentMethod(p.provider || null);
    const entry = byMethod.get(m.label) ?? { ...m, cents: 0, count: 0 };
    entry.cents += Number(p.cents); entry.count += Number(p.count);
    byMethod.set(m.label, entry);
  }
  const paidCount = Number(row.paid_count), gmv = Number(row.gmv), held = Number(row.held), released = Number(row.released);
  const buyers = Number(row.buyers), repeatBuyers = Number(row.repeat_buyers);
  const settledBase = held + released;
  return {
    paidCount,
    gmv,
    held,
    released,
    refunded: Number(row.refunded),
    disputesOpen: Number(row.disputed),
    avgOrder: paidCount ? Math.round(gmv / paidCount) : 0,
    /** Share of escrow value (held + released) already released to suppliers, 0–100. */
    settledPct: settledBase ? Math.round((released / settledBase) * 100) : 0,
    buyers,
    repeatBuyers,
    /** Share of buyers with 2+ paid orders, 0–100. */
    repeatPct: buyers ? Math.round((repeatBuyers / buyers) * 100) : 0,
    byCategory: row.by_category.map((c) => ({ category: c.category, cents: Number(c.cents) })),
    month: { gmv: Number(row.month.gmv), byMethod: [...byMethod.values()].sort((a, b) => b.cents - a.cents) },
    prevMonthGmv: Number(row.prev_month_gmv),
  };
}

/** Per-day counts keyed 'YYYY-MM-DD' (UTC) → the `days` days ending today, oldest first. */
export function dailyCountsByDay(byDay: Readonly<Record<string, number>>, now: Date, days = 7): number[] {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Array.from({ length: days }, (_, i) => Number(byDay[new Date(today - (days - 1 - i) * DAY_MS).toISOString().slice(0, 10)] ?? 0));
}

/** Count of ISO timestamps per day for the `days` days ending today (UTC), oldest first. */
export function dailyCounts(timestamps: readonly (string | null)[], now: Date, days = 7): number[] {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const out = new Array<number>(days).fill(0);
  for (const ts of timestamps) {
    if (!ts) continue;
    const t = Date.parse(ts);
    if (Number.isNaN(t)) continue;
    const d = new Date(t);
    const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const idx = days - 1 - Math.round((today - day) / DAY_MS);
    if (idx >= 0 && idx < days) out[idx] += 1;
  }
  return out;
}

/** Bar heights (0–100) relative to the largest value; all-zero input stays flat. */
export function barHeights(values: readonly number[], minPct = 8): number[] {
  const max = Math.max(0, ...values);
  if (max <= 0) return values.map(() => minPct);
  return values.map((v) => Math.max(minPct, Math.round((v / max) * 100)));
}

/** How many of `total` dots to fill for a 0–100 percentage. */
export function filledDots(pct: number, total: number): number {
  if (!Number.isFinite(pct) || total <= 0) return 0;
  return Math.round((Math.min(100, Math.max(0, pct)) / 100) * total);
}

/** Escape a user search term for a PostgREST ilike pattern. */
export const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, '\\$&')}%`;
