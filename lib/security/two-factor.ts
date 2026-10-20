/**
 * TOTP two-factor authentication: secret encryption, code verification,
 * backup codes and the per-session "2FA passed" window. Node-only (node:crypto);
 * no Supabase here so it is unit-testable. Contract: migration 016.
 *
 *  - Secrets are AES-256-GCM encrypted with TWO_FACTOR_ENCRYPTION_KEY, with the
 *    user id as additional data (a ciphertext copied onto another user fails).
 *  - Backup codes are stored as HMAC-SHA256(key, code): a database leak alone
 *    cannot brute-force them. Each works once.
 *  - TOTP: RFC 6238 defaults (SHA-1, 6 digits, 30 s) that Google Authenticator,
 *    Authy and 1Password use; ±1 step of clock drift; a step is never accepted twice.
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { generateSecret, generateURI, verify } from 'otplib';

export const TOTP_ISSUER = 'SokoGlobal';
export const TOTP_EPOCH_TOLERANCE_SECONDS = 30;
export const TWO_FACTOR_SESSION_HOURS = 12;
export const BACKUP_CODE_COUNT = 10;
const BACKUP_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L

export class TwoFactorConfigError extends Error {}

/** 32-byte key from TWO_FACTOR_ENCRYPTION_KEY (base64 or 64 hex chars). */
export function parseEncryptionKey(raw: string | undefined): Buffer {
  const v = (raw ?? '').trim();
  if (!v) throw new TwoFactorConfigError('Two-factor authentication is not configured (TWO_FACTOR_ENCRYPTION_KEY missing)');
  const key = /^[0-9a-fA-F]{64}$/.test(v) ? Buffer.from(v, 'hex') : Buffer.from(v, 'base64');
  if (key.length !== 32) throw new TwoFactorConfigError('TWO_FACTOR_ENCRYPTION_KEY must be 32 bytes (openssl rand -base64 32)');
  return key;
}

export const twoFactorKey = () => parseEncryptionKey(process.env.TWO_FACTOR_ENCRYPTION_KEY);

export function isTwoFactorConfigured(): boolean {
  try { twoFactorKey(); return true; } catch { return false; }
}

const b64u = (b: Buffer) => b.toString('base64url');

/** "v1.<iv>.<tag>.<ciphertext>" (base64url). */
export function encryptSecret(plain: string, userId: string, key: Buffer): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(`totp:${userId}`));
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', b64u(iv), b64u(c.getAuthTag()), b64u(ct)].join('.');
}

export function decryptSecret(blob: string, userId: string, key: Buffer): string {
  const [v, iv, tag, ct] = blob.split('.');
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('Unrecognised secret format');
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  d.setAAD(Buffer.from(`totp:${userId}`));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}

export const newTotpSecret = () => generateSecret();   // 20 random bytes, base32 (32 chars)

export function otpauthUri(secret: string, accountLabel: string): string {
  return generateURI({ issuer: TOTP_ISSUER, label: accountLabel, secret });
}

/** "ABCD EFGH …" for typing the secret by hand. */
export const groupSecret = (secret: string) => secret.replace(/(.{4})/g, '$1 ').trim();

export const normalizeTotp = (code: string) => code.replace(/[\s-]/g, '');
export const isTotpFormat = (code: string) => /^\d{6}$/.test(normalizeTotp(code));

export type TotpCheck = { valid: true; timeStep: number } | { valid: false };

/** Verifies a 6-digit code; `afterTimeStep` (the last accepted step) blocks replays. */
export async function verifyTotp(secret: string, code: string, afterTimeStep?: number | null, epoch?: number): Promise<TotpCheck> {
  const token = normalizeTotp(code);
  if (!/^\d{6}$/.test(token)) return { valid: false };
  const r = await verify({
    secret, token, epochTolerance: TOTP_EPOCH_TOLERANCE_SECONDS,
    ...(afterTimeStep != null ? { afterTimeStep } : {}),
    ...(epoch !== undefined ? { epoch } : {}),
  });
  return r.valid && 'timeStep' in r && typeof r.timeStep === 'number' ? { valid: true, timeStep: r.timeStep } : { valid: false };
}

/* ── Backup codes ────────────────────────────────────────────────────────── */

export const normalizeBackupCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');
export const isBackupCodeFormat = (code: string) => /^[A-Z0-9]{8}$/.test(normalizeBackupCode(code));

/** Ten "XXXX-XXXX" codes, ~39 bits each, from a CSPRNG. */
export function generateBackupCodes(count = BACKUP_CODE_COUNT): string[] {
  const codes = new Set<string>();
  while (codes.size < count) {
    let s = '';
    for (let i = 0; i < 8; i++) s += BACKUP_ALPHABET[randomInt(BACKUP_ALPHABET.length)];
    codes.add(`${s.slice(0, 4)}-${s.slice(4)}`);
  }
  return [...codes];
}

export function hashBackupCode(code: string, key: Buffer): string {
  return createHmac('sha256', key).update(`backup:${normalizeBackupCode(code)}`).digest('hex');
}

/** Remaining hashes after using `code`, or null if it matches none (constant-time compare per entry). */
export function consumeBackupCode(hashes: readonly string[], code: string, key: Buffer): string[] | null {
  if (!isBackupCodeFormat(code)) return null;
  const h = Buffer.from(hashBackupCode(code, key), 'hex');
  let hit = -1;
  hashes.forEach((stored, i) => {
    const s = Buffer.from(stored, 'hex');
    if (s.length === h.length && timingSafeEqual(s, h) && hit === -1) hit = i;
  });
  return hit === -1 ? null : hashes.filter((_, i) => i !== hit);
}

/* ── Session binding ─────────────────────────────────────────────────────── */

/**
 * `sub` and `session_id` from a Supabase access token. Only call this on a token
 * whose user was already validated with auth.getUser(); the result is then
 * checked against that user id.
 */
export function sessionClaims(accessToken: string | null | undefined): { sub: string; sessionId: string } | null {
  const part = accessToken?.split('.')[1];
  if (!part) return null;
  try {
    const p = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as { sub?: unknown; session_id?: unknown };
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return typeof p.sub === 'string' && typeof p.session_id === 'string' && uuid.test(p.session_id) ? { sub: p.sub, sessionId: p.session_id } : null;
  } catch { return null; }
}

export const twoFactorSessionExpiry = (now = Date.now()) => new Date(now + TWO_FACTOR_SESSION_HOURS * 3_600_000).toISOString();

export { safeReturnPath } from './two-factor-gate';
