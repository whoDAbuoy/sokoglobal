/**
 * Pure read-model helpers for the supplier overview (Sellsy layout): growth pills, the daily sales
 * spline, the weekday × time-of-day heatmap, the category donut and the per-product sales table.
 * Presentation only: they summarise rows the page already loaded and never touch money rules
 * (escrow, commission, payouts stay in Postgres and lib/payments).
 */

const DAY_MS = 86_400_000;

export interface DatedValue { created_at: string; cents: number }

/** UTC midnight of the day `d` falls on. */
const utcDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

/**
 * Percent change of the last `days` against the `days` before them, rounded to a whole number.
 * null when there is nothing to compare with (no rows in the earlier window).
 */
export function growthPct(isoDates: string[], now: Date, days = 30): number | null {
  const end = now.getTime();
  const mid = end - days * DAY_MS;
  const start = mid - days * DAY_MS;
  let recent = 0;
  let before = 0;
  for (const iso of isoDates) {
    const t = Date.parse(iso);
    if (Number.isNaN(t) || t > end) continue;
    if (t > mid) recent += 1;
    else if (t > start) before += 1;
  }
  if (before === 0) return null;
  return Math.round(((recent - before) / before) * 100);
}

/** Rows in the last `days` (for "+N this month" captions). */
export function countSince(isoDates: string[], now: Date, days = 30): number {
  const from = now.getTime() - days * DAY_MS;
  return isoDates.filter((iso) => { const t = Date.parse(iso); return t > from && t <= now.getTime(); }).length;
}

export interface DayPoint { date: string; label: string; cents: number }

const DAY_LABEL = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** One point per UTC day for the last `days` days (oldest first, today last), summing `cents`. */
export function dailySeries(rows: DatedValue[], now: Date, days = 30): DayPoint[] {
  const today = utcDay(now);
  const first = today - (days - 1) * DAY_MS;
  const out: DayPoint[] = Array.from({ length: days }, (_, i) => {
    const t = first + i * DAY_MS;
    return { date: new Date(t).toISOString().slice(0, 10), label: DAY_LABEL.format(t), cents: 0 };
  });
  for (const r of rows) {
    const t = Date.parse(r.created_at);
    if (Number.isNaN(t)) continue;
    const i = Math.floor((utcDay(new Date(t)) - first) / DAY_MS);
    if (i >= 0 && i < days) out[i].cents += r.cents ?? 0;
  }
  return out;
}

/**
 * Trailing moving average over `window` points (shorter at the start), so a sparse daily series
 * reads as a trend line. Values stay in cents and are rounded.
 */
export function rollingAverage(values: number[], window = 7): number[] {
  let sum = 0;
  return values.map((v, i) => {
    sum += v;
    if (i >= window) sum -= values[i - window];
    return Math.round(sum / Math.min(window, i + 1));
  });
}

export const HEAT_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
/** Four-hour UTC slots, labelled by their start. */
export const HEAT_SLOTS = ['00:00', '04:00', '08:00', '12:00', '16:00', '20:00'] as const;

export interface Heatmap { cells: number[][]; max: number; total: number }

/** Orders per weekday (Mon–Sun columns) × four-hour slot (rows), in UTC. */
export function orderHeatmap(isoDates: string[]): Heatmap {
  const cells = HEAT_SLOTS.map(() => HEAT_DAYS.map(() => 0));
  let total = 0;
  for (const iso of isoDates) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) continue;
    const col = (d.getUTCDay() + 6) % 7; // Monday first
    const row = Math.floor(d.getUTCHours() / 4);
    cells[row][col] += 1;
    total += 1;
  }
  return { cells, max: Math.max(0, ...cells.flat()), total };
}

/** 0 (none) … 4 (busiest) intensity step for a heatmap cell. */
export function heatLevel(count: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0 || max <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((count / max) * 4))) as 1 | 2 | 3 | 4;
}

export interface Share { key: string; label: string; cents: number; pct: number }

/**
 * Top `top` categories by value, the rest folded into "Other". Percentages are whole numbers that
 * add up to exactly 100 (largest-remainder rounding). Empty input → [].
 */
export function categoryShares(rows: { category: string; cents: number }[], top = 3): Share[] {
  const sums = new Map<string, number>();
  for (const r of rows) if (r.cents > 0) sums.set(r.category, (sums.get(r.category) ?? 0) + r.cents);
  const sorted = [...sums].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const total = sorted.reduce((n, [, c]) => n + c, 0);
  if (!total) return [];
  const head = sorted.slice(0, top);
  const rest = sorted.slice(top).reduce((n, [, c]) => n + c, 0);
  const parts = head.map(([key, cents]) => ({ key, label: key.charAt(0).toUpperCase() + key.slice(1), cents }));
  if (rest > 0) parts.push({ key: 'other', label: 'Other', cents: rest });
  const raw = parts.map((p) => (p.cents / total) * 100);
  const pct = raw.map(Math.floor);
  let left = 100 - pct.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => [v - Math.floor(v), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) { if (left <= 0) break; pct[i] += 1; left -= 1; }
  return parts.map((p, i) => ({ ...p, pct: pct[i] }));
}

export interface Pt { x: number; y: number }

/**
 * Smooth SVG path through the points (Catmull-Rom → cubic Bézier). Control points are clamped to
 * [minY, maxY] so the curve never dips below the baseline or above the top between data points.
 */
export function splinePath(pts: Pt[], minY = -Infinity, maxY = Infinity, tension = 0.5): string {
  if (!pts.length) return '';
  const f = (n: number) => Math.round(n * 100) / 100;
  if (pts.length === 1) return `M${f(pts[0].x)},${f(pts[0].y)}`;
  const clamp = (y: number) => Math.min(maxY, Math.max(minY, y));
  let d = `M${f(pts[0].x)},${f(pts[0].y)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const k = tension / 3;
    const c1 = { x: p1.x + (p2.x - p0.x) * k, y: clamp(p1.y + (p2.y - p0.y) * k) };
    const c2 = { x: p2.x - (p3.x - p1.x) * k, y: clamp(p2.y - (p3.y - p1.y) * k) };
    d += ` C${f(c1.x)},${f(c1.y)} ${f(c2.x)},${f(c2.y)} ${f(p2.x)},${f(p2.y)}`;
  }
  return d;
}

export interface ProductSale { id: string; orders: number; batches: number; earningsCents: number }

/**
 * Per-product sales for the Recent sales table: order count, batches and goods value earned,
 * skipping refunded / cancelled orders. Sorted by earnings, then orders.
 */
export function productSales(
  orders: { product_id: string; goods_cents: number | null; batches: number | null; escrow_status: string }[],
): ProductSale[] {
  const by = new Map<string, ProductSale>();
  for (const o of orders) {
    if (o.escrow_status === 'refunded' || o.escrow_status === 'cancelled') continue;
    const s = by.get(o.product_id) ?? { id: o.product_id, orders: 0, batches: 0, earningsCents: 0 };
    s.orders += 1;
    s.batches += o.batches ?? 1;
    s.earningsCents += o.goods_cents ?? 0;
    by.set(o.product_id, s);
  }
  return [...by.values()].sort((a, b) => b.earningsCents - a.earningsCents || b.orders - a.orders);
}

/** Compact money for chart axes and tooltips: $950, $1.2k, $34k, $1.5M. */
export function compactUSD(cents: number): string {
  const d = cents / 100;
  if (Math.abs(d) >= 1_000_000) return `$${(d / 1_000_000).toFixed(d >= 10_000_000 ? 0 : 1).replace(/\.0$/, '')}M`;
  if (Math.abs(d) >= 1_000) return `$${(d / 1_000).toFixed(d >= 10_000 ? 0 : 1).replace(/\.0$/, '')}k`;
  return `$${Math.round(d)}`;
}
