// Run: npx tsx --test lib/security/rate-limit.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientIp, createMemoryLimiter, limitFor, LIMIT_RULES } from './rate-limit-core.ts';

test('which routes are limited', () => {
  assert.equal(limitFor('GET', '/api/orders', false), null);
  assert.equal(limitFor('POST', '/api/orders', false), 'checkout');
  assert.equal(limitFor('POST', '/api/checkout', false), 'checkout');
  assert.equal(limitFor('POST', '/api/pools/abc/join', false), 'checkout');
  assert.equal(limitFor('POST', '/api/orders/abc/mpesa', false), 'payment');
  assert.equal(limitFor('POST', '/api/checkout/abc/card', false), 'payment');
  assert.equal(limitFor('POST', '/api/payments/card/confirm', false), 'payment');
  assert.equal(limitFor('POST', '/api/uploads/sign', false), 'upload');
  assert.equal(limitFor('POST', '/api/auth/2fa/challenge', false), 'twofactor');
  assert.equal(limitFor('POST', '/api/auth/2fa/verify', false), 'twofactor');
  assert.equal(LIMIT_RULES.twofactor.limit <= 10, true);
  assert.equal(limitFor('POST', '/api/webhooks/card', false), null);
  assert.equal(limitFor('POST', '/api/cron/retry-webhooks', false), null);
  assert.equal(limitFor('POST', '/admin/users', true), 'moderation');
  assert.equal(limitFor('POST', '/dashboard/profile', true), 'action');
  assert.equal(limitFor('POST', '/dashboard/profile', false), null);
});

test('client ip', () => {
  assert.equal(clientIp('203.0.113.9, 10.0.0.1', null), '203.0.113.9');
  assert.equal(clientIp(null, ' 198.51.100.2 '), '198.51.100.2');
  assert.equal(clientIp(null, null), 'unknown');
});

test('memory limiter: sliding window per key', () => {
  const check = createMemoryLimiter();
  const { limit, windowSec } = LIMIT_RULES.payment;
  for (let i = 0; i < limit; i++) assert.equal(check('payment', 'u1', 1000 + i).success, true);
  const blocked = check('payment', 'u1', 2000);
  assert.equal(blocked.success, false);
  assert.equal(blocked.remaining, 0);
  assert.equal(check('payment', 'u2', 2000).success, true);            // other user unaffected
  assert.equal(check('checkout', 'u1', 2000).success, true);           // other limit unaffected
  assert.equal(check('payment', 'u1', 1000 + windowSec * 1000 + 1).success, true);   // window slid
});

test('memory limiter evicts old keys', () => {
  const check = createMemoryLimiter(2);
  check('action', 'a'); check('action', 'b'); check('action', 'c');
  // 'a' was evicted, so it starts fresh with the full allowance.
  assert.equal(check('action', 'a').remaining, LIMIT_RULES.action.limit - 1);
});
