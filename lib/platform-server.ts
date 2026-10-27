import 'server-only';
import { unstable_cache } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { anonClient } from '@/lib/supabase/anon';
import { parsePlatformSettings, transactBlock, type PlatformSettings, type TransactBlock, type TransactKind } from '@/lib/platform';

/** Current switches. A failed read counts as open: a database hiccup never blocks orders on its own. */
/**
 * `bestEffort` (the site-wide banner): capped at 1.5 s with no retries, so an unreachable database never holds a
 * page (supabase-js would otherwise retry 3× with 1/2/4 s backoff). Order and payment checks keep the retries.
 */
export async function getPlatformSettings(supabase: SupabaseClient, opts: { bestEffort?: boolean } = {}): Promise<PlatformSettings> {
  const query = supabase.from('platform_settings').select('pause_new_orders, pause_checkout, maintenance_mode, banner_message, updated_at');
  const { data, error } = await (opts.bestEffort ? query.abortSignal(AbortSignal.timeout(1500)).retry(false) : query).maybeSingle();
  return parsePlatformSettings(error ? null : data);
}

export const PLATFORM_SETTINGS_TAG = 'platform-settings';

/**
 * The switches for the site-wide banner, shared across requests for 15 s (the middleware's maintenance read uses
 * the same window) and dropped as soon as /admin/control saves (revalidateTag). platform_settings is public, so
 * this reads with the anon key and no cookies. Errors are thrown, never cached; order and payment checks keep
 * reading live through getPlatformSettings().
 */
export const getCachedPlatformSettings = unstable_cache(async (): Promise<PlatformSettings> => {
  const { data, error } = await anonClient().from('platform_settings')
    .select('pause_new_orders, pause_checkout, maintenance_mode, banner_message, updated_at')
    .abortSignal(AbortSignal.timeout(1500)).retry(false).maybeSingle();
  if (error) throw new Error(error.message);
  return parsePlatformSettings(data);
}, ['platform-settings'], { revalidate: 15, tags: [PLATFORM_SETTINGS_TAG] });

/** Kill switch + account freeze check for the order and payment routes (see lib/platform.ts). */
export async function checkCanTransact(supabase: SupabaseClient, userId: string, kind: TransactKind): Promise<TransactBlock | null> {
  const [settings, { data: account, error }] = await Promise.all([
    getPlatformSettings(supabase),
    supabase.from('profiles').select('is_frozen').eq('id', userId).maybeSingle<{ is_frozen: boolean }>(),
  ]);
  return transactBlock(settings, error ? null : account, kind);
}
