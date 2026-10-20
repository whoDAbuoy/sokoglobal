import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { parsePlatformSettings, transactBlock, type PlatformSettings, type TransactBlock, type TransactKind } from '@/lib/platform';

/** Current switches. Before migration 014 the table is missing and the platform reads as open. */
export async function getPlatformSettings(supabase: SupabaseClient): Promise<PlatformSettings> {
  const { data, error } = await supabase.from('platform_settings')
    .select('pause_new_orders, pause_checkout, maintenance_mode, banner_message, updated_at').maybeSingle();
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
