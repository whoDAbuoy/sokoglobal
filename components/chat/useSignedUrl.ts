'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { CHAT_BUCKET } from '@/lib/chat-media';

const TTL_S = 3600;
const cache = new Map<string, { url: string; expires: number }>();

/**
 * Short-lived signed URL for a chat attachment (private bucket; Storage RLS lets
 * only the order's buyer and supplier sign it). Cached per tab and renewed
 * five minutes before expiry. `download` adds Content-Disposition with that name.
 */
export function useSignedUrl(path: string | null, download?: string) {
  const key = path ? `${path}|${download ?? ''}` : '';
  const [state, setState] = useState<{ url: string | null; error: string | null }>(() => {
    const hit = key ? cache.get(key) : undefined;
    return { url: hit && hit.expires > Date.now() ? hit.url : null, error: null };
  });

  useEffect(() => {
    if (!path) return;
    let active = true;
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) { setState({ url: hit.url, error: null }); return; }
    void createClient().storage.from(CHAT_BUCKET).createSignedUrl(path, TTL_S, download ? { download } : undefined).then(({ data, error }) => {
      if (!active) return;
      if (error || !data?.signedUrl) { setState({ url: null, error: 'Attachment unavailable' }); return; }
      cache.set(key, { url: data.signedUrl, expires: Date.now() + (TTL_S - 300) * 1000 });
      setState({ url: data.signedUrl, error: null });
    });
    return () => { active = false; };
  }, [key, path, download]);

  return state;
}
