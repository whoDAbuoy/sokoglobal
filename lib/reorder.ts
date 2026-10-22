/**
 * Quick reorder and restock reminders (pure). Reorders refill the cart only:
 * checkout re-prices every line in Postgres, so a stale snapshot can never
 * change what the buyer pays. Restock timing mirrors queue_restock_reminders()
 * in migration 021.
 */
import { MAX_CART_LINES, clampQuantity } from './cart';
import type { ProductCategory } from './types';

export interface ReorderSource {
  order_id: string;
  product_id: string;
  /** Trial Batches in the past order (orders.batches). */
  batches: number | null;
  completed_at: string | null;
  /** Live listing data, or null when the listing is gone. */
  product: {
    status: string; title: string; supplier_name: string; image_url: string | null; category: ProductCategory;
    /** Guaranteed Landed Cost of one Trial Batch today. */
    landed_cost_cents: number;
  } | null;
}

export interface ReorderLine {
  productId: string; title: string; supplierName: string; imageUrl: string | null; category: ProductCategory;
  landedCostCents: number; quantity: number; fromOrderId: string;
}

/**
 * Cart lines for "Reorder": one per listing (its most recent completed order
 * wins), same batch count, live listings only, at most a full cart.
 */
export function reorderLines(orders: readonly ReorderSource[]): { lines: ReorderLine[]; unavailable: string[] } {
  const ts = (s: string | null) => (s ? Date.parse(s) : 0);
  const latest = new Map<string, ReorderSource>();
  for (const o of orders) {
    const prev = latest.get(o.product_id);
    if (!prev || ts(o.completed_at) > ts(prev.completed_at)) latest.set(o.product_id, o);
  }
  const lines: ReorderLine[] = [];
  const unavailable: string[] = [];
  for (const o of [...latest.values()].sort((a, b) => ts(b.completed_at) - ts(a.completed_at))) {
    const p = o.product;
    if (!p || p.status !== 'live' || !(p.landed_cost_cents > 0)) { unavailable.push(o.order_id); continue; }
    if (lines.length >= MAX_CART_LINES) continue;
    lines.push({
      productId: o.product_id, title: p.title, supplierName: p.supplier_name, imageUrl: p.image_url, category: p.category,
      landedCostCents: p.landed_cost_cents, quantity: clampQuantity(o.batches ?? 1), fromOrderId: o.order_id,
    });
  }
  return { lines, unavailable };
}

export const RESTOCK_DAYS = [30, 60] as const;
/** Grace window so a missed daily run still sends the reminder. */
export const RESTOCK_WINDOW_DAYS = 7;

/** Which reminder (30 or 60 days) is due for an order completed at `completedAt`, if any. */
export function restockDue(completedAt: string | null, now = Date.now()): 30 | 60 | null {
  if (!completedAt) return null;
  const days = (now - Date.parse(completedAt)) / 86_400_000;
  for (const d of RESTOCK_DAYS) if (days >= d && days <= d + RESTOCK_WINDOW_DAYS) return d;
  return null;
}
