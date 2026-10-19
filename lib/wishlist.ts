/**
 * Wishlist ids for one user, persisted in localStorage. Pure helpers here;
 * the React hook lives in hooks/useWishlist.ts. Saved products are a browsing
 * convenience only — nothing on the server reads them.
 */
export const WISHLIST_MAX = 100;

export const wishlistKey = (userId: string | undefined) => `sokoglobal.wishlist.v1:${userId ?? 'guest'}`;

/** Parse whatever is stored; keeps unique non-empty string ids, newest last, capped. */
export function parseWishlist(raw: string | null): string[] {
  try {
    const parsed = JSON.parse(raw ?? '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    const ids = [...new Set(parsed.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 64))];
    return ids.slice(-WISHLIST_MAX);
  } catch { return []; }
}

/** Add if missing, remove if present. */
export function toggleId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id].slice(-WISHLIST_MAX);
}
