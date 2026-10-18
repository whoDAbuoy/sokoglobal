import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Paystack client for buyer card payments (Visa / Mastercard / Verve).
 *
 *   1. POST /transaction/initialize      → access_code (inline card form) + authorization_url (hosted fallback)
 *   2. Buyer enters card details in Paystack's secure form (iframe) — card data never reaches our servers
 *   3. POST /api/webhooks/card (charge.success, HMAC-SHA512 signed) and/or the buyer's return
 *      → GET /transaction/verify/:reference → apply_card_payment() in Postgres
 *   4. POST /refund for Trend Pool pledges paid by card (expire-pools cron)
 *
 * Escrow is held in USD cents. PAYSTACK_CURRENCY defaults to USD; for a
 * local-currency account (e.g. KES) set PAYSTACK_USD_RATE (units per USD) — the
 * charged amount is frozen per attempt in card_payments.
 */
export class PaystackError extends Error {
  constructor(message: string, readonly httpStatus: number, readonly body?: unknown) {
    super(message);
    this.name = 'PaystackError';
  }
  get retryable() { return this.httpStatus === 0 || this.httpStatus >= 500 || this.httpStatus === 429; }
}

export interface PaystackConfig { apiBase: string; secretKey: string; currency: string; usdRate: number }

export function paystackConfig(): PaystackConfig {
  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) throw new PaystackError('Card payments are not configured (PAYSTACK_SECRET_KEY missing)', 500);
  const currency = (process.env.PAYSTACK_CURRENCY || 'USD').toUpperCase();
  const usdRate = currency === 'USD' ? 1 : Number(process.env.PAYSTACK_USD_RATE);
  if (!(usdRate > 0)) throw new PaystackError(`PAYSTACK_USD_RATE must be set for ${currency} charges`, 500);
  return { apiBase: (process.env.PAYSTACK_API_BASE_URL || 'https://api.paystack.co').replace(/\/$/, ''), secretKey, currency, usdRate };
}

export function isPaystackConfigured(): boolean {
  try { paystackConfig(); return true; } catch { return false; }
}

/* -------------------------------------------------------------------------- */
/* Pure helpers                                                                */
/* -------------------------------------------------------------------------- */

/** USD cents → charge amount in the account currency's minor units (rounded up). Mirrors begin_card_payment(). */
export function toMinorUnits(usdCents: number, currency: string, usdRate: number): number {
  if (!Number.isInteger(usdCents) || usdCents <= 0) throw new PaystackError('Amount must be a positive integer of cents', 400);
  return currency === 'USD' ? usdCents : Math.ceil(usdCents * usdRate - 1e-9);
}

/** x-paystack-signature = hex HMAC-SHA512 of the raw body, keyed with the secret key. */
export function verifyWebhookSignature(rawBody: string, signature: string | null, secretKey: string): boolean {
  if (!signature || !/^[0-9a-f]{128}$/i.test(signature)) return false;
  const expected = createHmac('sha512', secretKey).update(rawBody).digest();
  const received = Buffer.from(signature, 'hex');
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export interface PaystackEvent { event: string; reference: string; status: string; id: string }

export function parseWebhook(body: unknown): PaystackEvent | null {
  const b = body as { event?: unknown; data?: { reference?: unknown; status?: unknown; id?: unknown } } | null;
  if (!b || typeof b.event !== 'string' || !b.data || typeof b.data.reference !== 'string') return null;
  return { event: b.event, reference: b.data.reference, status: String(b.data.status ?? ''), id: String(b.data.id ?? '') };
}

/* -------------------------------------------------------------------------- */
/* HTTP                                                                        */
/* -------------------------------------------------------------------------- */

async function paystack<T>(path: string, init: { method: 'GET' | 'POST'; body?: unknown }, cfg = paystackConfig()): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${cfg.apiBase}${path}`, {
      method: init.method,
      headers: { Authorization: `Bearer ${cfg.secretKey}`, 'Content-Type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new PaystackError(`Paystack unreachable: ${(err as Error).message}`, 0);
  }
  const json = (await res.json().catch(() => ({}))) as { status?: boolean; message?: string; data?: T };
  if (!res.ok || json.status !== true) throw new PaystackError(json.message ?? `Paystack request failed (${res.status})`, res.status, json);
  return json.data as T;
}

export async function initializeTransaction(input: {
  email: string; amountMinor: number; currency: string; reference: string; callbackUrl: string; metadata: Record<string, unknown>;
}) {
  const data = await paystack<{ authorization_url: string; access_code: string; reference: string }>('/transaction/initialize', {
    method: 'POST',
    body: {
      email: input.email, amount: input.amountMinor, currency: input.currency, reference: input.reference,
      callback_url: input.callbackUrl, channels: ['card'], metadata: input.metadata,
    },
  });
  return { authorizationUrl: data.authorization_url, accessCode: data.access_code, reference: data.reference };
}

export interface VerifiedCharge { id: string; status: string; reference: string; amountMinor: number; currency: string }

/** Never trust webhook/return-URL amounts: ask Paystack. */
export async function verifyTransaction(reference: string): Promise<VerifiedCharge> {
  const d = await paystack<{ id: number | string; status: string; reference: string; amount: number; currency: string }>(
    `/transaction/verify/${encodeURIComponent(reference)}`, { method: 'GET' });
  return { id: String(d.id), status: d.status, reference: d.reference, amountMinor: Number(d.amount), currency: String(d.currency).toUpperCase() };
}

/** Full refund of a card transaction (by Paystack transaction id or reference). */
export async function refundTransaction(transaction: string): Promise<{ id: string; status: string }> {
  const d = await paystack<{ id?: number | string; status?: string; transaction?: { id?: number | string } }>('/refund', {
    method: 'POST', body: { transaction },
  });
  return { id: String(d.id ?? d.transaction?.id ?? transaction), status: String(d.status ?? 'pending') };
}
