/**
 * Pure helpers for admin user management and profile change requests
 * (no React, no Supabase). Contract: supabase/migrations/012_user_management.sql.
 */
import type { UserRole } from './types';

export const USER_PAGE_SIZE = 20;
/** Supabase Auth ban length used for "banned until unbanned" (~100 years). */
export const AUTH_BAN_DURATION = '876000h';

export const ROLE_FILTERS = [['', 'All accounts'], ['importer', 'Importers'], ['supplier', 'Suppliers'], ['admin', 'Admins']] as const;
export const STATUS_FILTERS = [['', 'Any status'], ['active', 'Active'], ['banned', 'Banned'], ['frozen', 'Frozen'], ['temp_admin', 'Temporary admin'], ['pending_edit', 'Pending edit']] as const;

/** 'admin' also matches super admins and temporary admins (see admin_list_users in migration 014). */
export function parseRoleFilter(v: string | undefined): '' | UserRole {
  return v === 'importer' || v === 'supplier' || v === 'admin' || v === 'super_admin' ? v : '';
}
export type StatusFilter = '' | 'active' | 'banned' | 'frozen' | 'temp_admin' | 'pending_edit';
export function parseStatusFilter(v: string | undefined): StatusFilter {
  return v === 'active' || v === 'banned' || v === 'frozen' || v === 'temp_admin' || v === 'pending_edit' ? v : '';
}

export type UserStatus = 'active' | 'banned' | 'frozen' | 'pending_edit';
/** Badge for a directory row. Ban > freeze > pending edit. */
export function userStatus(u: { is_banned: boolean; pending_change: boolean; is_frozen?: boolean | null }): { status: UserStatus; label: string; tone: string } {
  if (u.is_banned) return { status: 'banned', label: 'Banned', tone: 'tone-danger' };
  if (u.is_frozen) return { status: 'frozen', label: 'Frozen', tone: 'tone-transit' };
  if (u.pending_change) return { status: 'pending_edit', label: 'Pending edit', tone: 'tone-pending' };
  return { status: 'active', label: 'Active', tone: 'tone-escrow' };
}

export const ROLE_LABEL: Record<UserRole, string> = { importer: 'Importer', supplier: 'Supplier', admin: 'Admin', super_admin: 'Super admin' };

/** Why a hard delete is refused, in plain words. Empty string = deletion allowed. */
export function deletionBlockMessage(blockers: Record<string, number> | null | undefined): string {
  if (!blockers) return '';
  if (blockers.self) return 'You cannot delete your own account.';
  if (blockers.admin) return 'Admin accounts cannot be deleted here.';
  const parts: string[] = [];
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  if (blockers.orders) parts.push(plural(blockers.orders, 'order'));
  if (blockers.products) parts.push(plural(blockers.products, 'product'));
  if (blockers.pool_pledges) parts.push(plural(blockers.pool_pledges, 'Trend Pool pledge'));
  if (blockers.payouts) parts.push(plural(blockers.payouts, 'payout'));
  if (parts.length === 0) return '';
  return `This account has ${parts.join(', ')}. Escrow and payout records must be kept, so ban the account instead of deleting it.`;
}

export type ProfileChangeValidation =
  | { ok: true; full_name: string; company_name: string; note: string | null }
  | { ok: false; error: string };

/** Mirrors submit_profile_change(): trimmed lengths, and something must actually change. */
export function validateProfileChange(
  input: { full_name: string; company_name: string; note?: string | null },
  current: { full_name: string; company_name: string },
): ProfileChangeValidation {
  const full_name = input.full_name.trim().replace(/\s+/g, ' ');
  const company_name = input.company_name.trim().replace(/\s+/g, ' ');
  if (full_name.length < 2 || full_name.length > 120) return { ok: false, error: 'Name must be 2–120 characters.' };
  if (company_name.length < 2 || company_name.length > 160) return { ok: false, error: 'Business name must be 2–160 characters.' };
  if (full_name === current.full_name && company_name === current.company_name) return { ok: false, error: 'Change at least one field.' };
  const note = (input.note ?? '').trim().slice(0, 500) || null;
  return { ok: true, full_name, company_name, note };
}

/** Field-by-field diff for the admin review card. */
export function profileDiff(r: { current_full_name: string; current_company_name: string; full_name: string; company_name: string }) {
  return [
    { field: 'Contact name', from: r.current_full_name, to: r.full_name, changed: r.current_full_name !== r.full_name },
    { field: 'Business name', from: r.current_company_name, to: r.company_name, changed: r.current_company_name !== r.company_name },
  ];
}
