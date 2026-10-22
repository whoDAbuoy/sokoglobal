import type { MediaType } from '@/lib/types';

/** Shared upload rules — imported by both the ImageUpload component and the API routes. */
export const MEDIA_BUCKET = 'product-media';

export const UPLOAD_RULES: Record<MediaType, { mimes: Record<string, string>; maxBytes: number; label: string }> = {
  image: {
    mimes: { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' },
    maxBytes: 500 * 1024 * 1024, // 500 MB (matches the product-media bucket limit)
    label: 'JPG, PNG or WebP up to 500 MB',
  },
  swatch_video: {
    mimes: { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' },
    maxBytes: 500 * 1024 * 1024, // 500 MB; uploads over 6 MB go in resumable chunks
    label: 'MP4, MOV or WebM up to 500 MB',
  },
};

/** Visual-proof quality bar: product photos must be at least this many px on the longest edge. */
export const MIN_IMAGE_EDGE_PX = 1000;

export function mediaTypeForMime(mime: string): MediaType | null {
  if (mime in UPLOAD_RULES.image.mimes) return 'image';
  if (mime in UPLOAD_RULES.swatch_video.mimes) return 'swatch_video';
  return null;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
