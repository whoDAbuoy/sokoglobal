// Run: npx tsx --test lib/payments/fx.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planFxPayout, FxPlanError } from './fx.ts';

/** Fake Flutterwave: `usdPerUnit` per destination unit; optional one-off move after the probe. */
function fakeQuote(usdPerUnit: number, moveAfterProbe = 0) {
  let calls = 0;
  const fn = async (dest: number) => {
    const rate = usdPerUnit * (calls++ === 0 ? 1 : 1 + moveAfterProbe);
    return { sourceAmount: Math.round(dest * rate * 100) / 100, destinationAmount: dest };
  };
  return Object.assign(fn, { calls: () => calls });
}

test('USD → KES: never debits more than the net payout', async () => {
  const q = fakeQuote(1 / 129.4);                      // ~129.4 KES per USD
  const plan = await planFxPayout(31_008, q);          // $310.08 net
  assert.ok(plan.sourceCents <= 31_008);
  assert.ok(plan.destinationAmount >= 40_100 && plan.destinationAmount <= 40_130, `${plan.destinationAmount}`);
  assert.ok(Math.abs(plan.rate - 129.4) < 0.2);
});

test('USD → NGN large amount stays within bound', async () => {
  const plan = await planFxPayout(4_350_000, fakeQuote(1 / 1530));
  assert.ok(plan.sourceCents <= 4_350_000);
  assert.ok(plan.destinationAmount > 66_000_000);
});

test('rate moving against us after the probe → shrinks and re-quotes', async () => {
  const q = fakeQuote(1 / 129.4, 0.015);               // KES strengthens 1.5% between probe and confirm
  const plan = await planFxPayout(31_008, q);
  assert.ok(plan.sourceCents <= 31_008);
  assert.ok(q.calls() === 3, 'probe + rejected confirm + accepted confirm');
  assert.ok(plan.sourceCents > 30_900, 'shrink is tight — supplier loses only the margin');
});

test('amount too small to convert', async () => {
  await assert.rejects(planFxPayout(1, fakeQuote(1 / 0.9)), FxPlanError);   // 1 cent into EUR
});

test('rejects garbage input and quotes', async () => {
  await assert.rejects(planFxPayout(0, fakeQuote(1)), FxPlanError);
  await assert.rejects(planFxPayout(100, async () => ({ sourceAmount: 0, destinationAmount: 1000 })), FxPlanError);
});
