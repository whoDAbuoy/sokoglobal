/**
 * Chat attachments (pure, no React / Supabase). Mirrors migration 024:
 * chat_media_mime_allowed(), the chat-attachments bucket (private, 50 MB) and
 * the "<order_id>/<sender_id>/<file>" path rule enforced by
 * chat_message_media_guard() and the storage policies.
 */
import type { ChatMessageType } from './chat';

export type MediaType = Exclude<ChatMessageType, 'text'>;

export const CHAT_BUCKET = 'chat-attachments';
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
/** Voice notes stop recording automatically at this length (the database accepts up to 600 s). */
export const MAX_VOICE_SECONDS = 300;
export const WAVEFORM_BARS = 48;

/** Allowed MIME types per message type, with the extensions we accept for each. */
export const MEDIA_RULES: Record<MediaType, Record<string, string[]>> = {
  image: { 'image/png': ['png'], 'image/jpeg': ['jpg', 'jpeg'], 'image/webp': ['webp'] },
  video: { 'video/mp4': ['mp4'], 'video/webm': ['webm'] },
  document: {
    'application/pdf': ['pdf'],
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx'],
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
  },
  voice_note: { 'audio/webm': ['webm'], 'audio/ogg': ['ogg'], 'audio/mp4': ['m4a', 'mp4'], 'audio/mpeg': ['mp3'] },
};

/** For the file picker's `accept` attribute (voice notes are recorded, not picked). */
export const ATTACH_ACCEPT = (['image', 'video', 'document'] as const)
  .flatMap((t) => Object.entries(MEDIA_RULES[t]).flatMap(([mime, exts]) => [mime, ...exts.map((e) => `.${e}`)]))
  .join(',');

const EXT_TO: Record<string, { type: MediaType; mime: string }> = {};
for (const type of ['image', 'video', 'document'] as const) {
  for (const [mime, exts] of Object.entries(MEDIA_RULES[type])) for (const e of exts) EXT_TO[e] = { type, mime };
}

/** MIME without parameters, lower-case ("audio/webm;codecs=opus" → "audio/webm"). */
export const baseMime = (mime: string | null | undefined) => (mime ?? '').split(';')[0].trim().toLowerCase();

export function extensionOf(name: string): string {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(name.trim());
  return m ? m[1].toLowerCase() : '';
}

export type Classified = { ok: true; type: MediaType; mime: string; ext: string } | { ok: false; error: string };

/**
 * Decide the message type of a picked file from its extension, cross-checked
 * with the browser's MIME type (when it gives one) and the size limit.
 */
export function classifyFile(file: { name: string; type: string; size: number }): Classified {
  const ext = extensionOf(file.name);
  const rule = EXT_TO[ext];
  if (!rule) return { ok: false, error: 'Send images (PNG, JPG, WebP), videos (MP4, WebM) or documents (PDF, XLSX, DOCX).' };
  const declared = baseMime(file.type);
  if (declared && declared !== rule.mime && !(declared === 'image/jpg' && rule.mime === 'image/jpeg')) {
    return { ok: false, error: `“${file.name}” doesn’t look like a .${ext} file.` };
  }
  if (!(file.size > 0)) return { ok: false, error: `“${file.name}” is empty.` };
  if (file.size > MAX_ATTACHMENT_BYTES) return { ok: false, error: `“${file.name}” is ${formatBytes(file.size)}; attachments can be up to 50 MB.` };
  return { ok: true, type: rule.type, mime: rule.mime, ext };
}

/**
 * MIME type from a file's first bytes, for the formats we accept. Returns null
 * when unrecognised. DOCX and XLSX are ZIP containers, reported as 'zip'.
 */
export function sniffMime(head: Uint8Array): string | null {
  const at = (i: number, bytes: number[]) => bytes.every((b, j) => head[i + j] === b);
  const ascii = (i: number, s: string) => at(i, [...s].map((c) => c.charCodeAt(0)));
  if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (at(0, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp';
  if (ascii(0, '%PDF-')) return 'application/pdf';
  if (at(0, [0x50, 0x4b, 0x03, 0x04])) return 'zip';
  if (at(0, [0x1a, 0x45, 0xdf, 0xa3])) return 'webm';                   // Matroska / WebM (audio or video)
  if (ascii(4, 'ftyp')) return 'mp4';                                     // ISO BMFF (MP4 video, M4A audio)
  if (ascii(0, 'OggS')) return 'audio/ogg';
  if (ascii(0, 'ID3') || at(0, [0xff, 0xfb]) || at(0, [0xff, 0xf3]) || at(0, [0xff, 0xf2])) return 'audio/mpeg';
  return null;
}

/** Does the sniffed signature fit the declared MIME type? (Defence against renamed files.) */
export function signatureMatches(declaredMime: string, sniffed: string | null): boolean {
  const m = baseMime(declaredMime);
  if (!sniffed) return false;
  if (sniffed === 'zip') return m.startsWith('application/vnd.openxmlformats-officedocument.');
  if (sniffed === 'webm') return m === 'video/webm' || m === 'audio/webm';
  if (sniffed === 'mp4') return m === 'video/mp4' || m === 'audio/mp4';
  return sniffed === m;
}

/** Storage-safe object name: ASCII letters, digits, '.', '_' and '-', ≤ 150 chars, keeps the extension. */
export function safeFileName(name: string, fallbackExt = 'bin'): string {
  const ext = extensionOf(name) || fallbackExt;
  const stem = name.replace(/\.[A-Za-z0-9]{1,8}$/, '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[^A-Za-z0-9]+/, '').replace(/-+/g, '-').replace(/[-.]+$/, '')
    .slice(0, 120) || 'file';
  return `${stem}.${ext}`.slice(0, 150);
}

/** "<order_id>/<sender_id>/<unique>-<safe name>" — the only shape the bucket policies and the message trigger accept. */
export function attachmentPath(orderId: string, senderId: string, fileName: string, unique: string): string {
  const id = unique.replace(/[^A-Za-z0-9]/g, '').slice(0, 12) || 'x';
  return `${orderId}/${senderId}/${id}-${safeFileName(fileName)}`;
}

export function formatBytes(n: number | null | undefined): string {
  if (!n || n < 0) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** 0 → "0:00", 75.4 → "1:15", 3725 → "1:02:05". */
export function formatDuration(seconds: number | null | undefined): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? (seconds as number) : 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

/** Peak amplitude per bar, scaled so the loudest bar is 100 (silence stays flat). Integers 0–100. */
export function computeWaveform(samples: ArrayLike<number>, bars = WAVEFORM_BARS): number[] {
  const n = samples.length;
  if (!n || bars <= 0) return Array.from({ length: Math.max(0, bars) }, () => 0);
  const peaks: number[] = [];
  for (let b = 0; b < bars; b += 1) {
    const from = Math.floor((b * n) / bars), to = Math.max(from + 1, Math.floor(((b + 1) * n) / bars));
    let peak = 0;
    for (let i = from; i < to && i < n; i += 1) peak = Math.max(peak, Math.abs(samples[i]));
    peaks.push(peak);
  }
  const max = Math.max(...peaks);
  return max < 0.01 ? peaks.map(() => 0) : peaks.map((p) => Math.round((p / max) * 100));
}

/** First recorder format the browser supports (Chrome/Firefox: WebM/Opus, Safari: MP4/AAC). */
export function pickRecorderMime(isSupported: (mime: string) => boolean): string | null {
  for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']) if (isSupported(m)) return m;
  return null;
}

export const extForAudio = (mime: string) => (baseMime(mime) === 'audio/mp4' ? 'm4a' : baseMime(mime) === 'audio/ogg' ? 'ogg' : 'webm');
