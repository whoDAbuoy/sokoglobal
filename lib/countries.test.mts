// Run: npx tsx --test lib/countries.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IMPORTER_COUNTRIES, SUPPLIER_COUNTRIES, dialCode } from './countries.ts';

test('China is offered to suppliers and buyers with +86', () => {
  assert.ok(SUPPLIER_COUNTRIES.includes('CN'));
  assert.ok(IMPORTER_COUNTRIES.includes('CN'));
  assert.equal(dialCode('CN'), '+86');
  assert.equal(dialCode('cn'), '+86');
});

test('every listed country has a dial code and a valid ISO code', () => {
  for (const c of [...SUPPLIER_COUNTRIES, ...IMPORTER_COUNTRIES]) {
    assert.match(c, /^[A-Z]{2}$/);
    assert.match(dialCode(c) ?? '', /^\+\d{1,3}$/, c);
  }
});

test('no duplicates within a list', () => {
  assert.equal(new Set(SUPPLIER_COUNTRIES).size, SUPPLIER_COUNTRIES.length);
  assert.equal(new Set(IMPORTER_COUNTRIES).size, IMPORTER_COUNTRIES.length);
});
