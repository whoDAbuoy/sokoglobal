'use client';

import { useCallback, useEffect, useState } from 'react';
import { parseMuted, toggleMuted } from '@/lib/admin-inbox';

const KEY = 'sg-admin-muted-tickets';
const EVENT = 'sg-muted-tickets-change';

function read(): string[] {
  try { return parseMuted(window.localStorage.getItem(KEY)); } catch { return []; }
}

/**
 * Muted support threads — a per-browser preference for this agent (no new
 * database column). A muted thread still gets replies; it just stops raising
 * the "new message" toast and is marked in the list.
 */
export function useMutedTickets() {
  const [muted, setMuted] = useState<string[]>([]);
  useEffect(() => {
    setMuted(read());
    const sync = () => setMuted(read());
    window.addEventListener('storage', sync);
    window.addEventListener(EVENT, sync);
    return () => { window.removeEventListener('storage', sync); window.removeEventListener(EVENT, sync); };
  }, []);

  const setMutedFor = useCallback((id: string, value: boolean) => {
    const next = toggleMuted(read(), id, value);
    try { window.localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage blocked: keep in memory */ }
    setMuted(next);
    window.dispatchEvent(new Event(EVENT));
  }, []);

  return { muted, isMuted: (id: string) => muted.includes(id), setMutedFor };
}
