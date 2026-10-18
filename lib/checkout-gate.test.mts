// Run: npx tsx --test lib/checkout-gate.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkoutGate, gateFromStatus, importerLoginUrl } from './checkout-gate.ts';

test('importers can check out', () => {
  assert.deepEqual(checkoutGate({ loading: false, signedIn: true, role: 'importer' }), { kind: 'ok' });
});

test('suppliers and admins are told to use an importer account', () => {
  assert.deepEqual(checkoutGate({ loading: false, signedIn: true, role: 'admin' }), { kind: 'wrong_role', role: 'admin' });
  assert.deepEqual(checkoutGate({ loading: false, signedIn: true, role: 'supplier' }), { kind: 'wrong_role', role: 'supplier' });
});

test('signed-out visitors are asked to sign in', () => {
  assert.deepEqual(checkoutGate({ loading: false, signedIn: false, role: null }), { kind: 'signed_out' });
});

test('still loading (session or profile) never enables checkout', () => {
  assert.equal(checkoutGate({ loading: true, signedIn: false, role: null }).kind, 'loading');
  assert.equal(checkoutGate({ loading: false, signedIn: true, role: null }).kind, 'loading');
});

test('API 401/403 map to the same gates; other errors do not', () => {
  assert.deepEqual(gateFromStatus(401, 'importer'), { kind: 'signed_out' });
  assert.deepEqual(gateFromStatus(403, 'admin'), { kind: 'wrong_role', role: 'admin' });
  assert.equal(gateFromStatus(403, null)?.kind, 'wrong_role');
  assert.equal(gateFromStatus(400, 'importer'), null);
  assert.equal(gateFromStatus(502, 'importer'), null);
});

test('login URL keeps a same-site return path and rejects open redirects', () => {
  assert.equal(importerLoginUrl('/dashboard'), '/login?redirectTo=%2Fdashboard');
  assert.equal(importerLoginUrl('//evil.example'), '/login?redirectTo=%2Fdashboard');
  assert.equal(importerLoginUrl('https://evil.example'), '/login?redirectTo=%2Fdashboard');
});
