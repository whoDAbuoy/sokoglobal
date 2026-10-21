/**
 * Trial batch switch + minimum (pure). Contract: system_configs 'trial_batch_config'
 * and check_trial_batch_validity() in migration 018. Amounts in the config are
 * dollars (as stored); the app works in cents.
 */
export interface TrialBatchConfig { enabled: boolean; minimum_amount: number; currency: 'USD' }
export const DEFAULT_TRIAL_BATCH: TrialBatchConfig = { enabled: true, minimum_amount: 500, currency: 'USD' };

export function parseTrialBatchConfig(raw: unknown): TrialBatchConfig {
  if (!raw || typeof raw !== 'object') return DEFAULT_TRIAL_BATCH;
  const r = raw as Record<string, unknown>;
  const min = typeof r.minimum_amount === 'number' ? r.minimum_amount : Number(r.minimum_amount);
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : true,
    minimum_amount: Number.isFinite(min) && min >= 1 ? Math.round(min * 100) / 100 : DEFAULT_TRIAL_BATCH.minimum_amount,
    currency: 'USD',
  };
}

export const minimumCents = (c: TrialBatchConfig) => Math.round(c.minimum_amount * 100);

export type TrialCheck = { valid: true } | { valid: false; reason: string };
/** Mirrors check_trial_batch_validity(order_amount). */
export function checkTrialAmount(landedCents: number, c: TrialBatchConfig): TrialCheck {
  if (!c.enabled) return { valid: false, reason: 'Trial batches are paused right now' };
  if (!(landedCents >= minimumCents(c))) {
    return { valid: false, reason: `Trial batches start at USD ${c.minimum_amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} landed` };
  }
  return { valid: true };
}

/** Control-room form → config, with the same bounds as validate_system_config(). */
export function parseTrialConfigInput(input: { enabled: boolean; minimum: string }): { ok: true; value: TrialBatchConfig } | { ok: false; error: string } {
  const s = input.minimum.replace(/[,\s$]/g, '');
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(s)) return { ok: false, error: 'Enter the minimum in dollars, e.g. 500 or 750.50.' };
  const n = Number(s);
  if (n < 1 || n > 1_000_000) return { ok: false, error: 'The minimum must be between $1 and $1,000,000.' };
  return { ok: true, value: { enabled: !!input.enabled, minimum_amount: n, currency: 'USD' } };
}
