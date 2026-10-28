import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { contentMatches, SNIFF_BYTES } from '@/lib/file-signature';

/**
 * First bytes of a stored file through a URL (public or signed): a Range request, and at most the first chunk
 * of the body is read even if storage ignores the range, so a 500 MB video is never downloaded. null when the
 * file can't be read.
 */
export async function readHead(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url, { headers: { Range: `bytes=0-${SNIFF_BYTES - 1}` }, signal: AbortSignal.timeout(5000), cache: 'no-store' });
    if (!res.ok || !res.body) return null;
    const reader = res.body.getReader();
    const head = new Uint8Array(SNIFF_BYTES);
    let filled = 0;
    while (filled < SNIFF_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      const take = Math.min(value.length, SNIFF_BYTES - filled);
      head.set(value.subarray(0, take), filled);
      filled += take;
    }
    await reader.cancel().catch(() => undefined);
    return head.subarray(0, filled);
  } catch {
    return null;
  }
}

/** True when the file at `url` really is `declaredMime`; false when it isn't or can't be read. */
export async function urlContentMatches(url: string, declaredMime: string): Promise<boolean> {
  const head = await readHead(url);
  return !!head && contentMatches(declaredMime, head);
}

/** Upload-time check for a private bucket: signs a one-minute URL with the service role, then reads the first bytes. */
export async function storedFileMatches(bucket: string, path: string, declaredMime: string): Promise<boolean> {
  const { data, error } = await createAdminClient().storage.from(bucket).createSignedUrl(path, 60);
  return !error && !!data && urlContentMatches(data.signedUrl, declaredMime);
}

/**
 * Review-time backstop for staff screens (KYC documents, payment receipts): checks each signed link's bytes,
 * whatever path the upload took. A file that isn't its claimed type loses its link and is flagged, so staff
 * never open it and can ask for a re-upload. Keyed by storage path.
 */
export async function vetSignedLinks(links: { path: string; url: string | null | undefined; mime: string | null }[]) {
  const checked = await Promise.all(links.map(async (l) => {
    const ok = !!l.url && !!l.mime && (await urlContentMatches(l.url, l.mime));
    return [l.path, { url: ok ? l.url! : null, mismatch: !!l.url && !ok }] as const;
  }));
  return new Map<string, { url: string | null; mismatch: boolean }>(checked);
}
