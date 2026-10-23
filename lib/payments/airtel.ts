import 'server-only';

/**
 * Airtel Money collections (Airtel Africa Open API) — a USSD push to the buyer's phone, like M-Pesa STK.
 *
 *   1. POST /merchant/v1/payments/ with our transaction id (card_payments.gateway_token) and the
 *      amount frozen in Postgres (begin_gateway_payment, whole units of AIRTEL_CURRENCY)
 *   2. Buyer approves with their PIN
 *   3. Airtel calls /api/webhooks/airtel/<AIRTEL_CALLBACK_TOKEN>; the callback is NOT trusted —
 *      GET /standard/v1/payments/:id confirms the result before apply_card_payment() funds escrow.
 *      Pending prompts are also re-queried by the page poll and the retry cron.
 */
export class AirtelError extends Error {
  constructor(message: string, readonly httpStatus: number) {
    super(message);
    this.name = 'AirtelError';
  }
}

/** Country → dial code and the currency Airtel collects in. */
export const AIRTEL_COUNTRIES: Record<string, { dial: string; currency: string }> = {
  KE: { dial: '254', currency: 'KES' }, UG: { dial: '256', currency: 'UGX' }, TZ: { dial: '255', currency: 'TZS' },
  RW: { dial: '250', currency: 'RWF' }, ZM: { dial: '260', currency: 'ZMW' }, MW: { dial: '265', currency: 'MWK' },
  NG: { dial: '234', currency: 'NGN' }, CD: { dial: '243', currency: 'CDF' }, MG: { dial: '261', currency: 'MGA' },
};

export interface AirtelConfig {
  apiBase: string; clientId: string; clientSecret: string; country: string; dial: string; currency: string;
  usdRate: number; callbackToken: string; maxAmount: number;
}

export function airtelConfig(): AirtelConfig {
  const env = process.env;
  const missing = ['AIRTEL_CLIENT_ID', 'AIRTEL_CLIENT_SECRET', 'AIRTEL_USD_RATE', 'AIRTEL_CALLBACK_TOKEN'].filter((k) => !env[k]);
  if (missing.length) throw new AirtelError(`Airtel Money is not configured (missing ${missing.join(', ')})`, 500);
  const country = (env.AIRTEL_COUNTRY || 'KE').toUpperCase();
  const c = AIRTEL_COUNTRIES[country];
  if (!c) throw new AirtelError(`Unsupported AIRTEL_COUNTRY ${country}`, 500);
  const usdRate = Number(env.AIRTEL_USD_RATE);
  if (!(usdRate > 0)) throw new AirtelError('AIRTEL_USD_RATE must be a positive number (local currency per USD)', 500);
  if (env.AIRTEL_CALLBACK_TOKEN!.length < 24) throw new AirtelError('AIRTEL_CALLBACK_TOKEN must be at least 24 characters', 500);
  const live = (env.AIRTEL_ENV || 'sandbox').toLowerCase() === 'production';
  return {
    apiBase: (env.AIRTEL_API_BASE_URL || (live ? 'https://openapi.airtel.africa' : 'https://openapiuat.airtel.africa')).replace(/\/$/, ''),
    clientId: env.AIRTEL_CLIENT_ID!, clientSecret: env.AIRTEL_CLIENT_SECRET!, country, dial: c.dial,
    currency: (env.AIRTEL_CURRENCY || c.currency).toUpperCase(), usdRate, callbackToken: env.AIRTEL_CALLBACK_TOKEN!,
    maxAmount: Number(env.AIRTEL_MAX_AMOUNT) > 0 ? Math.floor(Number(env.AIRTEL_MAX_AMOUNT)) : 150_000,
  };
}

export function isAirtelConfigured(): boolean {
  try { airtelConfig(); return true; } catch { return false; }
}

/* -------------------------------------------------------------------------- */
/* Pure helpers                                                                */
/* -------------------------------------------------------------------------- */

/** "+254 733 123 456", "0733123456", "733123456" → "254733123456" for the configured country; null if not a mobile number. */
export function normalizeAirtelPhone(input: string, dial: string): string | null {
  const s = input.replace(/[\s().-]/g, '').replace(/^\+/, '').replace(/^00/, '');
  const local = s.startsWith(dial) ? s.slice(dial.length) : s.replace(/^0/, '');
  return /^[1-9]\d{7,9}$/.test(local) ? `${dial}${local}` : null;
}

/** Airtel wants the subscriber number without the country code. */
export const msisdnLocal = (phone: string, dial: string) => (phone.startsWith(dial) ? phone.slice(dial.length) : phone);

/** Whole local-currency units (begin_gateway_payment stores them as minor units ×100). */
export const wholeUnits = (amountMinor: number) => Math.round(amountMinor / 100);

/** USD cents → whole local units at the rate (+ spread), as begin_gateway_payment charges. */
export const airtelAmount = (usdCents: number, rate: number, spread = 0) => Math.ceil(Math.ceil(usdCents * rate * (1 + spread) - 1e-9) / 100);

export type AirtelState = 'paid' | 'pending' | 'failed';
/** TS success · TF failed · TE expired · TA ambiguous / TIP in progress (keep asking). */
export function airtelState(status: string | undefined): AirtelState {
  const s = (status ?? '').toUpperCase();
  if (s === 'TS') return 'paid';
  if (s === 'TF' || s === 'TE') return 'failed';
  return 'pending';
}

export interface AirtelCallback { id: string; statusCode: string | null; airtelMoneyId: string | null; message: string | null }
export function parseCallback(body: unknown): AirtelCallback | null {
  const t = (body as { transaction?: { id?: unknown; status_code?: unknown; airtel_money_id?: unknown; message?: unknown } } | null)?.transaction;
  if (!t || typeof t.id !== 'string' || !t.id) return null;
  return { id: t.id, statusCode: typeof t.status_code === 'string' ? t.status_code : null,
    airtelMoneyId: typeof t.airtel_money_id === 'string' ? t.airtel_money_id : null, message: typeof t.message === 'string' ? t.message : null };
}

/* -------------------------------------------------------------------------- */
/* HTTP                                                                        */
/* -------------------------------------------------------------------------- */

let cachedToken: { value: string; expiresAt: number; key: string } | null = null;

async function call<T>(path: string, init: { method: 'GET' | 'POST'; body?: unknown; auth?: boolean }, cfg: AirtelConfig): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: '*/*' };
  if (init.auth !== false) {
    headers.Authorization = `Bearer ${await accessToken(cfg)}`;
    headers['X-Country'] = cfg.country;
    headers['X-Currency'] = cfg.currency;
  }
  let res: Response;
  try {
    res = await fetch(`${cfg.apiBase}${path}`, {
      method: init.method, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: 'no-store', signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new AirtelError(`Airtel Money unreachable: ${(err as Error).message}`, 0);
  }
  const json = await res.json().catch(() => ({})) as T & { status?: { message?: string; success?: boolean } };
  if (!res.ok) throw new AirtelError(json.status?.message ?? `Airtel Money request failed (${res.status})`, res.status);
  return json;
}

async function accessToken(cfg: AirtelConfig): Promise<string> {
  const key = `${cfg.apiBase}:${cfg.clientId}`;
  if (cachedToken && cachedToken.key === key && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.value;
  const json = await call<{ access_token?: string; expires_in?: number | string }>('/auth/oauth2/token', {
    method: 'POST', auth: false, body: { client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: 'client_credentials' },
  }, cfg);
  if (!json.access_token) throw new AirtelError('Airtel Money authentication failed', 502);
  cachedToken = { value: json.access_token, expiresAt: Date.now() + Number(json.expires_in ?? 180) * 1000, key };
  return json.access_token;
}

/** Send the PIN prompt. The amount is whole units of the configured currency. */
export async function requestPayment(t: { transactionId: string; phone: string; amount: number; reference: string }) {
  const cfg = airtelConfig();
  if (t.amount > cfg.maxAmount) throw new AirtelError(`This payment is ${cfg.currency} ${t.amount.toLocaleString('en-US')}, above the Airtel Money limit of ${cfg.currency} ${cfg.maxAmount.toLocaleString('en-US')}. Please choose another method.`, 409);
  const r = await call<{ status?: { success?: boolean; message?: string; result_code?: string } }>('/merchant/v1/payments/', {
    method: 'POST',
    body: {
      reference: t.reference.slice(0, 64),
      subscriber: { country: cfg.country, currency: cfg.currency, msisdn: msisdnLocal(t.phone, cfg.dial) },
      transaction: { amount: t.amount, country: cfg.country, currency: cfg.currency, id: t.transactionId },
    },
  }, cfg);
  if (r.status?.success === false) throw new AirtelError(r.status.message ?? 'Airtel Money did not accept the request', 400);
}

/** Ask Airtel for the result (never trust the callback). */
export async function transactionStatus(transactionId: string): Promise<{ state: AirtelState; status: string; airtelMoneyId: string | null; message: string | null }> {
  const cfg = airtelConfig();
  const r = await call<{ data?: { transaction?: { status?: string; airtel_money_id?: string; message?: string } } }>(
    `/standard/v1/payments/${encodeURIComponent(transactionId)}`, { method: 'GET' }, cfg);
  const t = r.data?.transaction;
  return { state: airtelState(t?.status), status: t?.status ?? '', airtelMoneyId: t?.airtel_money_id ?? null, message: t?.message ?? null };
}
