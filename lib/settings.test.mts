// Run: npx tsx --conditions=react-server --test lib/settings.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AVATAR_MAX_BYTES, avatarObjectPath, checkAvatarFile, normalizeBio, isNotificationPref, normalizeDesignation, normalizePhone, parseSettingsTab, sniffImageType,
} from './settings.ts';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const GIF = new TextEncoder().encode('GIF89a....');
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>');

test('normalizePhone: international, local with the account country, 00 prefix, blank', () => {
  assert.deepEqual(normalizePhone('+254 712 345 678', 'KE'), { ok: true, phone: '+254712345678' });
  assert.deepEqual(normalizePhone('0712-345-678', 'KE'), { ok: true, phone: '+254712345678' });
  assert.deepEqual(normalizePhone('00 44 20 7946 0958', 'KE'), { ok: true, phone: '+442079460958' });
  assert.deepEqual(normalizePhone('(415) 555-0132', 'US'), { ok: true, phone: '+14155550132' });
  assert.deepEqual(normalizePhone('   ', 'KE'), { ok: true, phone: null });
  assert.equal(normalizePhone('call me', 'KE').ok, false);
  assert.equal(normalizePhone('12', 'KE').ok, false);
  assert.equal(normalizePhone('+0712345678', 'KE').ok, false);
  assert.equal(normalizePhone('0712345678', 'ZZ').ok, false, 'unknown country needs a + prefix');
  for (const r of [normalizePhone('+254712345678', 'KE'), normalizePhone('0712345678', 'KE')]) {
    if (r.ok && r.phone) assert.match(r.phone, /^\+[1-9][0-9]{7,14}$/, 'matches the profiles_phone_e164 constraint');
  }
});

test('normalizeDesignation', () => {
  assert.deepEqual(normalizeDesignation('  Head   of Sourcing '), { ok: true, value: 'Head of Sourcing' });
  assert.deepEqual(normalizeDesignation(''), { ok: true, value: null });
  assert.equal(normalizeDesignation('x').ok, false);
  assert.equal(normalizeDesignation('x'.repeat(81)).ok, false);
});

test('avatar files: magic bytes decide the type, not the browser label', () => {
  assert.equal(sniffImageType(PNG), 'image/png');
  assert.equal(sniffImageType(JPG), 'image/jpeg');
  assert.equal(sniffImageType(GIF), null);
  assert.equal(sniffImageType(SVG), null);
  assert.deepEqual(checkAvatarFile({ size: 2048, type: 'image/png' }, JPG), { ok: true, type: 'image/jpeg' });
  assert.equal(checkAvatarFile({ size: 2048, type: 'image/png' }, SVG).ok, false, 'SVG renamed to .png is refused');
  assert.equal(checkAvatarFile({ size: AVATAR_MAX_BYTES, type: 'image/jpeg' }, JPG).ok, true, '5 MB is allowed');
  assert.equal(checkAvatarFile({ size: AVATAR_MAX_BYTES + 1, type: 'image/jpeg' }, JPG).ok, false);
  assert.equal(checkAvatarFile({ size: 0, type: 'image/jpeg' }, JPG).ok, false);
});

test('avatar object path lives in the user folder and matches the profiles_guard_avatar pattern', () => {
  const uid = '00000000-0000-4000-8000-00000000000c';
  const p = avatarObjectPath(uid, 'ab'.repeat(32), 'image/jpeg');
  assert.equal(p, `${uid}/${'ab'.repeat(12)}.jpg`);
  const url = `https://ozqcexample.supabase.co/storage/v1/object/public/avatars/${p}`;
  assert.match(url, new RegExp(`^https://[A-Za-z0-9.-]+(:[0-9]+)?/storage/v1/object/public/avatars/${uid}/[A-Za-z0-9._-]{1,100}$`));
  assert.ok(avatarObjectPath(uid, 'cd'.repeat(32), 'image/png').endsWith('.png'));
});

test('settings tabs and notification keys', () => {
  assert.equal(parseSettingsTab('account'), 'profile', 'old /dashboard/profile?tab=account links');
  assert.equal(parseSettingsTab('security'), 'security');
  assert.equal(parseSettingsTab('store'), 'store', 'store / business details tab');
  assert.equal(parseSettingsTab('nope'), 'profile');
  assert.equal(parseSettingsTab(undefined), 'profile');
  assert.equal(isNotificationPref('sms_alerts'), true);
  assert.equal(isNotificationPref('two_factor_enabled'), false, 'cannot be flipped through the preferences action');
});

test('normalizeBio: required, 20–500 characters, whitespace tidied', () => {
  assert.deepEqual(normalizeBio('  We  import   skincare\r\n\n\n\nfor Nairobi boutiques.  '), { ok: true, value: 'We import skincare\n\nfor Nairobi boutiques.' });
  assert.equal(normalizeBio('').ok, false);
  assert.equal(normalizeBio('   ').ok, false);
  assert.equal(normalizeBio('too short').ok, false);
  assert.equal(normalizeBio('x'.repeat(20)).ok, true);
  assert.equal(normalizeBio('x'.repeat(500)).ok, true);
  assert.equal(normalizeBio('x'.repeat(501)).ok, false);
});
