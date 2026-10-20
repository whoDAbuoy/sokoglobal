/**
 * Settings hub rules (pure). Mirrors the profile constraints in migration 016:
 * E.164 phone, 2–80 character designation, avatars PNG/JPEG ≤ AVATAR_MAX_BYTES
 * stored as avatars/<user id>/<content hash>.<ext>.
 */
import { dialCode } from './countries';

export const SETTINGS_TABS = ['profile', 'security', 'notifications', 'appearance'] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];
/** Old /dashboard/profile?tab=… links keep working. */
export function parseSettingsTab(v: string | undefined): SettingsTab {
  if (v === 'account') return 'profile';
  return (SETTINGS_TABS as readonly string[]).includes(v ?? '') ? (v as SettingsTab) : 'profile';
}

export type PhoneResult = { ok: true; phone: string | null } | { ok: false; error: string };

/**
 * "+254 712 345 678", "0712 345 678" (local, using the account's country) → "+254712345678".
 * Blank clears the number.
 */
export function normalizePhone(input: string, countryCode: string): PhoneResult {
  const raw = input.trim();
  if (!raw) return { ok: true, phone: null };
  if (/[^\d\s()+.-]/.test(raw)) return { ok: false, error: 'Use digits only, e.g. +254 712 345 678.' };
  let digits = raw.replace(/[^\d+]/g, '');
  if (digits.startsWith('00')) digits = `+${digits.slice(2)}`;
  if (!digits.startsWith('+')) {
    const dial = dialCode(countryCode);
    if (!dial) return { ok: false, error: 'Include your country code, e.g. +254 712 345 678.' };
    digits = `${dial}${digits.replace(/^0+/, '')}`;
  }
  const e164 = `+${digits.replace(/\D/g, '')}`;
  return /^\+[1-9]\d{7,14}$/.test(e164) ? { ok: true, phone: e164 } : { ok: false, error: 'That doesn’t look like a full phone number.' };
}

export function normalizeDesignation(input: string): { ok: true; value: string | null } | { ok: false; error: string } {
  const v = input.trim().replace(/\s+/g, ' ');
  if (!v) return { ok: true, value: null };
  if (v.length < 2 || v.length > 80) return { ok: false, error: 'Job title must be 2–80 characters.' };
  return { ok: true, value: v };
}

/* ── Avatars ─────────────────────────────────────────────────────────────── */

/** Server actions accept ~1 MB bodies; the browser resizes to 512 px JPEG first, which is far smaller. */
export const AVATAR_MAX_BYTES = 900 * 1024;
export const AVATAR_TYPES = ['image/png', 'image/jpeg'] as const;
export type AvatarType = (typeof AVATAR_TYPES)[number];

/** Detects PNG / JPEG from the file's magic bytes (the browser-supplied type is not trusted). */
export function sniffImageType(bytes: Uint8Array): AvatarType | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
      && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  return null;
}

export function avatarObjectPath(userId: string, sha256Hex: string, type: AvatarType): string {
  return `${userId}/${sha256Hex.slice(0, 24)}.${type === 'image/png' ? 'png' : 'jpg'}`;
}

export type AvatarCheck = { ok: true; type: AvatarType } | { ok: false; error: string };
export function checkAvatarFile(file: { size: number; type: string }, head: Uint8Array): AvatarCheck {
  if (file.size === 0) return { ok: false, error: 'Choose an image.' };
  if (file.size > AVATAR_MAX_BYTES) return { ok: false, error: 'Images must be under 900 KB after resizing.' };
  const sniffed = sniffImageType(head);
  if (!sniffed) return { ok: false, error: 'Use a PNG or JPEG image.' };
  return { ok: true, type: sniffed };
}

/* ── Notifications ───────────────────────────────────────────────────────── */

export const NOTIFICATION_PREFS = ['email_notifications', 'sms_alerts', 'order_status_updates'] as const;
export type NotificationPref = (typeof NOTIFICATION_PREFS)[number];
export const isNotificationPref = (v: string): v is NotificationPref => (NOTIFICATION_PREFS as readonly string[]).includes(v);
