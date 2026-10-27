import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { parsePlatformSettings, transactBlock, type PlatformSettings, type TransactBlock, type TransactKind } from '@/lib/platform';

/** Current switches. Before migration 014 the table is missing and the platform reads as open. */
/**
 * `bestEffort` (the site-wide banner): capped at 1.5 s with no retries, so an unreachable database never holds a
 * page (supabase-js would otherwise retry 3× with 1/2/4 s backoff). Order and payment checks keep the retries.
 */
export async function getPlatformSettings(supabase: SupabaseClient, opts: { bestEffort?: boolean } = {}): Promise<PlatformSettings> {
  const query = supabase.from('platform_settings').select('pause_new_orders, pause_checkout, maintenance_mode, banner_message, updated_at');
  const { data, error } = await (opts.bestEffort ? query.abortSignal(AbortSignal.timeout(1500)).retry(false) : query).maybeSingle();
  return parsePlatformSettings(error ? null : data);
}

/** Kill switch + account freeze check for the order and payment routes (see lib/platform.ts). */
export async function checkCanTransact(supabase: SupabaseClient, userId: string, kind: TransactKind): Promise<TransactBlock | null> {
  const [settings, { data: account, error }] = await Promise.all([
    getPlatformSettings(supabase),
    supabase.from('profiles').select('is_frozen').eq('id', userId).maybeSingle<{ is_frozen: boolean }>(),
  ]);
  return transactBlock(settings, error ? null : account, kind);
}
