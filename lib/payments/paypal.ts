import 'server-only';

/**
 * PayPal Checkout (Orders v2, redirect flow — no PayPal script runs on our pages).
 *
 *   1. POST /v2/checkout/orders (intent CAPTURE, USD, our reference as custom_id / invoice_id)
 *      → buyer approves on paypal.com (the "payer-action" / "approve" link)
 *   2. PayPal returns the buyer to our page with ?token=<PayPal order id>; the server CAPTURES
 *      the order (POST /v2/checkout/orders/:id/capture). The CHECKOUT.ORDER.APPROVED /
 *      PAYMENT.CAPTURE.COMPLETED webhook does the same if the buyer never comes back.
 *   3. The captured amount and currency go to apply_card_payment(), which re-checks them.
 *
 * Webhooks are verified with PayPal's verify-webhook-signature API (PAYPAL_WEBHOOK_ID).
 */
export class PaypalError extends Error {
  constructor(message: string, readonly httpStatus: number, readonly issue?: string) {
    super(message);
    this.name = 'PaypalError';
  }
  get retryable() { return this.httpStatus === 0 || this.httpStatus >= 500 || this.httpStatus === 429; }
}

export interface PaypalConfig { apiBase: string; clientId: string; clientSecret: string; webhookId: string | null }

export function paypalConfig(): PaypalConfig {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new PaypalError('PayPal is not configured (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET missing)', 500);
  const live = (process.env.PAYPAL_ENV || 'sandbox').toLowerCase() === 'live';
  return {
    apiBase: (process.env.PAYPAL_API_BASE_URL || (live ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com')).replace(/\/$/, ''),
    clientId, clientSecret, webhookId: process.env.PAYPAL_WEBHOOK_ID || null,
  };
}

export function isPaypalConfigured(): boolean {
  try { paypalConfig(); return true; } catch { return false; }
}

/* -------------------------------------------------------------------------- */
/* Pure helpers                                                                */
/* -------------------------------------------------------------------------- */

export const paypalAmount = (usdCents: number) => (usdCents / 100).toFixed(2);

export interface PaypalOrderBody {
  intent: 'CAPTURE';
  purchase_units: { reference_id: string; custom_id: string; invoice_id: string; description: string; amount: { currency_code: 'USD'; value: string } }[];
  payment_source: { paypal: { experience_context: { brand_name: string; user_action: 'PAY_NOW'; shipping_preference: 'NO_SHIPPING'; return_url: string; cancel_url: string } } };
}

export function orderBody(t: { usdCents: number; reference: string; description: string; returnUrl: string; cancelUrl: string }): PaypalOrderBody {
  return {
    intent: 'CAPTURE',
    purchase_units: [{
      reference_id: t.reference.slice(0, 256), custom_id: t.reference.slice(0, 127), invoice_id: t.reference.slice(0, 127),
      description: t.description.slice(0, 127), amount: { currency_code: 'USD', value: paypalAmount(t.usdCents) },
    }],
    payment_source: { paypal: { experience_context: {
      brand_name: 'SokoGlobal', user_action: 'PAY_NOW', shipping_preference: 'NO_SHIPPING', return_url: t.returnUrl, cancel_url: t.cancelUrl,
    } } },
  };
}

interface Link { rel: string; href: string }
export const approvalLink = (links: Link[] | undefined) => links?.find((l) => l.rel === 'payer-action' || l.rel === 'approve')?.href ?? null;

export interface PaypalCapture { orderId: string; status: string; captureId: string | null; captureStatus: string | null; amountMinor: number | null; currency: string | null; customId: string | null }

/** Order (after GET or capture) → the first capture and the reference we sent. */
export function summarizeOrder(o: {
  id?: string; status?: string;
  purchase_units?: { custom_id?: string; payments?: { captures?: { id?: string; status?: string; amount?: { value?: string; currency_code?: string }; custom_id?: string }[] } }[];
}): PaypalCapture {
  const unit = o.purchase_units?.[0];
  const cap = unit?.payments?.captures?.[0];
  const value = cap?.amount?.value;
  return {
    orderId: String(o.id ?? ''), status: String(o.status ?? ''), captureId: cap?.id ?? null, captureStatus: cap?.status ?? null,
    amountMinor: value !== undefined && Number.isFinite(Number(value)) ? Math.round(Number(value) * 100) : null,
    currency: cap?.amount?.currency_code?.toUpperCase() ?? null, customId: unit?.custom_id ?? cap?.custom_id ?? null,
  };
}

/** PayPal order id carried by a webhook event (order events: resource.id; capture events: the "up" link). */
export function webhookOrderId(event: { event_type?: string; resource?: { id?: string; supplementary_data?: { related_ids?: { order_id?: string } } } }): string | null {
  const r = event.resource;
  if (!r) return null;
  if (event.event_type?.startsWith('CHECKOUT.ORDER.')) return r.id ?? null;
  return r.supplementary_data?.related_ids?.order_id ?? null;
}

/* -------------------------------------------------------------------------- */
/* HTTP                                                                        */
/* -------------------------------------------------------------------------- */

let cachedToken: { value: string; expiresAt: number; key: string } | null = null;

async function accessToken(cfg: PaypalConfig): Promise<string> {
  const key = `${cfg.apiBase}:${cfg.clientId}`;
  if (cachedToken && cachedToken.key === key && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  let res: Response;
  try {
    res = await fetch(`${cfg.apiBase}/v1/oauth2/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials', cache: 'no-store', signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new PaypalError(`PayPal unreachable: ${(err as Error).message}`, 0);
  }
  const json = await res.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !json.access_token) throw new PaypalError(json.error_description ?? `PayPal auth failed (${res.status})`, res.status);
  cachedToken = { value: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 300) * 1000, key };
  return json.access_token;
}

async function paypal<T>(path: string, init: { method: 'GET' | 'POST'; body?: unknown; requestId?: string }, cfg = paypalConfig()): Promise<T> {
  const token = await accessToken(cfg);
  let res: Response;
  try {
    res = await fetch(`${cfg.apiBase}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation',
        ...(init.requestId ? { 'PayPal-Request-Id': init.requestId } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: 'no-store', signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new PaypalError(`PayPal unreachable: ${(err as Error).message}`, 0);
  }
  const json = await res.json().catch(() => ({})) as T & { message?: string; details?: { issue?: string; description?: string }[] };
  if (!res.ok) {
    const issue = json.details?.[0]?.issue;
    throw new PaypalError(json.details?.[0]?.description ?? json.message ?? `PayPal request failed (${res.status})`, res.status, issue);
  }
  return json;
}

export async function createOrder(t: Parameters<typeof orderBody>[0]): Promise<{ orderId: string; approveUrl: string }> {
  // PayPal-Request-Id makes a retried create idempotent for the same attempt.
  const o = await paypal<{ id: string; links?: Link[] }>('/v2/checkout/orders', { method: 'POST', body: orderBody(t), requestId: `create-${t.reference}` });
  const approveUrl = approvalLink(o.links);
  if (!o.id || !approveUrl) throw new PaypalError('PayPal did not return an approval link', 502);
  return { orderId: o.id, approveUrl };
}

export const getOrder = async (orderId: string) => summarizeOrder(await paypal(`/v2/checkout/orders/${encodeURIComponent(orderId)}`, { method: 'GET' }));

/** Capture an approved order. Already captured → returns the existing capture. Not approved yet → status stays APPROVED/CREATED. */
export async function captureOrder(orderId: string): Promise<PaypalCapture> {
  try {
    return summarizeOrder(await paypal(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, { method: 'POST', body: {}, requestId: `capture-${orderId}` }));
  } catch (err) {
    if (err instanceof PaypalError && (err.issue === 'ORDER_ALREADY_CAPTURED' || err.issue === 'ORDER_NOT_APPROVED')) return getOrder(orderId);
    throw err;
  }
}

/** POST /v1/notifications/verify-webhook-signature with the delivery's headers. */
export async function verifyWebhook(headers: Headers, event: unknown): Promise<boolean> {
  const cfg = paypalConfig();
  if (!cfg.webhookId) throw new PaypalError('PAYPAL_WEBHOOK_ID is not configured', 500);
  const h = (k: string) => headers.get(k);
  if (!h('paypal-transmission-id') || !h('paypal-transmission-sig') || !h('paypal-cert-url')) return false;
  const r = await paypal<{ verification_status?: string }>('/v1/notifications/verify-webhook-signature', {
    method: 'POST',
    body: {
      auth_algo: h('paypal-auth-algo'), cert_url: h('paypal-cert-url'), transmission_id: h('paypal-transmission-id'),
      transmission_sig: h('paypal-transmission-sig'), transmission_time: h('paypal-transmission-time'),
      webhook_id: cfg.webhookId, webhook_event: event,
    },
  }, cfg);
  return r.verification_status === 'SUCCESS';
}
