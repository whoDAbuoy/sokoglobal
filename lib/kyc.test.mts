// Run: npx tsx --conditions=react-server --test lib/kyc.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checklist, kycGate, kycHome, maskDocumentNumber, normalizeDocumentNumber, parseKycStatus, requirementsMet, verificationPath, type KycDoc } from './kyc.ts';

const ON = { listings: true, orders: true };

test('requirementsMet: an approved identity document AND an approved business document (mirrors kyc_requirements_met)', () => {
  const d = (document_type: KycDoc['document_type'], status: KycDoc['status']): KycDoc => ({ document_type, status });
  assert.equal(requirementsMet([]), false);
  assert.equal(requirementsMet([d('passport', 'approved')]), false);
  assert.equal(requirementsMet([d('passport', 'approved'), d('tax_certificate', 'pending')]), false);
  assert.equal(requirementsMet([d('national_id', 'approved'), d('business_license', 'approved')]), true);
  assert.equal(requirementsMet([d('passport', 'rejected'), d('national_id', 'approved'), d('tax_certificate', 'approved')]), true);
  assert.deepEqual(checklist([d('passport', 'rejected'), d('national_id', 'pending'), d('tax_certificate', 'approved')]), { identity: 'pending', business: 'approved' });
  assert.deepEqual(checklist([]), { identity: 'unsubmitted', business: 'unsubmitted' });
});

test('KYC gate: unverified accounts cannot open listing pages or post new orders', () => {
  const g = (path: string, status: Parameters<typeof kycGate>[0]['status'], extra: Partial<Parameters<typeof kycGate>[0]> = {}) =>
    kycGate({ path, method: 'GET', role: 'supplier', status, required: ON, ...extra });
  assert.deepEqual(g('/supplier/products/new', 'pending'), { kind: 'redirect', to: '/supplier/verification?next=%2Fsupplier%2Fproducts%2Fnew' });
  assert.equal(g('/supplier/products/import', 'unsubmitted').kind, 'redirect');
  assert.equal(g('/supplier/products/import', 'rejected', { isServerAction: true, method: 'POST' }).kind, 'forbid', 'server actions get a 403, not a redirect');
  assert.equal(g('/supplier/products/new', 'approved').kind, 'allow');
  assert.equal(g('/supplier/products/abc', 'pending').kind, 'allow', 'editing existing drafts / photos stays open');
  assert.equal(g('/supplier', 'pending').kind, 'allow');
  const buy = (path: string, status: Parameters<typeof kycGate>[0]['status'], required = ON) => kycGate({ path, method: 'POST', role: 'importer', status, required }).kind;
  assert.equal(buy('/api/orders', 'unsubmitted'), 'forbid');
  assert.equal(buy('/api/checkout', 'pending'), 'forbid');
  assert.equal(buy('/api/pools/123/join', 'rejected'), 'forbid');
  assert.equal(buy('/api/orders/123/checkout', 'unsubmitted'), 'allow', 'paying an order that already exists is not a new order');
  assert.equal(buy('/api/orders', 'approved'), 'allow');
  assert.equal(buy('/api/orders', 'unsubmitted', { listings: true, orders: false }), 'allow', 'control-room switch off');
  assert.equal(buy('/api/orders', null), 'allow', 'migration not applied');
  assert.equal(kycGate({ path: '/api/orders', method: 'GET', role: 'importer', status: 'pending', required: ON }).kind, 'allow');
});

test('document numbers, paths and masking', () => {
  assert.equal(normalizeDocumentNumber(' a1234567 '), 'A1234567');
  assert.equal(normalizeDocumentNumber('PIN-A00 123'), 'PIN-A00 123');
  assert.equal(normalizeDocumentNumber('!!'), null);
  assert.equal(normalizeDocumentNumber('ab'), null);
  const uid = '00000000-0000-4000-8000-00000000000c', id = '11111111-1111-4111-8111-111111111111';
  const p = verificationPath(uid, id, 'pdf');
  assert.equal(p, `${uid}/verification/${id}.pdf`);
  assert.match(p, /^[0-9a-f-]{36}\/verification\/[0-9a-f-]{36}\.(pdf|jpg|png)$/, 'matches the kyc_verifications.document_url check');
  assert.equal(maskDocumentNumber('A1234567'), '••••4567');
  assert.equal(maskDocumentNumber('ABC'), 'ABC');
  assert.equal(kycHome('supplier'), '/supplier/verification');
  assert.equal(kycHome('importer'), '/dashboard/kyc');
  assert.equal(parseKycStatus('approved'), 'approved');
  assert.equal(parseKycStatus('submitted'), null);
});
