/**
 * Classify a product video URL for the gallery.
 *   file    → .mp4 / .webm / .mov / .m4v, played with <video>
 *   hls     → .m3u8 (native on Safari, hls.js elsewhere)
 *   youtube → embedded via youtube-nocookie.com
 *   vimeo   → embedded via player.vimeo.com
 * Only https URLs are accepted (Supabase Storage public URLs included);
 * anything else returns null and is not rendered.
 */
export type VideoSource =
  | { kind: 'file'; src: string }
  | { kind: 'hls'; src: string }
  | { kind: 'youtube'; id: string; embed: string; thumbnail: string }
  | { kind: 'vimeo'; id: string; embed: string };

export function parseVideoUrl(raw: string): VideoSource | null {
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== 'https:') return null;
  const host = url.hostname.replace(/^www\./, '');
  const path = url.pathname.toLowerCase();

  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtu.be' || host === 'youtube-nocookie.com') {
    const id = host === 'youtu.be' ? url.pathname.slice(1)
      : url.pathname.startsWith('/embed/') || url.pathname.startsWith('/shorts/') ? url.pathname.split('/')[2]
      : url.searchParams.get('v');
    if (!id || !/^[\w-]{11}$/.test(id)) return null;
    return {
      kind: 'youtube', id,
      embed: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&playsinline=1&rel=0&modestbranding=1`,
      thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    };
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const id = url.pathname.split('/').filter(Boolean).find((s) => /^\d{6,12}$/.test(s));
    if (!id) return null;
    return { kind: 'vimeo', id, embed: `https://player.vimeo.com/video/${id}?autoplay=1&playsinline=1&dnt=1` };
  }
  if (path.endsWith('.m3u8')) return { kind: 'hls', src: url.toString() };
  if (/\.(mp4|webm|mov|m4v)$/.test(path)) return { kind: 'file', src: url.toString() };
  return null;
}
