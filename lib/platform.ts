/**
 * Platform kill switch + account freeze decisions (pure; no Supabase).
 * Contract: platform_settings / profiles.is_frozen in migration 014.
 *
 * Postgres enforces the same rules with BEFORE INSERT triggers for requests made
 * as the signed-in user. Payment rows are written with the service role (no
 * auth.uid()), so the API routes call these helpers too — both layers agree.
 */
export interface PlatformSettings {
  pause_new_orders: boolean;
  pause_checkout: boolean;
  maintenance_mode: boolean;
  banner_message: string | null;
  updated_at?: string | null;
}

export const OPEN_PLATFORM: PlatformSettings = { pause_new_orders: false, pause_checkout: false, maintenance_mode: false, banner_message: null };

export function parsePlatformSettings(raw: unknown): PlatformSettings {
  if (!raw || typeof raw !== 'object') return OPEN_PLATFORM;
  const r = raw as Record<string, unknown>;
  return {
    pause_new_orders: r.pause_new_orders === true,
    pause_checkout: r.pause_checkout === true,
    maintenance_mode: r.maintenance_mode === true,
    banner_message: typeof r.banner_message === 'string' && r.banner_message.trim() ? r.banner_message.trim().slice(0, 300) : null,
    updated_at: typeof r.updated_at === 'string' ? r.updated_at : null,
  };
}

/** 'order' = create an order / cart / pool pledge; 'checkout' = start a card or M-Pesa payment. */
export type TransactKind = 'order' | 'checkout';

export interface TransactBlock { status: 423 | 503; error: string }

export function transactBlock(settings: PlatformSettings, account: { is_frozen?: boolean | null } | null, kind: TransactKind): TransactBlock | null {
  if (account?.is_frozen) return { status: 423, error: 'This account is frozen pending review. Contact SokoGlobal support.' };
  if (settings.maintenance_mode) return { status: 503, error: 'SokoGlobal is in maintenance mode. Please try again shortly.' };
  if (kind === 'order' && settings.pause_new_orders) return { status: 503, error: 'New orders are paused right now. Please try again later.' };
  if (kind === 'checkout' && settings.pause_checkout) return { status: 503, error: 'Checkout is paused right now. Your order is saved; please try again later.' };
  return null;
}

/** Paths that stay reachable during maintenance so staff can sign in and switch it off. */
const MAINTENANCE_OPEN = ['/maintenance', '/login', '/auth', '/admin'];

export type MaintenanceDecision = 'allow' | 'page' | 'api';

/**
 * Middleware decision while maintenance mode is on. Admins pass everywhere;
 * everyone else sees /maintenance (pages) or a 503 (API calls and server actions).
 * Webhooks and cron are outside the middleware matcher and never reach here.
 */
export function maintenanceDecision(input: { maintenance: boolean; path: string; isAdminUser: boolean; isServerAction?: boolean }): MaintenanceDecision {
  if (!input.maintenance || input.isAdminUser) return 'allow';
  if (input.path.startsWith('/api/') || input.isServerAction) return 'api';
  if (input.path === '/' ) return 'page';
  // /admin stays routable: non-admins get the normal 404 there.
  if (MAINTENANCE_OPEN.some((p) => input.path === p || input.path.startsWith(`${p}/`))) return 'allow';
  return 'page';
}
