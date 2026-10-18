// Verify Daraja credentials, optionally sending a real KES 1 STK prompt.
//
//   npm run mpesa:check                     → OAuth only
//   npm run mpesa:check -- 0712345678       → also sends a KES 1 prompt to that phone
//
// Reads .env.local. The prompt's callback goes to NEXT_PUBLIC_SITE_URL, which
// must be public HTTPS for the callback to arrive (the script polls STK Query
// either way, so it reports the result even without a callback).
import { mpesaConfig, normalizeKenyanPhone, stkPush, stkQuery } from '../lib/payments/mpesa.ts';

const cfg = mpesaConfig();
console.log(`Daraja ${cfg.baseUrl} · shortcode ${cfg.shortcode} · ${cfg.transactionType} · 1 USD = ${cfg.kesPerUsd} KES`);

const arg = process.argv[2];
if (!arg) {
  // stkQuery on a dummy id exercises OAuth + the signed request without charging anyone.
  try { await stkQuery('ws_CO_000000000000000000000'); } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/OAuth/.test(msg)) { console.error(`✗ ${msg}`); process.exit(1); }
  }
  console.log('✓ OAuth token issued — credentials work. Pass a phone number to send a KES 1 test prompt.');
  process.exit(0);
}

const phone = normalizeKenyanPhone(arg);
if (!phone) { console.error('✗ Not a Safaricom number'); process.exit(1); }
const site = (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/$/, '');
const push = await stkPush({
  phone, amountKes: 1, accountReference: 'SGTEST', description: 'SokoGlobal',
  callbackUrl: `${site || 'https://example.com'}/api/webhooks/daraja/${cfg.callbackToken}`,
}, cfg);
console.log(`✓ Prompt sent (${push.checkoutRequestId}): ${push.customerMessage}`);

for (let i = 0; i < 18; i += 1) {
  await new Promise((r) => setTimeout(r, 5_000));
  try {
    const r = await stkQuery(push.checkoutRequestId, cfg);
    if (r.state === 'completed') { console.log(`${r.resultCode === 0 ? '✓' : '✗'} ResultCode ${r.resultCode}: ${r.resultDesc}`); process.exit(r.resultCode === 0 ? 0 : 1); }
    process.stdout.write('.');
  } catch (err) {
    process.stdout.write(`(query: ${err instanceof Error ? err.message : err}) `);
  }
}
console.log('\nNo final result after 90s.');
process.exit(1);
