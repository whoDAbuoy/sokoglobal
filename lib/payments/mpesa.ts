import 'server-only';

/**
 * Safaricom Daraja client — Lipa na M-Pesa Online (STK Push).
 *
 *   1. OAuth   GET  /oauth/v1/generate?grant_type=client_credentials  (Basic key:secret, ~1h token)
 *   2. Push    POST /mpesa/stkpush/v1/processrequest   → PIN prompt on the buyer's phone
 *   3. Query   POST /mpesa/stkpushquery/v1/query        → final result for a CheckoutRequestID
 *   4. Daraja POSTs the result to our CallBackURL (see app/api/webhooks/daraja).
 *
 * Password = base64(BusinessShortCode + Passkey + Timestamp), Timestamp in
 * East Africa Time as yyyyMMddHHmmss. Callbacks are unsigned, so the platform
 * treats the STK Query answer as the source of truth (lib/payments/mpesa-checkout.ts).
 */

const BASE_URLS = {
  sandbox: 'https://sandbox.safaricom.co.ke',
  production: 'https://api.safaricom.co.ke',
} as const;

/** Safaricom's per-transaction ceiling for customer payments, in KES. */
const DEFAULT_MAX_KES = 250_000;

export class MpesaError extends Error {
  constructor(message: string, readonly httpStatus: number, readonly body?: unknown) {
    super(message);
    this.name = 'MpesaError';
  }
  get retryable() { return this.httpStatus === 0 || this.httpStatus >= 500 || this.httpStatus === 429; }
}

export interface MpesaConfig {
  baseUrl: string;
  consumerKey: string;
  consumerSecret: string;
  shortcode: string;
  passkey: string;
  transactionType: 'CustomerPayBillOnline' | 'CustomerBuyGoodsOnline';
  partyB: string;
  callbackToken: string;
  kesPerUsd: number;
  maxKes: number;
}

export function mpesaConfig(): MpesaConfig {
  const env = process.env;
  const missing = ['MPESA_CONSUMER_KEY', 'MPESA_CONSUMER_SECRET', 'MPESA_SHORTCODE', 'MPESA_PASSKEY', 'MPESA_CALLBACK_TOKEN', 'MPESA_KES_PER_USD']
    .filter((k) => !env[k]);
  if (missing.length) throw new MpesaError(`M-Pesa is not configured (missing ${missing.join(', ')})`, 500);

  const kesPerUsd = Number(env.MPESA_KES_PER_USD);
  if (!(kesPerUsd >= 50 && kesPerUsd <= 500)) throw new MpesaError('MPESA_KES_PER_USD must be a number between 50 and 500', 500);
  if (env.MPESA_CALLBACK_TOKEN!.length < 24) throw new MpesaError('MPESA_CALLBACK_TOKEN must be at least 24 characters', 500);

  const transactionType = env.MPESA_TRANSACTION_TYPE === 'CustomerBuyGoodsOnline' ? 'CustomerBuyGoodsOnline' : 'CustomerPayBillOnline';
  return {
    baseUrl: env.MPESA_ENV === 'production' ? BASE_URLS.production : BASE_URLS.sandbox,
    consumerKey: env.MPESA_CONSUMER_KEY!,
    consumerSecret: env.MPESA_CONSUMER_SECRET!,
    shortcode: env.MPESA_SHORTCODE!,
    passkey: env.MPESA_PASSKEY!,
    transactionType,
    // Till numbers (Buy Goods) receive at the till; Paybills at the shortcode.
    partyB: env.MPESA_PARTY_B || env.MPESA_SHORTCODE!,
    callbackToken: env.MPESA_CALLBACK_TOKEN!,
    kesPerUsd,
    maxKes: Number(env.MPESA_MAX_KES) > 0 ? Math.floor(Number(env.MPESA_MAX_KES)) : DEFAULT_MAX_KES,
  };
}

export function isMpesaConfigured(): boolean {
  try { mpesaConfig(); return true; } catch { return false; }
}

/* -------------------------------------------------------------------------- */
/* Pure helpers                                                                */
/* -------------------------------------------------------------------------- */

/** "0712 345 678" | "+254712345678" | "712345678" | "0112…" → "2547…/2541…", else null. */
export function normalizeKenyanPhone(input: string): string | null {
  const s = input.replace(/[\s().-]/g, '').replace(/^\+/, '');
  if (/^254[17]\d{8}$/.test(s)) return s;
  if (/^0[17]\d{8}$/.test(s)) return `254${s.slice(1)}`;
  if (/^[17]\d{8}$/.test(s)) return `254${s}`;
  return null;
}

/** yyyyMMddHHmmss in East Africa Time (UTC+3, no daylight saving). */
export function darajaTimestamp(now = new Date()): string {
  return new Date(now.getTime() + 3 * 3_600_000).toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

export const stkPassword = (shortcode: string, passkey: string, timestamp: string) =>
  Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');

export interface StkCallback {
  merchantRequestId: string;
  checkoutRequestId: string;
  resultCode: number;
  resultDesc: string;
  amountKes: number | null;
  receipt: string | null;
  phone: string | null;
}

/** Body.stkCallback → normalized, or null if the shape is wrong. */
export function parseStkCallback(body: unknown): StkCallback | null {
  const cb = (body as { Body?: { stkCallback?: Record<string, unknown> } } | null)?.Body?.stkCallback;
  if (!cb || typeof cb.CheckoutRequestID !== 'string' || cb.ResultCode === undefined) return null;
  const resultCode = Number(cb.ResultCode);
  if (!Number.isInteger(resultCode)) return null;

  const items = ((cb.CallbackMetadata as { Item?: { Name?: string; Value?: unknown }[] } | undefined)?.Item ?? []);
  const item = (name: string) => items.find((i) => i?.Name === name)?.Value;
  const amount = Number(item('Amount'));
  const receipt = item('MpesaReceiptNumber');
  const phone = item('PhoneNumber');

  return {
    merchantRequestId: String(cb.MerchantRequestID ?? ''),
    checkoutRequestId: cb.CheckoutRequestID,
    resultCode,
    resultDesc: String(cb.ResultDesc ?? ''),
    amountKes: Number.isFinite(amount) && amount > 0 ? Math.round(amount) : null,
    receipt: typeof receipt === 'string' && /^[A-Z0-9]{6,20}$/.test(receipt) ? receipt : null,
    phone: phone === undefined || phone === null ? null : String(phone),
  };
}

/** Buyer-facing text for common STK result codes. */
export function describeResult(code: number | null, fallback?: string | null): string {
  switch (code) {
    case 0: return 'Payment received.';
    case 1: return 'Your M-Pesa balance is too low for this payment.';
    case 1032: return 'You cancelled the M-Pesa prompt.';
    case 1037: return 'Your phone could not be reached, or the prompt timed out. Make sure it is on and try again.';
    case 2001: return 'Wrong M-Pesa PIN entered.';
    case 1019: return 'The M-Pesa prompt expired before it was completed.';
    default: return fallback || 'The M-Pesa payment did not go through.';
  }
}

/* -------------------------------------------------------------------------- */
/* HTTP                                                                        */
/* -------------------------------------------------------------------------- */

let token: { value: string; expiresAt: number; key: string } | undefined;

async function request(url: string, init: RequestInit): Promise<{ status: number; json: Record<string, unknown> }> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, cache: 'no-store', signal: AbortSignal.timeout(20_000) });
  } catch (err) {
    throw new MpesaError(`Daraja unreachable: ${(err as Error).message}`, 0);
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

async function accessToken(cfg: MpesaConfig): Promise<string> {
  if (token && token.key === cfg.consumerKey && token.expiresAt > Date.now() + 60_000) return token.value;
  const basic = Buffer.from(`${cfg.consumerKey}:${cfg.consumerSecret}`).toString('base64');
  const { status, json } = await request(`${cfg.baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
    method: 'GET', headers: { Authorization: `Basic ${basic}` },
  });
  if (status !== 200 || typeof json.access_token !== 'string') {
    throw new MpesaError(`Daraja OAuth failed (${status}) — check MPESA_CONSUMER_KEY/SECRET and MPESA_ENV`, status || 500, json);
  }
  token = { value: json.access_token, expiresAt: Date.now() + Number(json.expires_in ?? 3599) * 1000, key: cfg.consumerKey };
  return token.value;
}

async function daraja(cfg: MpesaConfig, path: string, body: unknown, retried = false) {
  const { status, json } = await request(`${cfg.baseUrl}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await accessToken(cfg)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (status === 401 && !retried) { token = undefined; return daraja(cfg, path, body, true); }
  return { status, json };
}

const errorText = (json: Record<string, unknown>, status: number) =>
  String(json.errorMessage ?? json.ResponseDescription ?? `Daraja request failed (${status})`);

export interface StkPushInput {
  phone: string;           // 2547XXXXXXXX
  amountKes: number;       // whole shillings
  accountReference: string;
  description: string;
  callbackUrl: string;
}

export async function stkPush(input: StkPushInput, cfg = mpesaConfig()) {
  if (!Number.isInteger(input.amountKes) || input.amountKes < 1) throw new MpesaError('Amount must be whole shillings', 400);
  const timestamp = darajaTimestamp();
  const { status, json } = await daraja(cfg, '/mpesa/stkpush/v1/processrequest', {
    BusinessShortCode: cfg.shortcode,
    Password: stkPassword(cfg.shortcode, cfg.passkey, timestamp),
    Timestamp: timestamp,
    TransactionType: cfg.transactionType,
    Amount: input.amountKes,
    PartyA: input.phone,
    PartyB: cfg.partyB,
    PhoneNumber: input.phone,
    CallBackURL: input.callbackUrl,
    AccountReference: input.accountReference.slice(0, 12),
    TransactionDesc: input.description.slice(0, 13),
  });
  if (status !== 200 || String(json.ResponseCode) !== '0' || typeof json.CheckoutRequestID !== 'string') {
    throw new MpesaError(errorText(json, status), status, json);
  }
  return {
    merchantRequestId: String(json.MerchantRequestID ?? ''),
    checkoutRequestId: json.CheckoutRequestID,
    customerMessage: String(json.CustomerMessage ?? 'Check your phone to complete the payment.'),
  };
}

export type StkQueryResult =
  | { state: 'pending' }
  | { state: 'completed'; resultCode: number; resultDesc: string };

/** Ask Daraja for the final result. "Still being processed" comes back as an error → pending. */
export async function stkQuery(checkoutRequestId: string, cfg = mpesaConfig()): Promise<StkQueryResult> {
  const timestamp = darajaTimestamp();
  const { status, json } = await daraja(cfg, '/mpesa/stkpushquery/v1/query', {
    BusinessShortCode: cfg.shortcode,
    Password: stkPassword(cfg.shortcode, cfg.passkey, timestamp),
    Timestamp: timestamp,
    CheckoutRequestID: checkoutRequestId,
  });
  if (json.errorCode === '500.001.1001' || /being processed/i.test(String(json.errorMessage ?? ''))) return { state: 'pending' };
  if (status === 200 && String(json.ResponseCode) === '0' && json.ResultCode !== undefined) {
    const resultCode = Number(json.ResultCode);
    if (Number.isInteger(resultCode)) return { state: 'completed', resultCode, resultDesc: String(json.ResultDesc ?? '') };
  }
  throw new MpesaError(errorText(json, status), status, json);
}

/**
 * The Postgres limit error ("This order is KES 323,700 — above the M-Pesa limit
 * of KES 250,000 per transaction…") rewritten to send buyers to Bank Card.
 * Any other message is returned unchanged.
 */
export function mpesaLimitMessage(message: string): string {
  const m = /KES ([\d,]+) — above the M-Pesa limit of KES ([\d,]+)/.exec(message);
  if (!m) return message;
  return `This total is KES ${m[1]}, above M-Pesa's limit of KES ${m[2]} per payment. Please pay by Bank Card (Visa / Mastercard) instead.`;
}

/** True when this USD amount would exceed the M-Pesa per-payment limit at the configured rate (false if M-Pesa is off). */
export function exceedsMpesaLimit(usdCents: number): boolean {
  try {
    const cfg = mpesaConfig();
    return Math.ceil((usdCents * cfg.kesPerUsd) / 100) > cfg.maxKes;
  } catch { return false; }
}
