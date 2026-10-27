// Run: npx tsx --test lib/account.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closedEmail, closureBlockers, isCloseConfirmation, redactRow } from './account.ts';
import { LEGAL_VERSION, needsTermsAcceptance } from './legal.ts';

test('closure blockers read as plain sentences; none means the account can close', () => {
  assert.deepEqual(closureBlockers({}), []);
  assert.deepEqual(closureBlockers(null), []);
  assert.match(closureBlockers({ open_orders: 1 })[0], /^1 order you placed is still open/);
  assert.match(closureBlockers({ open_orders: 2 })[0], /^2 orders you placed are still open/);
  assert.equal(closureBlockers({ payouts: 1, transfers: 3 }).length, 2);
  assert.match(closureBlockers({ staff: 1, open_orders: 4 })[0], /super admin/);
});

test('closing needs the typed confirmation', () => {
  assert.ok(isCloseConfirmation(' close '));
  assert.ok(!isCloseConfirmation('delete'));
});

test('closed accounts move to an address that can never receive mail', () => {
  assert.equal(closedEmail('abc'), 'closed+abc@closed.sokoglobal.invalid');
});

test('exports never contain secrets', () => {
  const r = redactRow({ id: 1, gateway_token: 't', account_number_secret_id: 's', backup_codes: ['x'], title: 'ok' });
  assert.deepEqual(r, { id: 1, gateway_token: '[redacted]', account_number_secret_id: '[redacted]', backup_codes: '[redacted]', title: 'ok' });
});

test('importers and suppliers must accept the current documents; staff and pre-040 profiles are not prompted', () => {
  assert.equal(needsTermsAcceptance({ role: 'importer', terms_version: null }), true);
  assert.equal(needsTermsAcceptance({ role: 'supplier', terms_version: '2000-01-01' }), true);
  assert.equal(needsTermsAcceptance({ role: 'supplier', terms_version: LEGAL_VERSION }), false);
  assert.equal(needsTermsAcceptance({ role: 'admin', terms_version: null }), false);
  assert.equal(needsTermsAcceptance({ role: 'importer' }), false);
  assert.equal(needsTermsAcceptance(null), false);
});
