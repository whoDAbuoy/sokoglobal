/**
 * What a file really is, read from its first bytes (magic numbers). The browser's File.type comes from the
 * file name, so an upload's declared type is never trusted on its own (pure; used by the upload and review
 * checks in lib/storage-sniff-server.ts).
 */
export type SniffedType = 'image/png' | 'image/jpeg' | 'image/webp' | 'application/pdf' | 'video/mp4' | 'video/quicktime' | 'video/webm';

/** How many leading bytes the checks need. */
export const SNIFF_BYTES = 32;

const ascii = (b: Uint8Array, at: number, text: string) => [...text].every((c, i) => b[at + i] === c.charCodeAt(0));

export function sniffFileType(b: Uint8Array): SniffedType | null {
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 'PNG') && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 12 && ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP')) return 'image/webp';
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'video/webm';
  if (b.length >= 12 && ascii(b, 4, 'ftyp')) return ascii(b, 8, 'qt  ') ? 'video/quicktime' : 'video/mp4';
  // Older QuickTime files start with another top-level atom.
  if (b.length >= 8 && ['moov', 'mdat', 'wide', 'free', 'skip'].some((atom) => ascii(b, 4, atom))) return 'video/quicktime';
  // The PDF header may follow a few junk bytes; readers accept it anywhere near the start.
  for (let i = 0; i + 5 <= b.length; i += 1) if (ascii(b, i, '%PDF-')) return 'application/pdf';
  return null;
}

/** True when the bytes are the declared type. MP4 and MOV share one container, so either satisfies the other. */
export function contentMatches(declared: string, head: Uint8Array): boolean {
  const actual = sniffFileType(head);
  if (!actual) return false;
  const video = (t: string) => t === 'video/mp4' || t === 'video/quicktime';
  return actual === declared || (video(actual) && video(declared));
}

/** The type a stored path claims by its extension (KYC documents and payment proofs keep no MIME column). */
export function mimeFromPath(path: string): SniffedType | null {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return ({ pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
    mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' } as const)[ext as 'pdf'] ?? null;
}
