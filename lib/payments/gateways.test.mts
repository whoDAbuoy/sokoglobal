// Run: npx tsx --conditions=react-server --test lib/payments/gateways.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTokenXml, dpoState, parseVerifyResponse, toMinor, verifyTokenXml, xmlValue } from './dpo.ts';
import { approvalLink, orderBody, summarizeOrder, webhookOrderId } from './paypal.ts';
import { airtelAmount, airtelConfig, airtelState, msisdnLocal, normalizeAirtelPhone, parseCallback } from './airtel.ts';

test('DPO createToken XML: amount in major units, values escaped, our reference as CompanyRef', () => {
  const xml = createTokenXml({ companyToken: 'TOKEN', serviceType: '3854' }, {
    amountMinor: 58140, currency: 'USD', reference: 'ord.abc-2', redirectUrl: 'https://x.test/o?status=processing&gw=dpo',
    backUrl: 'https://x.test/o', description: 'Soap & <Co>', customerName: 'Amara Okafor',
  }, new Date('2026-10-23T09:05:00Z'));
  assert.equal(xmlValue(xml, 'PaymentAmount'), '581.40');
  assert.equal(xmlValue(xml, 'CompanyRef'), 'ord.abc-2');
  assert.match(xml, /<RedirectURL>https:\/\/x\.test\/o\?status=processing&amp;gw=dpo<\/RedirectURL>/);
  assert.match(xml, /<ServiceDescription>Soap &amp; &lt;Co&gt;<\/ServiceDescription>/);
  assert.equal(xmlValue(xml, 'ServiceDate'), '2026/10/23 09:05');
  assert.equal(xmlValue(xml, 'customerLastName'), 'Okafor');
  assert.match(verifyTokenXml('T', 'ABC-1'), /<Request>verifyToken<\/Request>/);
});

test('DPO verifyToken: only 000 is paid; amount and currency are read for the escrow check', () => {
  const v = parseVerifyResponse('<API3G><Result>000</Result><ResultExplanation>Transaction Paid</ResultExplanation><TransactionAmount>581.40</TransactionAmount><TransactionCurrency>usd</TransactionCurrency><TransactionApproval>4455</TransactionApproval></API3G>');
  assert.deepEqual([v.state, v.amountMinor, v.currency, v.approval], ['paid', 58140, 'USD', '4455']);
  assert.equal(dpoState('900'), 'pending');
  assert.equal(dpoState('904'), 'failed');
  assert.equal(dpoState(undefined), 'failed');
  assert.equal(toMinor('1,234.5'), 123450);
  assert.equal(toMinor('abc'), null);
});

test('PayPal order body: USD amount, reference in custom_id / invoice_id, no shipping', () => {
  const b = orderBody({ usdCents: 58140, reference: 'ord.abc', description: 'x'.repeat(200), returnUrl: 'https://x.test/r', cancelUrl: 'https://x.test/c' });
  assert.deepEqual(b.purchase_units[0].amount, { currency_code: 'USD', value: '581.40' });
  assert.equal(b.purchase_units[0].custom_id, 'ord.abc');
  assert.equal(b.purchase_units[0].description.length, 127);
  assert.equal(b.payment_source.paypal.experience_context.shipping_preference, 'NO_SHIPPING');
  assert.equal(approvalLink([{ rel: 'self', href: 'a' }, { rel: 'payer-action', href: 'https://paypal.test/approve' }]), 'https://paypal.test/approve');
  assert.equal(approvalLink(undefined), null);
});

test('PayPal capture summary and webhook order id', () => {
  const c = summarizeOrder({ id: 'PP1', status: 'COMPLETED', purchase_units: [{ custom_id: 'ord.abc', payments: { captures: [{ id: 'CAP1', status: 'COMPLETED', amount: { value: '581.40', currency_code: 'usd' } }] } }] });
  assert.deepEqual([c.orderId, c.captureId, c.captureStatus, c.amountMinor, c.currency, c.customId], ['PP1', 'CAP1', 'COMPLETED', 58140, 'USD', 'ord.abc']);
  assert.equal(summarizeOrder({ id: 'PP2', status: 'CREATED' }).captureStatus, null);
  assert.equal(webhookOrderId({ event_type: 'CHECKOUT.ORDER.APPROVED', resource: { id: 'PP1' } }), 'PP1');
  assert.equal(webhookOrderId({ event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'CAP1', supplementary_data: { related_ids: { order_id: 'PP1' } } } }), 'PP1');
  assert.equal(webhookOrderId({ event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'CAP1' } }), null);
});

test('Airtel: phone normalisation, amounts in whole units, status codes, callback parsing', () => {
  assert.equal(normalizeAirtelPhone('0733 123 456', '254'), '254733123456');
  assert.equal(normalizeAirtelPhone('+254 733-123-456', '254'), '254733123456');
  assert.equal(normalizeAirtelPhone('733123456', '254'), '254733123456');
  assert.equal(normalizeAirtelPhone('12', '254'), null);
  assert.equal(normalizeAirtelPhone('0772 123 456', '256'), '256772123456');
  assert.equal(msisdnLocal('254733123456', '254'), '733123456');
  assert.equal(airtelAmount(58140, 129.5, 0.01), Math.ceil(Math.ceil(58140 * 129.5 * 1.01) / 100), 'mirrors begin_gateway_payment rounding');
  assert.equal(airtelState('TS'), 'paid');
  assert.equal(airtelState('TF'), 'failed');
  assert.equal(airtelState('TIP'), 'pending');
  assert.equal(airtelState('TA'), 'pending');
  assert.deepEqual(parseCallback({ transaction: { id: 'SG1', status_code: 'TS', airtel_money_id: 'MP1', message: 'ok' } }),
    { id: 'SG1', statusCode: 'TS', airtelMoneyId: 'MP1', message: 'ok' });
  assert.equal(parseCallback({ transaction: {} }), null);
  assert.equal(parseCallback(null), null);
});

test('gateway configs refuse to run half-configured', () => {
  const saved = { ...process.env };
  try {
    delete process.env.AIRTEL_CLIENT_ID;
    assert.throws(() => airtelConfig(), /not configured/);
    Object.assign(process.env, { AIRTEL_CLIENT_ID: 'id', AIRTEL_CLIENT_SECRET: 's', AIRTEL_USD_RATE: '129.5', AIRTEL_CALLBACK_TOKEN: 'short' });
    assert.throws(() => airtelConfig(), /at least 24/);
    process.env.AIRTEL_CALLBACK_TOKEN = 'x'.repeat(32);
    process.env.AIRTEL_COUNTRY = 'UG';
    const cfg = airtelConfig();
    assert.deepEqual([cfg.country, cfg.dial, cfg.currency, cfg.apiBase], ['UG', '256', 'UGX', 'https://openapiuat.airtel.africa']);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});
