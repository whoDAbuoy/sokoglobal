/**
 * Supplier star ratings (pure). Contract: public.supplier_ratings, supplier_rating() and can_rate_supplier()
 * in migration 032 — Postgres decides who may rate whom; this only formats.
 */

export type StarFill = 'full' | 'half' | 'empty';

/** Five stars for an average, rounded to the nearest half star. null / unrated → five empty stars. */
export function starFills(average: number | null): StarFill[] {
  const half = average === null || !Number.isFinite(average) ? 0 : Math.round(Math.min(5, Math.max(0, average)) * 2);
  return [0, 1, 2, 3, 4].map((i) => (half >= (i + 1) * 2 ? 'full' : half === i * 2 + 1 ? 'half' : 'empty'));
}

/** "4.5 · 12 ratings", "5.0 · 1 rating", "No ratings yet". */
export function ratingLabel(average: number | null, count: number): string {
  if (!count || average === null || !Number.isFinite(average)) return 'No ratings yet';
  return `${average.toFixed(1)} · ${count} rating${count === 1 ? '' : 's'}`;
}

/** A valid 1–5 star value from untrusted input, else null. */
export function parseStars(v: unknown): 1 | 2 | 3 | 4 | 5 | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 5 ? (n as 1 | 2 | 3 | 4 | 5) : null;
}
