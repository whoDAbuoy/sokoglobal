/**
 * Following suppliers (pure). Contract: public.follows and supplier_follower_count()
 * in migration 030 — Postgres decides who may follow whom; this only formats.
 */

/** "No followers yet", "1 follower", "940 followers", "1.2k followers". */
export function followerLabel(count: number): string {
  const n = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  if (n === 0) return 'No followers yet';
  if (n === 1) return '1 follower';
  if (n < 1000) return `${n} followers`;
  const k = n / 1000;
  return `${k >= 100 ? Math.round(k) : Number(k.toFixed(1))}k followers`;
}

/** A copy of `ids` with `id` added or removed (the client follow store never mutates in place). */
export function withFollow(ids: ReadonlySet<string>, id: string, following: boolean): Set<string> {
  const next = new Set(ids);
  if (following) next.add(id); else next.delete(id);
  return next;
}

/** The Follow button is hidden on your own supplier account and on sample (demo) listings. */
export function canFollow(supplierId: string | null | undefined, viewerId: string | null | undefined, isDemo = false): boolean {
  return !!supplierId && !isDemo && supplierId !== viewerId;
}
