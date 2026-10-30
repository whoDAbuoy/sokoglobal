/**
 * Trending products and Trend Pools (migration 043), pure helpers for /dashboard/pools.
 * The ranking itself runs in Postgres (trending_products / trending_pools); this file turns its counts into
 * words and orders the pool list.
 */

export interface TrendingRow {
  product_id: string; score: number; buyers: number; orders: number; pledges: number; inquiries: number; saves: number; views: number;
}

export const TRENDING_DAYS = 14;

/** Rows from the RPC (numeric columns may arrive as strings) → typed rows; anything malformed is dropped. */
export function parseTrending(raw: unknown): TrendingRow[] {
  if (!Array.isArray(raw)) return [];
  const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return raw.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object' && typeof (r as { product_id?: unknown }).product_id === 'string')
    .map((r) => ({
      product_id: r.product_id as string, score: n(r.score), buyers: n(r.buyers), orders: n(r.orders), pledges: n(r.pledges),
      inquiries: n(r.inquiries), saves: n(r.saves), views: n(r.views),
    }));
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** The one-line reason under a trending card, strongest signal first: "3 orders · 5 buyers interested". */
export function trendingReason(r: TrendingRow): string {
  const parts: string[] = [];
  if (r.orders) parts.push(plural(r.orders, 'order'));
  if (r.pledges) parts.push(plural(r.pledges, 'pool pledge'));
  if (r.inquiries) parts.push(plural(r.inquiries, 'inquiry', 'inquiries'));
  if (!parts.length && r.saves) parts.push(plural(r.saves, 'save'));
  if (r.buyers > 1) parts.push(`${r.buyers} buyers interested`);
  else if (!parts.length) parts.push('Getting attention');
  return parts.slice(0, 2).join(' · ');
}

export const POOL_SORTS = [['trending', 'Trending'], ['closing', 'Closing soon'], ['funded', 'Most funded'], ['new', 'Newest']] as const;
export type PoolSort = (typeof POOL_SORTS)[number][0];
export const parsePoolSort = (v: unknown): PoolSort =>
  typeof v === 'string' && POOL_SORTS.some(([s]) => s === v) ? (v as PoolSort) : 'trending';

export interface SortablePool { id: string; deadline: string; pledged_cents: number; target_cents: number; created_at?: string | null }

/** Pools in the chosen order. Trending uses the database score (pools without one keep their deadline order after). */
export function sortPools<T extends SortablePool>(pools: T[], sort: PoolSort, scores: Map<string, number>): T[] {
  const byDeadline = (a: T, b: T) => a.deadline.localeCompare(b.deadline);
  const fill = (p: T) => (p.target_cents > 0 ? p.pledged_cents / p.target_cents : 0);
  const copy = [...pools];
  if (sort === 'closing') return copy.sort(byDeadline);
  if (sort === 'funded') return copy.sort((a, b) => fill(b) - fill(a) || byDeadline(a, b));
  if (sort === 'new') return copy.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? '') || byDeadline(a, b));
  return copy.sort((a, b) => (scores.get(b.id) ?? -1) - (scores.get(a.id) ?? -1) || byDeadline(a, b));
}
