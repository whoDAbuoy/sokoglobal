// Run: npx tsx --conditions=react-server --test lib/payments/mpesa.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { darajaTimestamp, describeResult, normalizeKenyanPhone, parseStkCallback, stkPassword } from './mpesa.ts';

test('normalizeKenyanPhone accepts common Safaricom formats', () => {
  for (const input of ['0712345678', '0712 345 678', '+254712345678', '254712345678', '712345678', '(0712) 345-678']) {
    assert.equal(normalizeKenyanPhone(input), '254712345678', input);
  }
  assert.equal(normalizeKenyanPhone('0112345678'), '254112345678');
});

test('normalizeKenyanPhone rejects non-Kenyan or malformed numbers', () => {
  for (const input of ['', '0812345678', '07123456', '2557123456789', '+1 415 555 0100', '07123456789', 'abc']) {
    assert.equal(normalizeKenyanPhone(input), null, input);
  }
});

test('darajaTimestamp is East Africa Time, yyyyMMddHHmmss', () => {
  assert.equal(darajaTimestamp(new Date('2026-10-18T21:05:09Z')), '20261019000509');   // crosses midnight in Nairobi
  assert.match(darajaTimestamp(), /^\d{14}$/);
});

test('stkPassword is base64(shortcode + passkey + timestamp)', () => {
  const pw = stkPassword('174379', 'passkey', '20261018120000');
  assert.equal(Buffer.from(pw, 'base64').toString(), '174379passkey20261018120000');
});

const success = {
  Body: {
    stkCallback: {
      MerchantRequestID: '29115-34620561-1',
      CheckoutRequestID: 'ws_CO_191220191020363925',
      ResultCode: 0,
      ResultDesc: 'The service request is processed successfully.',
      CallbackMetadata: {
        Item: [
          { Name: 'Amount', Value: 64650 },
          { Name: 'MpesaReceiptNumber', Value: 'NLJ7RT61SV' },
          { Name: 'Balance' },
          { Name: 'TransactionDate', Value: 20191219102115 },
          { Name: 'PhoneNumber', Value: 254708374149 },
        ],
      },
    },
  },
};

test('parseStkCallback reads a successful callback', () => {
  assert.deepEqual(parseStkCallback(success), {
    merchantRequestId: '29115-34620561-1',
    checkoutRequestId: 'ws_CO_191220191020363925',
    resultCode: 0,
    resultDesc: 'The service request is processed successfully.',
    amountKes: 64650,
    receipt: 'NLJ7RT61SV',
    phone: '254708374149',
  });
});

test('parseStkCallback reads a cancelled callback (no metadata)', () => {
  const cb = parseStkCallback({ Body: { stkCallback: { MerchantRequestID: 'm', CheckoutRequestID: 'ws_CO_1', ResultCode: 1032, ResultDesc: 'Request cancelled by user' } } });
  assert.equal(cb?.resultCode, 1032);
  assert.equal(cb?.receipt, null);
  assert.equal(cb?.amountKes, null);
  assert.equal(describeResult(1032), 'You cancelled the M-Pesa prompt.');
});

test('parseStkCallback rejects junk and suspicious receipts', () => {
  assert.equal(parseStkCallback(null), null);
  assert.equal(parseStkCallback({ Body: {} }), null);
  assert.equal(parseStkCallback({ Body: { stkCallback: { CheckoutRequestID: 'x', ResultCode: 'nope' } } }), null);
  const bad = structuredClone(success);
  bad.Body.stkCallback.CallbackMetadata.Item[1].Value = "x'; drop table--" as never;
  assert.equal(parseStkCallback(bad)?.receipt, null);
});
