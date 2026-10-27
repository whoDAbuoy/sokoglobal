import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_TRIAL_BATCH, parseTrialBatchConfig, type TrialBatchConfig } from '@/lib/trial-batch';
import type { KycRequirements } from '@/lib/kyc';

/**
 * system_configs (migration 018), with safe defaults when the read fails: the default trial batch and KYC required
 * (Postgres enforces KYC itself either way). `bestEffort` (display-only reads such as the landing page's minimum):
 * capped at 1.5 s with no retries, falling back to the defaults.
 */
export async function getSystemConfigs(supabase: SupabaseClient, opts: { bestEffort?: boolean } = {}): Promise<{ available: boolean; trial: TrialBatchConfig; kyc: KycRequirements; updatedAt: Record<string, string> }> {
  const query = supabase.from('system_configs').select('key, value, updated_at').in('key', ['trial_batch_config', 'kyc_requirements']);
  const { data, error } = await (opts.bestEffort ? query.abortSignal(AbortSignal.timeout(1500)).retry(false) : query);
  if (error) return { available: false, trial: DEFAULT_TRIAL_BATCH, kyc: { listings: true, orders: true }, updatedAt: {} };
  const by = new Map((data ?? []).map((r) => [r.key as string, r]));
  const k = (by.get('kyc_requirements')?.value ?? {}) as Partial<KycRequirements>;
  return {
    available: true,
    trial: parseTrialBatchConfig(by.get('trial_batch_config')?.value),
    kyc: { listings: k.listings !== false, orders: k.orders !== false },
    updatedAt: Object.fromEntries((data ?? []).map((r) => [r.key as string, r.updated_at as string])),
  };
}
