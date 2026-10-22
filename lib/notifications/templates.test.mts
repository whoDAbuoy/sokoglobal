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
