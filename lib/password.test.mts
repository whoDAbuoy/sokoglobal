// Run: npx tsx --test lib/password.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passwordStrength, validatePasswordChange } from './password.ts';

test('strength matches sign-up scoring', () => {
  assert.equal(passwordStrength('short').label, 'Too short');
  assert.equal(passwordStrength('alllowercase').label, 'Weak');
  assert.equal(passwordStrength('MixedCaseOnly').label, 'Good');
  assert.equal(passwordStrength('Mixed-Case-99').label, 'Strong');
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
