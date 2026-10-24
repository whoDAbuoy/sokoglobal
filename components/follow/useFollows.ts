'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { createClient } from '@/lib/supabase/client';
import { withFollow } from '@/lib/follows';

/**
 * The signed-in user's followed supplier ids, shared by every Follow button on the page:
 * one RLS-scoped read (`follows: read own`) however many cards render, and a toggle on one
 * card updates the rest. Until that read lands a button shows what its server page knew
 * (`fallback`), so server HTML and hydration always agree. Render never writes this store.
 */
interface State { ids: ReadonlySet<string>; known: ReadonlySet<string>; loaded: boolean }
const SERVER_STATE: State = { ids: new Set(), known: new Set(), loaded: false };
let state: State = SERVER_STATE;
let loading = false;
const listeners = new Set<() => void>();
const set = (next: State) => { state = next; listeners.forEach((l) => l()); };

function load() {
  if (state.loaded || loading) return;
  loading = true;
  void (async () => {
    const { data, error } = await createClient().from('follows').select('following_id').limit(1000);
    loading = false;
    if (error) return;
    // Rows from the database, except ids toggled on this page meanwhile (those are newer).
    let ids: ReadonlySet<string> = new Set((data ?? []).map((r) => r.following_id as string));
    for (const id of state.known) ids = withFollow(ids, id, state.ids.has(id));
    set({ ids, known: state.known, loaded: true });
  })();
}

/** Record a confirmed (or optimistic) follow state for one supplier. */
export function setFollowed(id: string, following: boolean) {
  set({ ids: withFollow(state.ids, id, following), known: new Set([...state.known, id]), loaded: state.loaded });
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export function useFollows() {
  const s = useSyncExternalStore(subscribe, () => state, () => SERVER_STATE);
  useEffect(load, []);
  const isFollowing = useCallback((id: string, fallback = false) => (s.loaded || s.known.has(id) ? s.ids.has(id) : fallback), [s]);
  return { isFollowing };
}
