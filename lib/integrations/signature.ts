import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * HMAC-SHA256 signatures for the n8n bridge, in both directions:
 *
 *   X-SokoGlobal-Timestamp: <unix seconds>
 *   X-SokoGlobal-Signature: sha256=<hex HMAC-SHA256(secret, `${timestamp}.${rawBody}`)>
 *
 * The timestamp is signed with the body, so a captured request cannot be replayed
 * outside the tolerance window (5 minutes by default).
 */
export const SIGNATURE_HEADER = 'x-sokoglobal-signature';
export const TIMESTAMP_HEADER = 'x-sokoglobal-timestamp';
export const MIN_SECRET_LENGTH = 32;
const DEFAULT_TOLERANCE_S = 300;

export function signPayload(secret: string, timestamp: number, rawBody: string): string {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')}`;
}

export type SignatureCheck = { ok: true } | { ok: false; reason: 'not_configured' | 'missing' | 'stale' | 'mismatch' };

export function verifySignature(
  secret: string | undefined,
  headers: { signature: string | null; timestamp: string | null },
  rawBody: string,
  nowMs = Date.now(),
  toleranceS = DEFAULT_TOLERANCE_S,
): SignatureCheck {
  if (!secret || secret.length < MIN_SECRET_LENGTH) return { ok: false, reason: 'not_configured' };
  if (!headers.signature || !headers.timestamp || !/^\d{9,12}$/.test(headers.timestamp)) return { ok: false, reason: 'missing' };
  const ts = Number(headers.timestamp);
  if (Math.abs(nowMs / 1000 - ts) > toleranceS) return { ok: false, reason: 'stale' };
  const expected = Buffer.from(signPayload(secret, ts, rawBody));
  const received = Buffer.from(headers.signature.trim());
  return received.length === expected.length && timingSafeEqual(received, expected) ? { ok: true } : { ok: false, reason: 'mismatch' };
}

/** Headers for an outbound delivery signed now. */
export function signedHeaders(secret: string, rawBody: string, nowMs = Date.now()): Record<string, string> {
  const ts = Math.floor(nowMs / 1000);
  return { 'X-SokoGlobal-Timestamp': String(ts), 'X-SokoGlobal-Signature': signPayload(secret, ts, rawBody) };
}
