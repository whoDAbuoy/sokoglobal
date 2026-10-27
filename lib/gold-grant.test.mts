// Run: npx tsx --test lib/gold-grant.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fieldErrors, formatPeriodEnd, grantGoldInput, revokeGoldInput } from './gold-grant.ts';

test('grant input: trims and lower-cases the email, coerces the month count', () => {
  const r = grantGoldInput.safeParse({ email: '  MmboneCamilla@Gmail.com ', months: '12', reason: '  Launch partner  ' });
  assert.ok(r.success);
  assert.deepEqual(r.data, { email: 'mmbonecamilla@gmail.com', months: 12, reason: 'Launch partner' });
});

test('grant input: only the offered month counts, a real email and a reason', () => {
  const bad = grantGoldInput.safeParse({ email: 'not-an-email', months: '7', reason: 'ok' });
  assert.ok(!bad.success);
  assert.deepEqual(Object.keys(fieldErrors(bad.error)).sort(), ['email', 'months', 'reason']);
  assert.equal(fieldErrors(bad.error).months, 'Choose 1, 3, 6, 12 or 24 months');
  assert.ok(!grantGoldInput.safeParse({ email: 'a@b.co', months: 25, reason: 'Launch partner' }).success);
  assert.ok(!grantGoldInput.safeParse({ email: 'a@b.co', months: 1.5, reason: 'Launch partner' }).success);
  assert.ok(!grantGoldInput.safeParse({ email: 'a@b.co', months: 12, reason: 'x'.repeat(501) }).success);
});

test('revoke input needs an email and a reason', () => {
  assert.ok(revokeGoldInput.safeParse({ email: 'a@b.co', reason: 'Wrong account' }).success);
  assert.ok(!revokeGoldInput.safeParse({ email: 'a@b.co', reason: '' }).success);
});

test('formatPeriodEnd is a readable UTC date', () => {
  assert.equal(formatPeriodEnd('2027-10-27T08:00:00.000000+00:00'), '27 October 2027');
});
