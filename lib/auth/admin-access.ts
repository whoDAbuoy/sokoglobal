/**
 * Who counts as an admin, in one place (pure: no React, no Supabase).
 * Contract: supabase/migrations/014_super_admin.sql.
 *
 *  - role 'super_admin' → level 'super' (every admin page + audited super_* overrides)
 *  - role 'admin'       → level 'admin'
 *  - any other role with an unrevoked, unexpired delegated_admin_grants row → level 'delegated'
 *
 * Postgres re-checks all of this on every call (current_role_is / is_super_admin
 * compare against now()), so these helpers only decide what the UI shows and
 * which pages 404. They never grant anything on their own.
 */
import type { AdminAccess, AdminLevel, Profile, UserRole } from '../types';

export const GRANT_MIN_MINUTES = 5;
export const GRANT_MAX_DAYS = 30;
export const GRANT_PRESETS = [
  ['1', '1 hour'], ['4', '4 hours'], ['24', '24 hours'], ['72', '3 days'], ['168', '7 days'], ['720', '30 days'],
] as const;

type ProfileLike = Pick<Profile, 'role'> & { admin_access?: AdminAccess | null };

/** Parses the my_admin_access() RPC result. Delegated access without a future expiry is treated as none. */
export function parseAdminAccess(raw: unknown, now: number = Date.now()): AdminAccess | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const level = r.level;
  if (level === 'super' || level === 'admin') return { level };
  if (level !== 'delegated') return null;
  const expires = typeof r.expires_at === 'string' ? Date.parse(r.expires_at) : NaN;
  if (!Number.isFinite(expires) || expires <= now) return null;
  return { level, expires_at: new Date(expires).toISOString(), grant_id: typeof r.grant_id === 'string' ? r.grant_id : null };
}

/** Admin level implied by a role alone (no grant lookup). */
export function roleAdminLevel(role: UserRole | string | null | undefined): AdminLevel | null {
  return role === 'super_admin' ? 'super' : role === 'admin' ? 'admin' : null;
}

export function adminLevel(profile: ProfileLike | null | undefined, now: number = Date.now()): AdminLevel | null {
  if (!profile) return null;
  const fromRole = roleAdminLevel(profile.role);
  if (fromRole) return fromRole;
  const a = profile.admin_access;
  if (a?.level === 'delegated' && a.expires_at && Date.parse(a.expires_at) > now) return 'delegated';
  return null;
}

export function isAdmin<T extends ProfileLike>(p: T | null | undefined, now?: number): p is T {
  return adminLevel(p, now) !== null;
}
export function isSuperAdmin<T extends ProfileLike>(p: T | null | undefined): p is T {
  return p?.role === 'super_admin';
}
/** Admin by role (not a temporary grant). Only these can flip the platform kill switch. */
export function isPermanentAdmin<T extends ProfileLike>(p: T | null | undefined): p is T {
  return roleAdminLevel(p?.role) !== null;
}

/** Landing page after sign-in. Delegated admins keep their own home and reach /admin from the header. */
export function homePathFor(role: UserRole | string | null | undefined): string {
  if (roleAdminLevel(role)) return '/admin';
  return role === 'supplier' ? '/supplier' : '/dashboard';
}

export interface GrantRow { revoked_at: string | null; expires_at: string }
export function grantIsActive(g: GrantRow, now: number = Date.now()): boolean {
  return g.revoked_at === null && Date.parse(g.expires_at) > now;
}

export type GrantValidation = { ok: true; expiresAt: string; reason: string } | { ok: false; error: string };

/** Mirrors super_grant_admin(): expiry between 5 minutes and 30 days, reason ≥ 5 characters. */
export function validateGrantRequest(input: { hours: number; reason: string }, now: number = Date.now()): GrantValidation {
  const hours = Number(input.hours);
  if (!Number.isFinite(hours) || hours <= 0) return { ok: false, error: 'Choose how long access should last.' };
  const minutes = hours * 60;
  if (minutes < GRANT_MIN_MINUTES || minutes > GRANT_MAX_DAYS * 24 * 60) {
    return { ok: false, error: `Access can last between ${GRANT_MIN_MINUTES} minutes and ${GRANT_MAX_DAYS} days.` };
  }
  const reason = input.reason.trim().replace(/\s+/g, ' ');
  if (reason.length < 5) return { ok: false, error: 'Give a reason (5+ characters). It is kept in the audit log.' };
  if (reason.length > 500) return { ok: false, error: 'Keep the reason under 500 characters.' };
  return { ok: true, expiresAt: new Date(now + minutes * 60_000).toISOString(), reason };
}

/** "2h 15m left", "3d 4h left", "expired". */
export function formatTimeLeft(expiresAt: string, now: number = Date.now()): string {
  const ms = Date.parse(expiresAt) - now;
  if (!Number.isFinite(ms) || ms <= 0) return 'expired';
  const mins = Math.floor(ms / 60_000);
  const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
  if (d > 0) return `${d}d ${h}h left`;
  if (h > 0) return `${h}h ${m}m left`;
  return `${Math.max(1, m)}m left`;
}

export const ADMIN_LEVEL_LABEL: Record<AdminLevel, string> = { super: 'Super admin', admin: 'Admin', delegated: 'Temporary admin' };

/** Client IP + user agent for the audit trail (first x-forwarded-for hop, trimmed). */
export function requestFingerprint(h: { get(name: string): string | null }): { ip: string | null; ua: string | null } {
  const fwd = h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip')?.trim() || null;
  const ip = fwd && /^[0-9a-fA-F:.]{2,64}$/.test(fwd) ? fwd : null;
  const ua = h.get('user-agent')?.slice(0, 400) || null;
  return { ip, ua };
}
