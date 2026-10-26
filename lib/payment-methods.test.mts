// Run: npx tsx --conditions=react-server --test lib/payment-methods.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_PAYMENT_METHODS, availableMethods, cryptoFeeCents, cryptoOptions, defaultMethod, methodOptions, explorerUrl, groupByCategory, normalizeTxHash,
  parsePaymentSettings, swiftComplete, swiftFieldError, validWallet, type PaymentSettings,
} from './payment-methods.ts';

const ALL_CONFIGURED = { card: true, mpesa: true, airtel_money: true, dpo_pay: true, paypal: true };
const settings = (over: Partial<PaymentSettings> = {}): PaymentSettings => ({
  ...parsePaymentSettings({
    enable_dpo_pay: true, enable_airtel_money: true, enable_paypal: true, enable_swift_wire: true, enable_crypto: true,
    swift_bank_details: { bank_name: 'Escrow Bank', swift_code: 'ESCBKENX', account_number: '0123', account_name: 'SokoGlobal Escrow' },
    crypto_deposit_wallets: { usdt_trc20: 'TXYZabcdefghijkmnopqrstuvwxyz12345', usdt_erc20: '', usdc_polygon: '' },
    crypto_markup_percent: '0.0100',
  }),
  ...over,
});

test('settings parse: before migration 028 everything extra is off and empty', () => {
  const s = parsePaymentSettings(null);
  assert.equal(s.enable_paypal, false);
  assert.equal(s.enable_crypto, false);
  assert.equal(s.swift_bank_details.bank_name, '');
  assert.equal(s.crypto_markup_percent, 0.01);
  assert.equal(settings().crypto_markup_percent, 0.01, 'numeric strings from PostgREST');
});

test('availability: switched on AND configured; wire needs bank details, crypto a wallet; carts get no wire / crypto', () => {
  assert.deepEqual(availableMethods({ settings: settings(), configured: ALL_CONFIGURED, cart: false }),
    ['mpesa', 'airtel_money', 'card', 'dpo_pay', 'paypal', 'swift_wire', 'crypto']);
  assert.deepEqual(availableMethods({ settings: settings(), configured: ALL_CONFIGURED, cart: true }), ['mpesa', 'airtel_money', 'card', 'dpo_pay', 'paypal']);
  assert.ok(!availableMethods({ settings: settings({ enable_paypal: false }), configured: ALL_CONFIGURED, cart: false }).includes('paypal'), 'switch off hides it');
  assert.ok(!availableMethods({ settings: settings(), configured: { ...ALL_CONFIGURED, dpo_pay: false }, cart: false }).includes('dpo_pay'), 'no API keys hides it');
  const noBank = settings({ swift_bank_details: { ...settings().swift_bank_details, swift_code: '' } });
  assert.ok(!availableMethods({ settings: noBank, configured: ALL_CONFIGURED, cart: false }).includes('swift_wire'));
  const noWallet = settings({ crypto_deposit_wallets: { usdt_trc20: '', usdt_erc20: '', usdc_polygon: '' } });
  assert.ok(!availableMethods({ settings: noWallet, configured: ALL_CONFIGURED, cart: false }).includes('crypto'));
  const over = availableMethods({ settings: settings(), configured: ALL_CONFIGURED, cart: false, mpesaOverLimit: true, airtelOverLimit: true });
  assert.ok(!over.includes('mpesa') && !over.includes('airtel_money') && over.includes('card'), 'mobile money hidden above its limits');
});

test('tabs keep the category order and drop empty ones; default method', () => {
  assert.deepEqual(groupByCategory(['card', 'paypal', 'swift_wire']).map((g) => g.category), ['cards', 'global', 'wire']);
  assert.deepEqual(groupByCategory(['mpesa', 'airtel_money'])[0].methods, ['mpesa', 'airtel_money']);
  assert.equal(defaultMethod(['card', 'mpesa', 'paypal'], 'paypal'), 'paypal');
  assert.equal(defaultMethod(['card', 'mpesa'], 'crypto'), 'mpesa', 'unavailable preference ignored');
  assert.equal(defaultMethod(['paypal', 'swift_wire'], null), 'paypal');
  assert.equal(defaultMethod([], null), null);
});

test('crypto: fee rounded up like begin_manual_payment (582 on $581.40 at 1%); hashes and wallets', () => {
  assert.equal(cryptoFeeCents(58_140, 0.01), 582);
  assert.equal(cryptoFeeCents(10_000, 0.01), 100);
  assert.equal(cryptoFeeCents(58_140, 0), 0);
  assert.equal(normalizeTxHash('trc20', `0x${'AB'.repeat(32)}`), 'ab'.repeat(32));
  assert.equal(normalizeTxHash('erc20', `0x${'AB'.repeat(32)}`), `0x${'ab'.repeat(32)}`);
  assert.equal(normalizeTxHash('polygon', 'ab'.repeat(32)), null, 'EVM hashes need 0x');
  assert.equal(normalizeTxHash('trc20', '0x1234'), null);
  assert.ok(validWallet('usdt_trc20', 'TXYZabcdefghijkmnopqrstuvwxyz12345'));
  assert.ok(!validWallet('usdt_trc20', '0x0000000000000000000000000000000000000001'));
  assert.ok(validWallet('usdc_polygon', '0x00000000000000000000000000000000000000a1'));
  assert.ok(validWallet('usdt_erc20', ''), 'empty = not offered');
  assert.deepEqual(cryptoOptions(settings().crypto_deposit_wallets).map((o) => o.wallet), ['usdt_trc20']);
  assert.match(explorerUrl('trc20', 'ab'), /tronscan\.org\/#\/transaction\/ab$/);
  assert.match(explorerUrl('polygon', '0xab'), /polygonscan\.com\/tx\/0xab$/);
});

test('SWIFT details: complete check and field formats', () => {
  assert.ok(swiftComplete(settings().swift_bank_details));
  assert.equal(swiftFieldError('swift_code', 'escbkenx'), null, 'lower case is upper-cased first');
  assert.match(swiftFieldError('swift_code', 'BAD') ?? '', /8 or 11/);
  assert.match(swiftFieldError('account_number', '12') ?? '', /4–40/);
  assert.equal(swiftFieldError('routing_number', ''), null);
});

test('methodOptions: all seven channels always listed; unavailable ones disabled with a reason', () => {
  assert.equal(ALL_PAYMENT_METHODS.length, 7);
  const cart = methodOptions(['mpesa', 'card'], false);
  assert.deepEqual(cart.map((o) => o.method), [...ALL_PAYMENT_METHODS]);
  assert.deepEqual(cart.filter((o) => o.enabled).map((o) => o.method), ['mpesa', 'card']);
  assert.match(cart.find((o) => o.method === 'swift_wire')!.reason!, /single orders only/i);
  assert.equal(cart.find((o) => o.method === 'swift_wire')!.blocked, 'single_order');
  assert.equal(cart.find((o) => o.method === 'paypal')!.blocked, 'unavailable');
  assert.match(cart.find((o) => o.method === 'crypto')!.reason!, /single orders only/i);
  assert.match(cart.find((o) => o.method === 'paypal')!.reason!, /not available/i);
  // Wire / crypto on a cart stay disabled even if a list wrongly includes them.
  assert.equal(methodOptions(['swift_wire', 'crypto'], false).some((o) => o.enabled), false);
  const order = methodOptions(['swift_wire', 'crypto', 'paypal'], true);
  assert.deepEqual(order.filter((o) => o.enabled).map((o) => o.method), ['paypal', 'swift_wire', 'crypto']);
  assert.ok(order.filter((o) => o.enabled).every((o) => o.reason === null));
});
