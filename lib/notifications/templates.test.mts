// Run: npx tsx --conditions=react-server --test lib/notifications/templates.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SMS_MAX, formatMoney, renderNotification } from './templates.ts';

const ORDER = { order_id: '3f2a9c1e-0000-4000-8000-000000000000', product_title: 'Shea butter trial batch', total_cents: 52500, currency: 'USD' };

test('order emails carry the amount, a deep link and plain-text + HTML bodies', () => {
  const m = renderNotification('order.funded', ORDER, 'https://sokoglobal.com/');
  assert.equal(m.subject, 'Payment received: Shea butter trial batch');
  assert.match(m.text, /\$525\.00/);
  assert.match(m.text, /https:\/\/sokoglobal\.com\/dashboard\/orders\/3f2a9c1e-/);
  assert.match(m.html, /href="https:\/\/sokoglobal\.com\/dashboard\/orders\//);
  assert.match(m.sms, /order 3F2A9C1E/);
});

test('expired orders explain the 24-hour rule', () => {
  const m = renderNotification('order.expired', ORDER, 'https://sokoglobal.com');
  assert.match(m.text, /24 hours/);
});

test('user-supplied text is escaped in HTML', () => {
  const m = renderNotification('kyc.document_rejected', { document_type: 'passport', reason: '<script>alert(1)</script> blurred' }, 'https://x.test');
  assert.doesNotMatch(m.html, /<script>/);
  assert.match(m.html, /&lt;script&gt;/);
  assert.match(m.subject, /passport/);
});

test('unknown templates fall back to generic copy; SMS stays short', () => {
  assert.equal(renderNotification('order.something_new', {}, 'https://x.test').subject, 'Update from SokoGlobal');
  const long = renderNotification('supplier.order_funded', { ...ORDER, product_title: 'x'.repeat(500) }, 'https://x.test');
  assert.ok(long.sms.length <= SMS_MAX);
});

test('money formatting tolerates bad input', () => {
  assert.match(formatMoney(123456, 'KES'), /^KES\s1,234\.56$/);   // Intl uses a no-break space
  assert.equal(formatMoney('oops', 'nope'), '$0.00');
});

test('milestone, dispatch, RFQ and restock notifications', () => {
  const deposit = renderNotification('order.deposit_paid', { ...ORDER, deposit_cents: 34_200, balance_cents: 79_800 }, 'https://x.test');
  assert.match(deposit.text, /\$342\.00/);
  assert.match(deposit.text, /\$798\.00/);
  const due = renderNotification('order.balance_due', { ...ORDER, total_cents: 79_800, carrier: 'DHL Express', tracking_number: 'JD014600006' }, 'https://x.test');
  assert.match(due.subject, /pay the balance/);
  assert.match(due.text, /via DHL Express \(waybill JD014600006\)/);
  assert.match(due.text, /\$798\.00/);
  assert.match(renderNotification('order.in_transit', { ...ORDER, carrier: 'Sendy', tracking_number: 'S-1' }, 'https://x.test').sms, /via Sendy/);
  assert.match(renderNotification('rfq.quote_received', { rfq_title: 'Cotton tees' }, 'https://x.test').text, /\/dashboard\/rfqs/);
  assert.match(renderNotification('supplier.rfq_accepted', { ...ORDER, rfq_title: 'Cotton tees' }, 'https://x.test').subject, /Quote accepted: Cotton tees/);
  const restock = renderNotification('retention.restock_reminder', { ...ORDER, days: 60 }, 'https://x.test');
  assert.match(restock.text, /60 days/);
  assert.match(restock.text, /\/dashboard\/orders#reorder/);
  for (const key of ['supplier.order_deposit', 'supplier.order_balance_paid']) {
    assert.notEqual(renderNotification(key, ORDER, 'https://x.test').subject, 'Update from SokoGlobal', key);
  }
});

test('admin chat messages link to the right inbox and quote the preview', () => {
  const buyer = renderNotification('support.admin_message', { kind: 'order', order_id: ORDER.order_id, preview: 'Your goods cleared customs', role: 'importer' }, 'https://x.test');
  assert.equal(buyer.subject, 'New message from SokoGlobal');
  assert.match(buyer.text, /about order 3F2A9C1E/);
  assert.match(buyer.text, /“Your goods cleared customs”/);
  assert.match(buyer.text, /\/dashboard\/messages/);
  assert.match(renderNotification('support.admin_message', { kind: 'direct', role: 'supplier' }, 'https://x.test').text, /\/supplier\/messages/);
});
