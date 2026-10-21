import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_TRIAL_BATCH, parseTrialBatchConfig, type TrialBatchConfig } from '@/lib/trial-batch';
import type { KycRequirements } from '@/lib/kyc';

/** system_configs (migration 018) with safe defaults when the table is missing. */
export async function getSystemConfigs(supabase: SupabaseClient): Promise<{ available: boolean; trial: TrialBatchConfig; kyc: KycRequirements; updatedAt: Record<string, string> }> {
  const { data, error } = await supabase.from('system_configs').select('key, value, updated_at').in('key', ['trial_batch_config', 'kyc_requirements']);
  if (error) return { available: false, trial: DEFAULT_TRIAL_BATCH, kyc: { listings: false, orders: false }, updatedAt: {} };
  const by = new Map((data ?? []).map((r) => [r.key as string, r]));
  const k = (by.get('kyc_requirements')?.value ?? {}) as Partial<KycRequirements>;
  return {
    available: true,
    trial: parseTrialBatchConfig(by.get('trial_batch_config')?.value),
    kyc: { listings: k.listings !== false, orders: k.orders !== false },
    updatedAt: Object.fromEntries((data ?? []).map((r) => [r.key as string, r.updated_at as string])),
  };
}
