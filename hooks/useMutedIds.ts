'use client';

import { useCallback, useEffect, useState } from 'react';
import { parseMuted, toggleMuted } from '@/lib/admin-inbox';

const EVENT = 'sg-muted-ids-change';

/**
 * A per-browser list of muted conversation ids (localStorage, never the
 * database). Tabs stay in sync via the storage event. `storageKey` separates
 * lists (admin support tickets vs portal chats).
 */
export function useMutedIds(storageKey: string) {
  const read = useCallback((): string[] => {
    try { return parseMuted(window.localStorage.getItem(storageKey)); } catch { return []; }
  }, [storageKey]);
  const [muted, setMuted] = useState<string[]>([]);

  useEffect(() => {
    setMuted(read());
    const sync = (e?: Event) => {
      if (e instanceof StorageEvent && e.key !== null && e.key !== storageKey) return;
      setMuted(read());
    };
    window.addEventListener('storage', sync);
    window.addEventListener(EVENT, sync);
    return () => { window.removeEventListener('storage', sync); window.removeEventListener(EVENT, sync); };
  }, [read, storageKey]);

  const setMutedFor = useCallback((id: string, value: boolean) => {
    const next = toggleMuted(read(), id, value);
    try { window.localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* storage blocked: keep in memory */ }
    setMuted(next);
    window.dispatchEvent(new Event(EVENT));
  }, [read, storageKey]);

  return { muted, isMuted: (id: string) => muted.includes(id), setMutedFor };
}
