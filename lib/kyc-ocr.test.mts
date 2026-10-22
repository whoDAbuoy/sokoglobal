// Run: npx tsx --conditions=react-server --test lib/kyc-ocr.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareWithSubmission, confidenceScore, nameSimilarity, ocrVerdict, parseOcrOutput, type OcrFields } from './kyc-ocr.ts';

const ID: OcrFields = {
  legible: true, document_type_detected: 'national_id', full_name: 'WANJIKU AMINA ODHIAMBO', business_name: null,
  document_number: '12 345 678', date_of_birth: '1990-04-02', expiry_date: null, issuing_country: 'KE', text_confidence: 0.95, issues: [],
};
const SUBMITTED = { documentType: 'national_id' as const, documentNumber: '12345678', fullName: 'Amina Odhiambo', companyName: 'Amina Beauty Ltd', countryCode: 'KE' };

test('parses well-formed output and rejects the wrong shape', () => {
  const f = parseOcrOutput({ ...ID, text_confidence: 1.7, issuing_country: 'ke', date_of_birth: '02/04/1990', issues: ['glare', 3] });
  assert.ok(f);
  assert.equal(f.text_confidence, 1, 'clamped to 0–1');
  assert.equal(f.issuing_country, 'KE');
  assert.equal(f.date_of_birth, null, 'non-ISO dates are dropped');
  assert.deepEqual(f.issues, ['glare']);
  assert.equal(parseOcrOutput(null), null);
  assert.equal(parseOcrOutput({ legible: 'yes', text_confidence: 1 }), null);
  assert.equal(parseOcrOutput({ ...ID, document_type_detected: 'drivers_licence' })?.document_type_detected, 'unknown');
});

test('names match regardless of order, case, accents and extra middle names', () => {
  assert.equal(nameSimilarity('Amina Odhiambo', 'ODHIAMBO AMINA', 'person'), 1);
  assert.equal(nameSimilarity('José Núñez', 'JOSE NUNEZ', 'person'), 1);
  assert.equal(nameSimilarity('Amina Odhiambo', 'Brian Otieno', 'person'), 0);
  assert.equal(nameSimilarity('Amina Beauty Ltd', 'AMINA BEAUTY LIMITED', 'business'), 1, 'company suffixes ignored');
});

test('a matching national ID scores strong', () => {
  const c = compareWithSubmission(ID, SUBMITTED, new Date('2026-10-21'));
  assert.deepEqual([c.type, c.number, c.name, c.country, c.expired], ['match', 'match', 'match', 'match', false]);
  const score = confidenceScore(ID, c);
  assert.equal(score, 0.95);
  assert.equal(ocrVerdict(score), 'strong');
});

test('a different number or name drags the score down', () => {
  const c = compareWithSubmission({ ...ID, document_number: '99999999', full_name: 'Brian Otieno' }, SUBMITTED, new Date('2026-10-21'));
  assert.equal(c.number, 'mismatch');
  assert.equal(c.name, 'mismatch');
  assert.equal(ocrVerdict(confidenceScore(ID, c)), 'weak');
});

test('unreadable fields count as unknown, illegible scores zero, expired is capped', () => {
  const unread = compareWithSubmission({ ...ID, document_number: null, full_name: null }, SUBMITTED);
  assert.equal(unread.number, 'unknown');
  assert.equal(unread.name_similarity, null);
  assert.equal(confidenceScore({ ...ID, legible: false }, unread), 0);
  const expired = compareWithSubmission({ ...ID, expiry_date: '2020-01-01' }, SUBMITTED, new Date('2026-10-21'));
  assert.equal(expired.expired, true);
  assert.ok(confidenceScore(ID, expired) <= 0.2);
});

test('business documents compare the company name and ignore the issuing country', () => {
  const licence: OcrFields = { ...ID, document_type_detected: 'business_license', full_name: null, business_name: 'AMINA BEAUTY LIMITED', document_number: 'PVT-2019/88', issuing_country: 'AE' };
  const c = compareWithSubmission(licence, { ...SUBMITTED, documentType: 'business_license', documentNumber: 'PVT2019 88' });
  assert.deepEqual([c.type, c.number, c.name, c.country], ['match', 'match', 'match', 'unknown']);
});
