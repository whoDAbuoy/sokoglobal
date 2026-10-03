import type { MediaType } from '@/lib/types';

/** Shared upload rules — imported by both the ImageUpload component and the API routes. */
export const MEDIA_BUCKET = 'product-media';

export const UPLOAD_RULES: Record<MediaType, { mimes: Record<string, string>; maxBytes: number; label: string }> = {
  image: {
    mimes: { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' },
    maxBytes: 15 * 1024 * 1024, // 15 MB
    label: 'JPG, PNG or WebP up to 15 MB',
  },
  swatch_video: {
    mimes: { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' },
    maxBytes: 100 * 1024 * 1024, // 100 MB
    label: 'MP4, MOV or WebM up to 100 MB',
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
