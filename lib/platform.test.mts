// Run: npx tsx --conditions=react-server --test lib/platform.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OPEN_PLATFORM, maintenanceDecision, parsePlatformSettings, transactBlock } from './platform.ts';

test('parsePlatformSettings: missing table / junk reads as open', () => {
  assert.deepEqual(parsePlatformSettings(null), OPEN_PLATFORM);
  assert.deepEqual(parsePlatformSettings({ pause_new_orders: 'yes' }).pause_new_orders, false);
  assert.equal(parsePlatformSettings({ banner_message: '   ' }).banner_message, null);
});

test('transactBlock: freeze > maintenance > pause flags, by kind', () => {
  const s = { ...OPEN_PLATFORM };
  assert.equal(transactBlock(s, { is_frozen: false }, 'order'), null);
  assert.equal(transactBlock(s, { is_frozen: true }, 'order')?.status, 423);
  assert.equal(transactBlock({ ...s, maintenance_mode: true }, null, 'checkout')?.status, 503);
  assert.match(transactBlock({ ...s, pause_new_orders: true }, null, 'order')!.error, /New orders are paused/);
  assert.equal(transactBlock({ ...s, pause_new_orders: true }, null, 'checkout'), null, 'saved orders can still be paid');
  assert.match(transactBlock({ ...s, pause_checkout: true }, null, 'checkout')!.error, /Checkout is paused/);
  assert.equal(transactBlock({ ...s, pause_checkout: true }, null, 'order'), null);
});

test('maintenanceDecision: admins pass; others get the page or a 503', () => {
  const d = (path: string, isAdminUser = false, isServerAction = false) => maintenanceDecision({ maintenance: true, path, isAdminUser, isServerAction });
  assert.equal(maintenanceDecision({ maintenance: false, path: '/dashboard', isAdminUser: false }), 'allow');
  assert.equal(d('/dashboard', true), 'allow');
  assert.equal(d('/dashboard'), 'page');
  assert.equal(d('/'), 'page');
  assert.equal(d('/api/orders'), 'api');
  assert.equal(d('/supplier', false, true), 'api');
  assert.equal(d('/login'), 'allow', 'staff must be able to sign in');
  assert.equal(d('/auth/callback'), 'allow');
  assert.equal(d('/maintenance'), 'allow');
  assert.equal(d('/admin/control'), 'allow', 'non-admins still 404 there');
  assert.equal(d('/loginx'), 'page');
});
