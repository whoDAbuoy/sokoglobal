// Run: npx tsx --test lib/integrations/events.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildN8nEnvelope, n8nMessage, parseCrmEvent, parseN8nEvent, partyUrl, toRecipient } from './events.ts';

const RFQ = {
  rfq_id: 'e3300000-0000-4000-8000-000000000001', title: 'Electric kettles', description: 'Need 500 kettles',
  quantity: 500, unit_of_measure: 'pieces', target_price_kes: 900.5, delivery_location: 'Nairobi',
  category_id: 'f3300000-0000-4000-8000-000000000001', category_name: 'Home', buyer_country: 'KE',
  created_at: '2026-10-26T09:15:00.123456+00:00', expires_at: '2026-11-09T09:15:00.123456+00:00',
};
const SUPPLIER = 'e3311111-1111-4111-8111-111111111111';
const BUYER = 'e3322222-2222-4222-8222-222222222222';

test('n8n RFQ payload as the trigger writes it is accepted', () => {
  const r = parseN8nEvent('rfq.created', RFQ);
  assert.equal(r.ok, true);
});

test('n8n payloads are strict: a buyer identity field is rejected, not forwarded', () => {
  for (const extra of [{ buyer_id: BUYER }, { buyer_name: 'Jane Doe' }, { buyer_company: 'Jane Co' }]) {
    const r = parseN8nEvent('rfq.created', { ...RFQ, ...extra });
    assert.equal(r.ok, false, `rejects ${Object.keys(extra)[0]}`);
  }
  const lead = { thread_id: RFQ.rfq_id, supplier_id: SUPPLIER, supplier_company: 'Sup Co', buyer_company: 'Buyer Co', buyer_country: 'KE', created_at: RFQ.created_at };
  assert.equal(parseN8nEvent('lead.inquiry_created', lead).ok, true);
  assert.equal(parseN8nEvent('lead.inquiry_created', { ...lead, buyer_name: 'Jane Doe' }).ok, false);
});

test('unknown event types and malformed payloads fail with a reason', () => {
  const unknown = parseN8nEvent('supplier.profile_viewed', {});
  assert.deepEqual(unknown, { ok: false, error: 'Unsupported event type supplier.profile_viewed' });
  assert.equal(parseN8nEvent('__proto__', {}).ok, false);
  const bad = parseN8nEvent('rfq.created', { ...RFQ, quantity: -3 });
  assert.equal(bad.ok, false);
  assert.match(!bad.ok ? bad.error : '', /quantity/);
  assert.equal(parseN8nEvent('escrow.status_changed', { order_id: RFQ.rfq_id, to_status: 'teleported', total_cents: 1, buyer_id: BUYER, occurred_at: RFQ.created_at }).ok, false);
});

test('CRM payloads require the identities the CRM needs', () => {
  const crm = { ...RFQ, product_id: RFQ.category_id, supplier_id: SUPPLIER, supplier_company: 'Sup Co', buyer_id: BUYER, buyer_name: 'Jane Doe', buyer_company: 'Buyer Co' };
  assert.equal(parseCrmEvent('rfq.created', crm).ok, true);
  const { supplier_id: _omit, ...noSupplier } = crm;
  assert.equal(parseCrmEvent('rfq.created', noSupplier).ok, false);
  assert.equal(parseCrmEvent('escrow.status_changed', {}).ok, false, 'escrow events are n8n-only');
});

test('toRecipient: E.164 phone becomes a WhatsApp id; bad numbers are dropped; opt-ins default safely', () => {
  const r = toRecipient({ supplier_id: SUPPLIER, company_name: 'Sup Co', country_code: 'CN', phone_number: '+8613800000000', email: 's@x.test', sms_alerts: true }, 'supplier', 'https://s/rfqs');
  assert.deepEqual(r, {
    party: 'supplier', user_id: SUPPLIER, company: 'Sup Co', country: 'CN', email: 's@x.test',
    phone_e164: '+8613800000000', whatsapp_id: '8613800000000', opt_in: { email: true, sms: true }, url: 'https://s/rfqs',
  });
  const noPhone = toRecipient({ id: BUYER, company_name: 'B', phone_number: '0712 345 678' }, 'buyer', 'u');
  assert.equal(noPhone?.phone_e164, null);
  assert.equal(noPhone?.whatsapp_id, null);
  assert.deepEqual(noPhone?.opt_in, { email: true, sms: false });
  assert.equal(toRecipient({ company_name: 'nobody' }, 'buyer', 'u'), null);
});

test('messages are ready to send and never name the buyer for RFQs', () => {
  const parsed = parseN8nEvent('rfq.created', RFQ);
  assert.ok(parsed.ok);
  const text = n8nMessage(parsed.event);
  assert.equal(text, 'New request for quotes on SokoGlobal from a buyer in KE: "Electric kettles" — 500 pieces, delivered to Nairobi. Target KES 900.5/unit. Quote before 9 Nov 2026.');

  const escrow = parseN8nEvent('escrow.status_changed', {
    order_id: 'a1b2c3d4-0000-4000-8000-000000000009', from_status: 'funded', to_status: 'in_transit', product_title: 'Kettle',
    total_cents: 57000, currency: 'USD', buyer_id: BUYER, supplier_id: SUPPLIER, occurred_at: RFQ.created_at,
  });
  assert.ok(escrow.ok);
  assert.equal(n8nMessage(escrow.event), 'SokoGlobal order a1b2c3d4 (Kettle) is in transit.');
  assert.equal(partyUrl(escrow.event, 'buyer', 'https://s'), 'https://s/dashboard/orders/a1b2c3d4-0000-4000-8000-000000000009');
  assert.equal(partyUrl(escrow.event, 'supplier', 'https://s'), 'https://s/supplier/orders/a1b2c3d4-0000-4000-8000-000000000009');
});

test('envelope: stable delivery id, attempt count, data, recipients and message', () => {
  const parsed = parseN8nEvent('rfq.created', RFQ);
  assert.ok(parsed.ok);
  const env = buildN8nEnvelope({ id: 42, created_at: RFQ.created_at, attempts: 2 }, parsed.event, []);
  assert.equal(env.id, 'evt_42');
  assert.equal(env.type, 'rfq.created');
  assert.equal(env.attempt, 2);
  assert.equal(env.occurred_at, RFQ.created_at);
  assert.deepEqual(env.data, RFQ);
  assert.match(env.message, /Electric kettles/);
});

test('a title at the database limit in emoji (2 UTF-16 units each) still validates', () => {
  assert.equal(parseN8nEvent('rfq.created', { ...RFQ, title: '📦'.repeat(140) }).ok, true);
});
