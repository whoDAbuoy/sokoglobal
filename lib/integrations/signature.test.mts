// Run: npx tsx --test lib/integrations/signature.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { signedHeaders, signPayload, verifySignature } from './signature.ts';

const SECRET = 'x'.repeat(40);
const NOW = Date.UTC(2026, 9, 26, 12, 0, 0);
const TS = Math.floor(NOW / 1000);
const BODY = '{"limit":10}';

test('signPayload is HMAC-SHA256 over "timestamp.body", hex, sha256= prefix', () => {
  const expected = createHmac('sha256', SECRET).update(`${TS}.${BODY}`).digest('hex');
  assert.equal(signPayload(SECRET, TS, BODY), `sha256=${expected}`);
});

test('signedHeaders round-trips through verifySignature', () => {
  const h = signedHeaders(SECRET, BODY, NOW);
  assert.deepEqual(verifySignature(SECRET, { signature: h['X-SokoGlobal-Signature'], timestamp: h['X-SokoGlobal-Timestamp'] }, BODY, NOW), { ok: true });
});

test('verifySignature rejects tampering, wrong secrets, stale or missing headers', () => {
  const sig = signPayload(SECRET, TS, BODY);
  const ok = (s: string | null, t: string | null, body = BODY, secret: string | undefined = SECRET, now = NOW) =>
    verifySignature(secret, { signature: s, timestamp: t }, body, now);
  assert.deepEqual(ok(sig, String(TS), '{"limit":11}'), { ok: false, reason: 'mismatch' });
  assert.deepEqual(ok(signPayload('y'.repeat(40), TS, BODY), String(TS)), { ok: false, reason: 'mismatch' });
  assert.deepEqual(ok(sig, String(TS + 1)), { ok: false, reason: 'mismatch' }, 'the timestamp is part of what is signed');
  assert.deepEqual(ok(sig.toUpperCase(), String(TS)), { ok: false, reason: 'mismatch' });
  assert.deepEqual(ok(sig, String(TS), BODY, SECRET, NOW + 301_000), { ok: false, reason: 'stale' });
  assert.deepEqual(ok(sig, String(TS), BODY, SECRET, NOW - 301_000), { ok: false, reason: 'stale' });
  assert.deepEqual(ok(sig, String(TS), BODY, SECRET, NOW + 299_000), { ok: true });
  assert.deepEqual(ok(null, String(TS)), { ok: false, reason: 'missing' });
  assert.deepEqual(ok(sig, null), { ok: false, reason: 'missing' });
  assert.deepEqual(ok(sig, '12abc'), { ok: false, reason: 'missing' });
});

test('verifySignature fails closed without a strong secret', () => {
  const sig = signPayload('short', TS, BODY);
  assert.deepEqual(verifySignature(undefined, { signature: sig, timestamp: String(TS) }, BODY, NOW), { ok: false, reason: 'not_configured' });
  assert.deepEqual(verifySignature('short', { signature: sig, timestamp: String(TS) }, BODY, NOW), { ok: false, reason: 'not_configured' });
});
