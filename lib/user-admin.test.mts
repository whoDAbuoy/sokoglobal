// Run: npx tsx --test lib/user-admin.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deletionBlockMessage, parseRoleFilter, parseStatusFilter, profileDiff, userStatus, validateProfileChange } from './user-admin.ts';

test('filters only accept known values', () => {
  assert.equal(parseRoleFilter('supplier'), 'supplier');
  assert.equal(parseRoleFilter('root'), '');
  assert.equal(parseStatusFilter('banned'), 'banned');
  assert.equal(parseStatusFilter(undefined), '');
});

test('status badge: ban outranks a pending edit', () => {
  assert.equal(userStatus({ is_banned: false, pending_change: false }).label, 'Active');
  assert.equal(userStatus({ is_banned: false, pending_change: true }).label, 'Pending edit');
  assert.equal(userStatus({ is_banned: true, pending_change: true }).label, 'Banned');
});

test('deletion is refused while history exists', () => {
  assert.equal(deletionBlockMessage({}), '');
  assert.equal(deletionBlockMessage(null), '');
  assert.match(deletionBlockMessage({ orders: 2, payouts: 1 }), /2 orders, 1 payout\. .*ban the account/);
  assert.match(deletionBlockMessage({ products: 1 }), /1 product\./);
  assert.equal(deletionBlockMessage({ self: 1 }), 'You cannot delete your own account.');
  assert.equal(deletionBlockMessage({ admin: 1 }), 'Admin accounts cannot be deleted here.');
});

test('profile change validation mirrors the SQL', () => {
  const cur = { full_name: 'Amara Okafor', company_name: 'Glow Boutique' };
  assert.deepEqual(validateProfileChange({ full_name: '  Amara   N. Okafor ', company_name: 'Glow Boutique' }, cur),
    { ok: true, full_name: 'Amara N. Okafor', company_name: 'Glow Boutique', note: null });
  assert.equal(validateProfileChange({ full_name: 'Amara Okafor', company_name: 'Glow Boutique ' }, cur).ok, false);
  assert.equal(validateProfileChange({ full_name: 'A', company_name: 'Glow' }, cur).ok, false);
  assert.equal(validateProfileChange({ full_name: 'Amara', company_name: 'x'.repeat(161) }, cur).ok, false);
  const r = validateProfileChange({ full_name: 'Amara', company_name: 'Glow', note: ' legal name change ' }, cur);
  assert.equal(r.ok && r.note, 'legal name change');
});

test('diff marks changed fields', () => {
  const d = profileDiff({ current_full_name: 'A B', current_company_name: 'C', full_name: 'A B', company_name: 'D' });
  assert.deepEqual(d.map((x) => x.changed), [false, true]);
});
