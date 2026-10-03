import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ProxyAgent, fetch as undiciFetch, type Dispatcher } from 'undici';

/**
 * Flutterwave v3 client (secret-key auth). All money endpoints used by the
 * platform live here so request shapes, timeouts and error handling are
 * consistent: Standard checkout, transaction verify, transfers, refunds.
 */
const API_BASE = (process.env.FLW_API_BASE_URL ?? 'https://api.flutterwave.com/v3').replace(/\/$/, '');

/**
 * Optional static-egress proxy. Vercel functions have no fixed outbound IP;
 * if your Flutterwave account enforces IP whitelisting for transfers, route
 * calls through a static-IP proxy (e.g. QuotaGuard/Fixie, or Vercel Secure
 * Compute) by setting FLW_OUTBOUND_PROXY_URL=https://user:pass@proxy:port.
 */
let dispatcher: Dispatcher | undefined;
function flwDispatcher(): Dispatcher | undefined {
  const url = process.env.FLW_OUTBOUND_PROXY_URL;
  if (!url) return undefined;
  dispatcher ??= new ProxyAgent(url);
  return dispatcher;
}

export class FlutterwaveError extends Error {
  constructor(message: string, readonly httpStatus: number, readonly body?: unknown) {
    super(message);
    this.name = 'FlutterwaveError';
  }
  /** 5xx / timeouts are worth retrying; 4xx are caller errors. */
  get retryable() { return this.httpStatus === 0 || this.httpStatus >= 500 || this.httpStatus === 429; }
}

async function flw<T>(path: string, init: { method: 'GET' | 'POST'; body?: unknown }): Promise<T> {
  const proxy = flwDispatcher();
  // With a proxy, use undici's own fetch so dispatcher and fetch share one undici version.
  const doFetch = (proxy ? undiciFetch : fetch) as unknown as typeof fetch;
  const key = process.env.FLW_SECRET_KEY;
  if (!key) throw new FlutterwaveError('FLW_SECRET_KEY is not configured', 500);

  let res: Response;
  try {
    res = await doFetch(`${API_BASE}${path}`, {
      method: init.method,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
      ...(proxy ? { dispatcher: proxy } : {}),
    } as RequestInit);
  } catch (err) {
    throw new FlutterwaveError(`Flutterwave unreachable: ${(err as Error).message}`, 0);
  }
  const json = (await res.json().catch(() => ({}))) as { status?: string; message?: string; data?: T };
  if (!res.ok || json.status !== 'success') {
    throw new FlutterwaveError(json.message ?? `Flutterwave request failed (${res.status})`, res.status, json);
  }
  return json.data as T;
}

/** 50540 → 505.4 (Flutterwave expects major units). */
export const centsToMajor = (cents: number) => Math.round(cents) / 100;

/** Major units ("505.40" | 505.4) → integer cents, or NaN. */
export function toCents(amount: unknown): number {
  const n = typeof amount === 'number' ? amount : Number.parseFloat(String(amount ?? ''));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : Number.NaN;
}

/* -------------------------------------------------------------------------- */
/* 1. Standard checkout — POST /payments                                       */
/* -------------------------------------------------------------------------- */
export interface PaymentLinkInput {
  txRef: string;
  amountCents: number;
  currency: string;
  redirectUrl: string;
  customer: { email: string; name: string; phone?: string | null };
  meta: Record<string, string>;
  title: string;
  description: string;
}

export async function createPaymentLink(input: PaymentLinkInput): Promise<string> {
  const data = await flw<{ link: string }>('/payments', {
    method: 'POST',
    body: {
      tx_ref: input.txRef,
      amount: centsToMajor(input.amountCents),
      currency: input.currency,
      redirect_url: input.redirectUrl,
      customer: { email: input.customer.email, name: input.customer.name, phonenumber: input.customer.phone ?? undefined },
      meta: input.meta,
      customizations: {
        title: input.title,
        description: input.description,
        logo: process.env.FLW_CHECKOUT_LOGO_URL || undefined,
      },
      session_duration: 60,   // minutes the hosted page stays usable
      max_retry_attempt: 3,
    },
  });
  if (!data?.link?.startsWith('https://')) throw new FlutterwaveError('Flutterwave returned no checkout link', 502, data);
  return data.link;
}

/* -------------------------------------------------------------------------- */
/* 2. Verify — GET /transactions/:id/verify (authoritative charge details)     */
/* -------------------------------------------------------------------------- */
export interface VerifiedTransaction { id: string; txRef: string; status: string; amountCents: number; currency: string }

export async function verifyTransaction(transactionId: string): Promise<VerifiedTransaction> {
  const d = await flw<Record<string, unknown>>(`/transactions/${encodeURIComponent(transactionId)}/verify`, { method: 'GET' });
  return {
    id: String(d.id ?? ''),
    txRef: String(d.tx_ref ?? ''),
    status: String(d.status ?? '').toLowerCase(),
    // `amount` is what the customer was asked to pay; charged_amount may include fees passed to them.
    amountCents: toCents(d.amount),
    currency: String(d.currency ?? '').toUpperCase(),
  };
}

/* -------------------------------------------------------------------------- */
/* 3. Transfers — POST /transfers (supplier payouts)                           */
/* -------------------------------------------------------------------------- */
export interface PayoutAccount {
  method: 'bank' | 'mobile_money';
  bank_code: string;
  bank_name: string | null;
  account_number: string;
  beneficiary_name: string;
  country_code: string;
  currency: string;
  international: Record<string, string>;
}

/**
 * POST /transfers. `amount` is in the DESTINATION currency (Flutterwave converts
 * from `debitCurrency`). For same-currency payouts pass amountMajor = cents/100.
 */
export async function createTransfer(input: {
  reference: string;
  amountMajor: number;
  currency: string;        // destination (payout account) currency
  debitCurrency: string;   // wallet debited — always USD for SokoGlobal escrow
  narration: string;
  account: PayoutAccount;
  callbackUrl?: string;
}): Promise<{ id: string; status: string }> {
  const { account } = input;
  if (!(input.amountMajor > 0) || !Number.isFinite(input.amountMajor)) {
    throw new FlutterwaveError('Invalid transfer amount', 400);
  }
  const intl = account.international ?? {};
  // USD/EUR/GBP bank payouts to Western accounts need beneficiary details in `meta`.
  const meta = account.method === 'bank' && Object.keys(intl).length > 0
    ? [{
        AccountNumber: account.account_number,
        RoutingNumber: intl.routing_number,
        SwiftCode: intl.swift_code,
        BankName: account.bank_name ?? undefined,
        BeneficiaryName: account.beneficiary_name,
        BeneficiaryAddress: intl.beneficiary_address,
        BeneficiaryCountry: account.country_code,
      }]
    : undefined;

  const data = await flw<{ id: number | string; status: string }>('/transfers', {
    method: 'POST',
    body: {
      account_bank: account.bank_code,
      account_number: account.account_number,
      amount: input.amountMajor,
      currency: input.currency,
      debit_currency: input.debitCurrency,
      beneficiary_name: account.beneficiary_name,
      narration: input.narration.slice(0, 100),
      reference: input.reference,                 // unique per attempt — Flutterwave rejects duplicates
      callback_url: input.callbackUrl,
      meta,
    },
  });
  return { id: String(data.id), status: String(data.status ?? 'NEW') };
}

/**
 * GET /transfers/rates — cost in `source` currency to deliver `amount` units of
 * `destination` currency. Flutterwave's `amount` param is an integer in the
 * destination currency.
 */
export async function getTransferRate(input: { amount: number; destinationCurrency: string; sourceCurrency: string }) {
  const amount = Math.floor(input.amount);
  if (amount < 1) throw new FlutterwaveError('Rate quote amount must be ≥ 1', 400);
  const qs = new URLSearchParams({
    amount: String(amount), destination_currency: input.destinationCurrency, source_currency: input.sourceCurrency,
  });
  const d = await flw<{ rate: number; source: { currency: string; amount: number }; destination: { currency: string; amount: number } }>(
    `/transfers/rates?${qs}`, { method: 'GET' },
  );
  const sourceAmount = Number(d?.source?.amount);
  const destAmount = Number(d?.destination?.amount);
  if (!(sourceAmount > 0) || !(destAmount > 0)
      || String(d.source.currency).toUpperCase() !== input.sourceCurrency.toUpperCase()
      || String(d.destination.currency).toUpperCase() !== input.destinationCurrency.toUpperCase()) {
    throw new FlutterwaveError('Malformed FX quote from Flutterwave', 502, d);
  }
  return { sourceAmount, destinationAmount: destAmount, rawRate: Number(d.rate) };
}

export interface TransferRecord { id: string; reference: string; status: string; message: string; amount: number; currency: string }

/**
 * GET /transfers?reference=… — look up a transfer by OUR reference. Used to
 * reconcile payouts whose POST /transfers outcome was unknown (timeout/5xx).
 * References are unique per attempt, so 0 or 1 match is expected; >1 is
 * treated as an error that needs a human.
 */
export async function findTransferByReference(reference: string): Promise<TransferRecord | null> {
  const qs = new URLSearchParams({ reference, page: '1' });
  const rows = await flw<Array<Record<string, unknown>>>(`/transfers?${qs}`, { method: 'GET' });
  const matches = (Array.isArray(rows) ? rows : []).filter((r) => String(r.reference ?? '') === reference);
  if (matches.length > 1) throw new FlutterwaveError(`Multiple transfers share reference ${reference}`, 409, matches);
  const r = matches[0];
  if (!r) return null;
  return {
    id: String(r.id ?? ''),
    reference: String(r.reference),
    status: String(r.status ?? '').toLowerCase(),   // new | pending | successful | failed
    message: String(r.complete_message ?? ''),
    amount: Number(r.amount),
    currency: String(r.currency ?? '').toUpperCase(),
  };
}

/** GET /transfers/:id — authoritative status for webhook re-verification. */
export async function getTransfer(transferId: string): Promise<{ id: string; reference: string; status: string; message: string }> {
  const d = await flw<Record<string, unknown>>(`/transfers/${encodeURIComponent(transferId)}`, { method: 'GET' });
  return {
    id: String(d.id ?? ''),
    reference: String(d.reference ?? ''),
    status: String(d.status ?? '').toLowerCase(),
    message: String(d.complete_message ?? ''),
  };
}

/* -------------------------------------------------------------------------- */
/* 4. Refunds — POST /transactions/:id/refund (full refund when amount omitted) */
/* -------------------------------------------------------------------------- */
export async function refundTransaction(transactionId: string): Promise<{ id: string; status: string }> {
  const data = await flw<{ id: number | string; status: string }>(
    `/transactions/${encodeURIComponent(transactionId)}/refund`, { method: 'POST', body: {} },
  );
  return { id: String(data.id), status: String(data.status ?? '').toLowerCase() };
}

/* -------------------------------------------------------------------------- */
/* Payment references (parsed again in SQL: apply_flutterwave_payment)         */
/* Retries get a "-<n>" suffix from begin_payment_attempt().                   */
/* -------------------------------------------------------------------------- */
export const orderTxRef = (orderId: string) => `ord_${orderId}`;
export const poolTxRef = (poolId: string, buyerId: string) => `pool_${poolId}_${buyerId}`;

/* -------------------------------------------------------------------------- */
/* Webhook authentication                                                      */
/*  v4: `flutterwave-signature` = base64(HMAC-SHA256(rawBody, secretHash))     */
/*  v3: `verif-hash` = the secret hash itself                                  */
/* -------------------------------------------------------------------------- */
const safeEqual = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);

export function verifyWebhookSignature(rawBody: string, headers: Headers, secretHash: string): boolean {
  const hmacHeader = headers.get('flutterwave-signature');
  if (hmacHeader) {
    const expected = createHmac('sha256', secretHash).update(rawBody, 'utf8').digest();
    return safeEqual(Buffer.from(hmacHeader.trim(), 'base64'), expected);
  }
  const verifHash = headers.get('verif-hash');
  if (verifHash) return safeEqual(Buffer.from(verifHash), Buffer.from(secretHash));
  return false;
}

/* -------------------------------------------------------------------------- */
/* Webhook payload normalisation (v3 `event` / v4 `type`)                      */
/* -------------------------------------------------------------------------- */
export interface NormalizedEvent {
  eventId: string;
  eventType: string;     // 'charge.completed' | 'transfer.completed' | …
  objectId: string;      // transaction id or transfer id
  reference: string;     // tx_ref (charges) or transfer reference
  status: string;        // lower-cased
  amountCents: number;
  currency: string;
  message: string;
}

export function normalizeWebhook(body: unknown): NormalizedEvent | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const data = b.data && typeof b.data === 'object' ? (b.data as Record<string, unknown>) : null;
  if (!data) return null;

  const eventType = String(b.type ?? b.event ?? '');
  const objectId = String(data.id ?? '');
  if (!eventType || !objectId) return null;
  const status = String(data.status ?? '').toLowerCase();

  return {
    // Include status: a transfer can emit more than one event over its life.
    eventId: b.id ? String(b.id) : `${eventType}:${objectId}:${status}`,
    eventType,
    objectId,
    reference: String(data.tx_ref ?? data.reference ?? ''),
    status,
    amountCents: toCents(data.amount),
    currency: String(data.currency ?? '').toUpperCase(),
    message: String(data.complete_message ?? data.processor_response ?? ''),
  };
}

export const isSuccessfulCharge = (s: string) => s === 'successful' || s === 'succeeded';
export const isSuccessfulTransfer = (s: string) => s === 'successful' || s === 'succeeded';
export const isFailedTransfer = (s: string) => s === 'failed';
