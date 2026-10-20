// Run: npx tsx --test lib/monitoring/sentry-options.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrubEvent, tracesSampleRate } from './sentry-options.ts';

test('secrets are scrubbed from events', () => {
  const ev = scrubEvent({
    request: {
      url: 'https://soko.example/api/webhooks/daraja/s3cr3t-token?x=1', cookies: { sb: 'jwt' },
      headers: { Authorization: 'Bearer x', 'x-paystack-signature': 'abc', 'user-agent': 'ua' },
      data: { password: 'p', amount: 5 },
    },
    user: { id: 'u1', email: 'a@b.co', ip_address: '1.2.3.4' },
  });
  assert.equal(ev.request.url, 'https://soko.example/api/webhooks/daraja/[redacted]?x=1');
  assert.equal('cookies' in ev.request, false);
  assert.equal(ev.request.headers.Authorization, '[redacted]');
  assert.equal(ev.request.headers['x-paystack-signature'], '[redacted]');
  assert.equal(ev.request.headers['user-agent'], 'ua');
  assert.equal(ev.request.data.password, '[redacted]');
  assert.equal(ev.request.data.amount, 5);
  assert.deepEqual(ev.user, { id: 'u1' });
});

test('trace sample rate', () => {
  process.env.SENTRY_TRACES_SAMPLE_RATE = '0.25';
  assert.equal(tracesSampleRate(), 0.25);
  process.env.SENTRY_TRACES_SAMPLE_RATE = 'nope';
  process.env.SENTRY_ENVIRONMENT = 'production';
  assert.equal(tracesSampleRate(), 0.1);
  delete process.env.SENTRY_ENVIRONMENT; delete process.env.SENTRY_TRACES_SAMPLE_RATE;
});
