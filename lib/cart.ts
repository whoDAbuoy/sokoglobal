/**
 * Cart quantity rules. Quantity = number of Trial Batches of a product
 * (each batch = trial_units units at the Guaranteed Landed Cost).
 * Mirrors Postgres: max_batches_per_line() = 20, at most 10 lines per cart.
 */
export const MAX_BATCHES_PER_LINE = 20;
export const MAX_CART_LINES = 10;

/** Any input ("3", 3.7, -1, NaN) → an integer in 1..MAX_BATCHES_PER_LINE. */
export function clampQuantity(value: unknown): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, MAX_BATCHES_PER_LINE);
}

export interface BatchPricing {
  goods_cents: number;
  freight_cents: number;
  customs_cents: number;
  landed_cost_cents: number;
  trial_units: number;
}

/** Per-line totals for `quantity` batches — the same multiplication Postgres does when it creates the order. */
export function lineTotals(p: BatchPricing, quantity: number) {
  const q = clampQuantity(quantity);
  return {
    quantity: q,
    units: p.trial_units * q,
    goods_cents: p.goods_cents * q,
    freight_cents: p.freight_cents * q,
    customs_cents: p.customs_cents * q,
    landed_cost_cents: p.landed_cost_cents * q,
  };
}

/**
 * Sanitize a cart read back from localStorage: drops malformed entries and
 * duplicates, upgrades pre-quantity carts (quantity missing → 1) and caps lines.
 */
export function normalizeStoredCart<T extends { productId: string }>(raw: unknown): (T & { quantity: number })[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: (T & { quantity: number })[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || typeof (entry as T).productId !== 'string') continue;
    const item = entry as T & { quantity?: unknown };
    if (seen.has(item.productId)) continue;
    seen.add(item.productId);
    out.push({ ...item, quantity: clampQuantity(item.quantity ?? 1) });
    if (out.length >= MAX_CART_LINES) break;
  }
  return out;
}
