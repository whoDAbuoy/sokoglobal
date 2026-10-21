// Run: npx tsx --conditions=react-server --test lib/trial-batch.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TRIAL_BATCH, checkTrialAmount, minimumCents, parseTrialBatchConfig, parseTrialConfigInput } from './trial-batch.ts';

test('config parsing falls back to $500, enabled', () => {
  assert.deepEqual(parseTrialBatchConfig(null), DEFAULT_TRIAL_BATCH);
  assert.deepEqual(parseTrialBatchConfig({ enabled: false, minimum_amount: '750.5' }), { enabled: false, minimum_amount: 750.5, currency: 'USD' });
  assert.equal(parseTrialBatchConfig({ minimum_amount: -3 }).minimum_amount, 500);
  assert.equal(minimumCents({ enabled: true, minimum_amount: 750.5, currency: 'USD' }), 75050);
});

test('threshold mirrors check_trial_batch_validity: at the minimum passes, a cent below fails, paused always fails', () => {
  const c = { enabled: true, minimum_amount: 500, currency: 'USD' as const };
  assert.deepEqual(checkTrialAmount(50_000, c), { valid: true });
  assert.equal(checkTrialAmount(49_999, c).valid, false);
  assert.match((checkTrialAmount(49_999, c) as { reason: string }).reason, /USD 500\.00/);
  assert.match((checkTrialAmount(1_000_000, { ...c, enabled: false }) as { reason: string }).reason, /paused/);
  assert.equal(checkTrialAmount(Number.NaN, c).valid, false);
});

test('control-room input: dollars with ≤ 2 decimals between $1 and $1,000,000', () => {
  assert.deepEqual(parseTrialConfigInput({ enabled: true, minimum: '$1,250.50' }), { ok: true, value: { enabled: true, minimum_amount: 1250.5, currency: 'USD' } });
  for (const bad of ['0', '0.50', '1000001', '12.345', 'abc', '']) assert.equal(parseTrialConfigInput({ enabled: true, minimum: bad }).ok, false, bad);
});
