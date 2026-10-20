// Run: npx tsx --conditions=react-server --test lib/auth/admin-access.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  adminLevel, formatTimeLeft, grantIsActive, homePathFor, isAdmin, isPermanentAdmin, isSuperAdmin, parseAdminAccess,
  requestFingerprint, validateGrantRequest,
} from './admin-access.ts';

const NOW = Date.parse('2026-10-20T12:00:00Z');
const inMin = (m: number) => new Date(NOW + m * 60_000).toISOString();

test('roles: super_admin and admin are admins without any grant', () => {
  assert.equal(adminLevel({ role: 'super_admin' }, NOW), 'super');
  assert.equal(adminLevel({ role: 'admin' }, NOW), 'admin');
  assert.equal(isSuperAdmin({ role: 'super_admin' }), true);
  assert.equal(isSuperAdmin({ role: 'admin' }), false);
  assert.equal(isPermanentAdmin({ role: 'admin' }), true);
  assert.equal(isAdmin({ role: 'importer' }, NOW), false);
  assert.equal(isAdmin(null), false);
});

test('delegated grant: admin until expires_at, then nothing (checked against now)', () => {
  const p = { role: 'importer' as const, admin_access: { level: 'delegated' as const, expires_at: inMin(30) } };
  assert.equal(adminLevel(p, NOW), 'delegated');
  assert.equal(isAdmin(p, NOW), true);
  assert.equal(isAdmin(p, NOW + 31 * 60_000), false, 'expired grant must not count');
  assert.equal(isPermanentAdmin(p), false, 'delegates never get the kill switch');
  assert.equal(isSuperAdmin(p), false);
});

test('parseAdminAccess: rejects malformed, unknown and expired delegated access', () => {
  assert.deepEqual(parseAdminAccess({ level: 'super' }, NOW), { level: 'super' });
  assert.equal(parseAdminAccess(null, NOW), null);
  assert.equal(parseAdminAccess({ level: 'god' }, NOW), null);
  assert.equal(parseAdminAccess({ level: 'delegated' }, NOW), null);
  assert.equal(parseAdminAccess({ level: 'delegated', expires_at: inMin(-1) }, NOW), null);
  assert.deepEqual(parseAdminAccess({ level: 'delegated', expires_at: inMin(60), grant_id: 'g1' }, NOW),
    { level: 'delegated', expires_at: inMin(60), grant_id: 'g1' });
});

test('grantIsActive: revoked or past expiry is inactive', () => {
  assert.equal(grantIsActive({ revoked_at: null, expires_at: inMin(5) }, NOW), true);
  assert.equal(grantIsActive({ revoked_at: inMin(-1), expires_at: inMin(5) }, NOW), false);
  assert.equal(grantIsActive({ revoked_at: null, expires_at: inMin(0) }, NOW), false, 'now() < expires_at is strict');
});

test('validateGrantRequest mirrors super_grant_admin bounds (5 min – 30 days, reason ≥ 5)', () => {
  const ok = validateGrantRequest({ hours: 24, reason: '  Cover   the review queue ' }, NOW);
  assert.deepEqual(ok, { ok: true, expiresAt: inMin(24 * 60), reason: 'Cover the review queue' });
  assert.equal(validateGrantRequest({ hours: 0.05, reason: 'valid reason' }, NOW).ok, false);   // 3 minutes
  assert.equal(validateGrantRequest({ hours: 721, reason: 'valid reason' }, NOW).ok, false);    // > 30 days
  assert.equal(validateGrantRequest({ hours: 720, reason: 'valid reason' }, NOW).ok, true);
  assert.equal(validateGrantRequest({ hours: 1, reason: 'hi' }, NOW).ok, false);
  assert.equal(validateGrantRequest({ hours: Number.NaN, reason: 'valid reason' }, NOW).ok, false);
});

test('formatTimeLeft', () => {
  assert.equal(formatTimeLeft(inMin(135), NOW), '2h 15m left');
  assert.equal(formatTimeLeft(inMin(60 * 24 * 3 + 120), NOW), '3d 2h left');
  assert.equal(formatTimeLeft(inMin(0.5), NOW), '1m left');
  assert.equal(formatTimeLeft(inMin(-5), NOW), 'expired');
});

test('homePathFor: delegated admins keep their own portal', () => {
  assert.equal(homePathFor('super_admin'), '/admin');
  assert.equal(homePathFor('admin'), '/admin');
  assert.equal(homePathFor('supplier'), '/supplier');
  assert.equal(homePathFor('importer'), '/dashboard');
  assert.equal(homePathFor(undefined), '/dashboard');
});

test('requestFingerprint: first forwarded hop, rejects junk, trims UA', () => {
  const h = (m: Record<string, string>) => ({ get: (k: string) => m[k] ?? null });
  assert.deepEqual(requestFingerprint(h({ 'x-forwarded-for': '41.90.1.2, 10.0.0.1', 'user-agent': 'UA' })), { ip: '41.90.1.2', ua: 'UA' });
  assert.equal(requestFingerprint(h({ 'x-forwarded-for': '<script>' })).ip, null);
  assert.equal(requestFingerprint(h({ 'x-real-ip': '2001:db8::1' })).ip, '2001:db8::1');
  assert.equal(requestFingerprint(h({ 'user-agent': 'x'.repeat(900) })).ua?.length, 400);
});
