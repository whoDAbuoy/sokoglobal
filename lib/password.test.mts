// Run: npx tsx --test lib/password.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRecentRecovery, newPasswordError, passwordStrength, validatePasswordChange, validatePasswordReset } from './password.ts';

test('strength matches sign-up scoring', () => {
  assert.equal(passwordStrength('short').label, 'Too short');
  assert.equal(passwordStrength('alllowercase').label, 'Weak');
  assert.equal(passwordStrength('MixedCaseOnly').label, 'Good');
  assert.equal(passwordStrength('Mixed-Case-99').label, 'Strong');
  assert.equal(passwordStrength('Ab1!xy').label, 'Too short', 'mixed but short is still too short');
});

test('sign-up uses the same rule: 10 characters minimum', () => {
  assert.equal(newPasswordError('Ab1!xy'), 'Use at least 10 characters.');
  assert.equal(newPasswordError('alllowercase'), 'Add upper & lower case letters, or a number and a symbol.');
  assert.equal(newPasswordError('MixedCaseOnly'), null);
});

test('valid change has no errors', () => {
  assert.deepEqual(validatePasswordChange('Old-Pass-123', 'New-Pass-456!', 'New-Pass-456!'), {});
});

test('each field reports its own problem', () => {
  assert.equal(validatePasswordChange('', 'New-Pass-456!', 'New-Pass-456!').current, 'Enter your current password.');
  assert.equal(validatePasswordChange('x', 'Ab1!', 'Ab1!').next, 'Use at least 10 characters.');
  assert.match(validatePasswordChange('x', 'alllowercase', 'alllowercase').next ?? '', /upper & lower/);
  assert.match(validatePasswordChange('Same-Pass-123', 'Same-Pass-123', 'Same-Pass-123').next ?? '', /different/);
  assert.equal(validatePasswordChange('x', 'New-Pass-456!', 'New-Pass-457!').confirm, 'Passwords don’t match.');
  assert.equal(validatePasswordChange('x', 'New-Pass-456!', '').confirm, 'Confirm your new password.');
  assert.match(validatePasswordChange('x', 'Aa1!' + 'a'.repeat(80), 'Aa1!' + 'a'.repeat(80)).next ?? '', /at most 72/);
});

test('reset needs only the new password and its confirmation', () => {
  assert.deepEqual(validatePasswordReset('New-Pass-456!', 'New-Pass-456!'), {});
  assert.equal(validatePasswordReset('Ab1!', 'Ab1!').next, 'Use at least 10 characters.');
  assert.equal(validatePasswordReset('New-Pass-456!', 'nope').confirm, 'Passwords don’t match.');
  assert.equal(validatePasswordReset('New-Pass-456!', 'New-Pass-456!').current, undefined);
});

test('only a recent reset-link session may skip the current password', () => {
  const now = 1_800_000_000;
  assert.equal(isRecentRecovery([{ method: 'recovery', timestamp: now - 120 }], now), true);
  assert.equal(isRecentRecovery([{ method: 'password', timestamp: now - 5 }], now), false);
  assert.equal(isRecentRecovery([{ method: 'recovery', timestamp: now - 2 * 3600 }], now), false);   // link used hours ago
  assert.equal(isRecentRecovery([{ method: 'recovery', timestamp: now + 3600 }], now), false);       // from the future
  assert.equal(isRecentRecovery(['recovery'], now), false);                                          // no timestamp
  assert.equal(isRecentRecovery(undefined, now), false);
});
