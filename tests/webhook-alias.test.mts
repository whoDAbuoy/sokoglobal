// Run: npx tsx --conditions=react-server --test tests/webhook-alias.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as card from '../app/api/webhooks/card/route.ts';
import * as paystack from '../app/api/webhooks/paystack/route.ts';

test('/api/webhooks/paystack is the same handler as /api/webhooks/card', () => {
  assert.equal(paystack.POST.toString(), card.POST.toString(), 'same handler source');
  assert.equal(paystack.runtime, 'nodejs');
  assert.equal(paystack.dynamic, 'force-dynamic');
});

test('forged Paystack webhooks are rejected with 401 on the alias', async () => {
  process.env.PAYSTACK_SECRET_KEY = 'sk_test_alias';
  const res = await paystack.POST(new Request('https://x/api/webhooks/paystack', {
    method: 'POST', body: JSON.stringify({ event: 'charge.success', data: { reference: 'r' } }), headers: { 'x-paystack-signature': 'bad' },
  }));
  assert.equal(res.status, 401);
});
