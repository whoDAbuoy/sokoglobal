'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { useAuth } from '@/context/AuthContext';
import { parseWishlist, toggleId, wishlistKey } from '@/lib/wishlist';

// One shared subscription for every card on the page; also follows other tabs.
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => { if (e.key?.startsWith('sokoglobal.wishlist.')) listener(); };
  window.addEventListener('storage', onStorage);
  return () => { listeners.delete(listener); window.removeEventListener('storage', onStorage); };
}
const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };

/** Per-user saved products (localStorage). Snapshot is the raw string so React can compare it cheaply. */
export function useWishlist() {
  const { user } = useAuth();
  const key = wishlistKey(user?.id);
  const raw = useSyncExternalStore(subscribe, () => read(key), () => null);
  const ids = parseWishlist(raw);

  const toggle = useCallback((id: string) => {
    const next = toggleId(parseWishlist(read(key)), id);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* private mode */ }
    notify();
    return next.includes(id);
  }, [key]);

  return { ids, has: (id: string) => ids.includes(id), toggle };
}
