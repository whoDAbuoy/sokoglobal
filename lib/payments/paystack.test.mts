// Run: npx tsx --conditions=react-server --test lib/payments/paystack.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { parseWebhook, toMinorUnits, verifyWebhookSignature } from './paystack.ts';

test('toMinorUnits: USD passes cents through; other currencies convert and round up', () => {
  assert.equal(toMinorUnits(57900, 'USD', 1), 57900);
  assert.equal(toMinorUnits(57900, 'KES', 129.3), 7486470);         // $579.00 → KES 74,864.70
  assert.equal(toMinorUnits(1, 'KES', 129.31), 130);                 // 129.31 → rounds up to 130
  assert.throws(() => toMinorUnits(0, 'USD', 1));
  assert.throws(() => toMinorUnits(10.5, 'USD', 1));
});

test('webhook signature: HMAC-SHA512 of the raw body with the secret key', () => {
  const secret = 'sk_test_abc';
  const raw = JSON.stringify({ event: 'charge.success', data: { reference: 'ord.x', status: 'success' } });
  const good = createHmac('sha512', secret).update(raw).digest('hex');
  assert.equal(verifyWebhookSignature(raw, good, secret), true);
  assert.equal(verifyWebhookSignature(raw, good.toUpperCase(), secret), true);
  assert.equal(verifyWebhookSignature(raw + ' ', good, secret), false);               // body tampered
  assert.equal(verifyWebhookSignature(raw, createHmac('sha512', 'other').update(raw).digest('hex'), secret), false);
  assert.equal(verifyWebhookSignature(raw, null, secret), false);
  assert.equal(verifyWebhookSignature(raw, 'abc', secret), false);
});

test('parseWebhook extracts event + reference; rejects junk', () => {
  assert.deepEqual(parseWebhook({ event: 'charge.success', data: { reference: 'grp.1', status: 'success', id: 42 } }),
    { event: 'charge.success', reference: 'grp.1', status: 'success', id: '42' });
  assert.equal(parseWebhook({ event: 'charge.success', data: {} }), null);
  assert.equal(parseWebhook(null), null);
  assert.equal(parseWebhook({ data: { reference: 'x' } }), null);
});
