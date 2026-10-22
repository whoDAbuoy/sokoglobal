import 'server-only';

/**
 * Delivery providers. Email: Resend (RESEND_API_KEY, NOTIFY_EMAIL_FROM).
 * SMS: Africa's Talking (AT_USERNAME, AT_API_KEY, optional AT_SENDER_ID;
 * AT_USERNAME=sandbox uses the sandbox API). WhatsApp has no provider yet.
 */
export class DeliveryError extends Error {
  constructor(message: string, readonly permanent: boolean) { super(message); }
}
export interface Delivered { providerRef: string | null }

const TIMEOUT_MS = 15_000;

async function post(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw new DeliveryError(`Network error: ${err instanceof Error ? err.message : String(err)}`, false);
  }
}
/** 4xx (except 408/429) won't succeed on retry; everything else might. */
const permanentStatus = (s: number) => s >= 400 && s < 500 && s !== 408 && s !== 429;

export async function sendEmail(to: string, subject: string, text: string, html: string): Promise<Delivered> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.NOTIFY_EMAIL_FROM;
  if (!key || !from) throw new DeliveryError('Email is not configured (RESEND_API_KEY / NOTIFY_EMAIL_FROM)', false);
  const res = await post('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, text, html }),
  });
  const body = await res.json().catch(() => ({})) as { id?: string; message?: string };
  if (!res.ok) throw new DeliveryError(`Resend ${res.status}: ${body.message ?? 'request failed'}`, permanentStatus(res.status));
  return { providerRef: body.id ?? null };
}

type AtRecipient = { status?: string; statusCode?: number; messageId?: string; number?: string };

export async function sendSms(to: string, message: string): Promise<Delivered> {
  const username = process.env.AT_USERNAME;
  const apiKey = process.env.AT_API_KEY;
  if (!username || !apiKey) throw new DeliveryError("SMS is not configured (AT_USERNAME / AT_API_KEY)", false);
  const host = username === 'sandbox' ? 'https://api.sandbox.africastalking.com' : 'https://api.africastalking.com';
  const form = new URLSearchParams({ username, to, message });
  if (process.env.AT_SENDER_ID) form.set('from', process.env.AT_SENDER_ID);
  const res = await post(`${host}/version1/messaging`, {
    method: 'POST',
    headers: { apiKey, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  const body = await res.json().catch(() => null) as { SMSMessageData?: { Message?: string; Recipients?: AtRecipient[] } } | null;
  if (!res.ok) throw new DeliveryError(`Africa's Talking ${res.status}: ${body?.SMSMessageData?.Message ?? 'request failed'}`, permanentStatus(res.status));
  const r = body?.SMSMessageData?.Recipients?.[0];
  // 100 Processed, 101 Sent, 102 Queued; 401+ are per-recipient failures (invalid number, blacklisted, no credit…).
  if (!r || !r.statusCode || r.statusCode >= 400) {
    const retryable = r?.statusCode === 405 /* insufficient balance */ || r?.statusCode === 500 || r?.statusCode === 501;
    throw new DeliveryError(`Africa's Talking: ${r?.status ?? body?.SMSMessageData?.Message ?? 'no recipient result'}`, !retryable);
  }
  return { providerRef: r.messageId ?? null };
}
