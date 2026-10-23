import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_PRICING, PRICING_KEYS, parsePricing, type PlatformPricing } from '@/lib/pricing';

/** Current prices and rates (migration 026). Before the migration the defaults apply and `available` is false. */
export async function getPricing(supabase: SupabaseClient): Promise<{ available: boolean; pricing: PlatformPricing; updatedAt: string | null }> {
  const { data, error } = await supabase.from('platform_settings').select([...PRICING_KEYS, 'pricing_updated_at'].join(', ')).maybeSingle();
  if (error || !data) return { available: false, pricing: DEFAULT_PRICING, updatedAt: null };
  const row = data as unknown as Record<string, unknown>;
  return { available: true, pricing: parsePricing(row), updatedAt: (row.pricing_updated_at as string | null) ?? null };
}

/** Which of these suppliers hold an active Gold subscription (public, like the badge). Empty on error. */
export async function goldSupplierIds(supabase: SupabaseClient, ids: readonly (string | null | undefined)[]): Promise<Set<string>> {
  const unique = [...new Set(ids.filter((v): v is string => !!v))];
  if (!unique.length) return new Set();
  const { data, error } = await supabase.rpc('gold_supplier_ids', { p_ids: unique.slice(0, 1000) });
  if (error || !Array.isArray(data)) return new Set();
  return new Set((data as unknown[]).map((r) => (typeof r === 'string' ? r : String((r as Record<string, unknown>).gold_supplier_ids ?? ''))));
}
