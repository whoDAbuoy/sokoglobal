// Run: npx tsx --conditions=react-server --test lib/security/two-factor.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { generate } from 'otplib';
import {
  BACKUP_CODE_COUNT, TwoFactorConfigError, consumeBackupCode, decryptSecret, encryptSecret, generateBackupCodes, groupSecret,
  hashBackupCode, isBackupCodeFormat, isTotpFormat, newTotpSecret, otpauthUri, parseEncryptionKey, safeReturnPath, sessionClaims,
  verifyTotp,
} from './two-factor.ts';

const KEY = randomBytes(32);
const U1 = '00000000-0000-4000-8000-000000000001';
const U2 = '00000000-0000-4000-8000-000000000002';

test('encryption key: base64 or hex, exactly 32 bytes, clear error when missing', () => {
  assert.equal(parseEncryptionKey(KEY.toString('base64')).length, 32);
  assert.equal(parseEncryptionKey(KEY.toString('hex')).length, 32);
  assert.throws(() => parseEncryptionKey(undefined), TwoFactorConfigError);
  assert.throws(() => parseEncryptionKey(randomBytes(16).toString('base64')), /32 bytes/);
});

test('secret encryption: round trip, random IV, bound to the user, tamper-evident', () => {
  const secret = newTotpSecret();
  assert.match(secret, /^[A-Z2-7]{32}$/);
  const a = encryptSecret(secret, U1, KEY);
  const b = encryptSecret(secret, U1, KEY);
  assert.notEqual(a, b, 'fresh IV each time');
  assert.ok(!a.includes(secret));
  assert.equal(decryptSecret(a, U1, KEY), secret);
  assert.throws(() => decryptSecret(a, U2, KEY), 'ciphertext copied to another user must not decrypt');
  assert.throws(() => decryptSecret(a, U1, randomBytes(32)));
  const [v, iv, tag, ct] = a.split('.');
  const flipped = Buffer.from(ct, 'base64url'); flipped[0] ^= 1;
  assert.throws(() => decryptSecret([v, iv, tag, flipped.toString('base64url')].join('.'), U1, KEY));
  assert.throws(() => decryptSecret('plain', U1, KEY));
});

test('TOTP: current code accepted, ±30 s drift accepted, replay and far codes refused', async () => {
  const secret = newTotpSecret();
  const now = 1_792_480_000;
  const code = await generate({ secret, epoch: now });
  const ok = await verifyTotp(secret, code, null, now);
  assert.ok(ok.valid);
  assert.equal((await verifyTotp(secret, ` ${code.slice(0, 3)} ${code.slice(3)} `, null, now)).valid, true, 'spaces tolerated');
  assert.equal((await verifyTotp(secret, await generate({ secret, epoch: now - 30 }), null, now)).valid, true);
  assert.equal((await verifyTotp(secret, await generate({ secret, epoch: now - 120 }), null, now)).valid, false);
  if (ok.valid) assert.equal((await verifyTotp(secret, code, ok.timeStep, now)).valid, false, 'same step twice is a replay');
  assert.equal((await verifyTotp(secret, 'abcdef', null, now)).valid, false);
  assert.equal((await verifyTotp(secret, '12345', null, now)).valid, false);
  assert.equal(isTotpFormat('123 456'), true);
  assert.equal(isTotpFormat('12a456'), false);
});

test('otpauth URI and grouping for manual entry', () => {
  const s = newTotpSecret();
  const uri = otpauthUri(s, 'ops@sokoglobal.shop');
  assert.match(uri, /^otpauth:\/\/totp\/SokoGlobal:ops%40sokoglobal\.shop\?/);
  assert.match(uri, new RegExp(`secret=${s}`));
  assert.match(uri, /issuer=SokoGlobal/);
  assert.equal(groupSecret('ABCDEFGHIJ'), 'ABCD EFGH IJ');
});

test('backup codes: ten unique codes, hashed with the key, each works once', () => {
  const codes = generateBackupCodes();
  assert.equal(codes.length, BACKUP_CODE_COUNT);
  assert.equal(new Set(codes).size, BACKUP_CODE_COUNT);
  for (const c of codes) assert.match(c, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  const hashes = codes.map((c) => hashBackupCode(c, KEY));
  assert.ok(hashes.every((h) => /^[0-9a-f]{64}$/.test(h) && !codes.some((c) => h.includes(c))));
  assert.notEqual(hashBackupCode(codes[0], KEY), hashBackupCode(codes[0], randomBytes(32)), 'keyed, not a bare hash');
  const after = consumeBackupCode(hashes, codes[3].toLowerCase().replace('-', ' '), KEY);
  assert.ok(after && after.length === BACKUP_CODE_COUNT - 1);
  assert.equal(consumeBackupCode(after!, codes[3], KEY), null, 'single use');
  assert.equal(consumeBackupCode(hashes, 'ZZZZ-ZZZZ', KEY), null);
  assert.equal(consumeBackupCode(hashes, 'short', KEY), null);
  assert.equal(isBackupCodeFormat('abcd-efgh'), true);
});

test('sessionClaims reads sub + session_id; rejects junk', () => {
  const tok = (p: object) => `x.${Buffer.from(JSON.stringify(p)).toString('base64url')}.sig`;
  assert.deepEqual(sessionClaims(tok({ sub: U1, session_id: U2 })), { sub: U1, sessionId: U2 });
  assert.equal(sessionClaims(tok({ sub: U1 })), null);
  assert.equal(sessionClaims(tok({ sub: U1, session_id: 'nope' })), null);
  assert.equal(sessionClaims('garbage'), null);
  assert.equal(sessionClaims(null), null);
});

test('safeReturnPath keeps same-site paths only', () => {
  assert.equal(safeReturnPath('/admin/control?order=1'), '/admin/control?order=1');
  assert.equal(safeReturnPath('//evil.com'), '/');
  assert.equal(safeReturnPath('https://evil.com'), '/');
  assert.equal(safeReturnPath('/\\evil.com'), '/');
  assert.equal(safeReturnPath('/auth/2fa?x'), '/', 'never loops back to the challenge');
  assert.equal(safeReturnPath(null, '/dashboard'), '/dashboard');
});

import { twoFactorGate } from './two-factor-gate.ts';

test('twoFactorGate: unverified sessions are challenged on private pages and refused on the API', () => {
  const g = (path: string, enabled = true, ok = false, isServerAction = false) => twoFactorGate({ path, enabled, ok, isServerAction });
  assert.equal(g('/dashboard', false), 'allow', '2FA off');
  assert.equal(g('/dashboard', true, true), 'allow', 'verified session');
  assert.equal(g('/dashboard'), 'challenge');
  assert.equal(g('/admin/control'), 'challenge');
  assert.equal(g('/supplier/products/new'), 'challenge');
  assert.equal(g('/dashboardx'), 'allow');
  assert.equal(g('/api/orders'), 'api');
  assert.equal(g('/admin/users', true, false, true), 'api', 'server actions get a 401, not a redirect');
  assert.equal(g('/api/auth/2fa/challenge'), 'allow', 'the challenge endpoint stays reachable');
  assert.equal(g('/auth/2fa'), 'allow');
  assert.equal(g('/login'), 'allow');
  assert.equal(g('/'), 'allow');
});

import { financialOverrideBlock } from './two-factor-gate.ts';

test('financial overrides need 2FA on and verified (unless migration 016 is not applied)', () => {
  assert.match(financialOverrideBlock({ enabled: false, ok: true })!, /Turn on two-factor/);
  assert.match(financialOverrideBlock({ enabled: true, ok: false })!, /Verify your two-factor code/);
  assert.equal(financialOverrideBlock({ enabled: true, ok: true }), null);
});
