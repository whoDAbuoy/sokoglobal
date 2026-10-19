/**
 * Shared Sentry settings (client, server and edge). Sentry is OFF unless a DSN
 * is configured, so local dev and forks send nothing.
 *
 *   NEXT_PUBLIC_SENTRY_DSN          — project DSN (safe to expose; it only allows sending events)
 *   SENTRY_ENVIRONMENT              — optional, defaults to VERCEL_ENV / NODE_ENV
 *   SENTRY_TRACES_SAMPLE_RATE       — optional, 0–1 (default 0.1 in production, 1 elsewhere)
 *   SENTRY_AUTH_TOKEN / SENTRY_ORG / SENTRY_PROJECT — build-time only, for source-map upload
 */

export const sentryDsn = () => process.env.NEXT_PUBLIC_SENTRY_DSN || undefined;

export function sentryEnvironment(): string {
  return process.env.SENTRY_ENVIRONMENT || process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.VERCEL_ENV || process.env.NODE_ENV || 'development';
}

export function tracesSampleRate(): number {
  const raw = Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE);
  if (Number.isFinite(raw) && raw >= 0 && raw <= 1) return raw;
  return sentryEnvironment() === 'production' ? 0.1 : 1;
}

/**
 * What the SDK may collect (Sentry v11 `dataCollection`): no automatic user
 * details or cookies, no request/response bodies (they can carry payment data),
 * and credential headers denied. scrubEvent() below is a second filter.
 */
export const DATA_COLLECTION = {
  userInfo: false,
  cookies: false,
  httpHeaders: { request: { deny: ['authorization', 'cookie', 'x-paystack-signature', 'verif-hash', 'x-api-key'] }, response: false },
  httpBodies: [],
  urlQueryParams: true,
};

const SECRET_KEYS = /^(authorization|cookie|set-cookie|x-paystack-signature|verif-hash|x-api-key|apikey|password|token|access_token|refresh_token)$/i;
const SECRET_IN_URL = /(\/api\/webhooks\/daraja\/)[^/?#]+/g;   // the M-Pesa callback path carries a secret token

type Loose = Record<string, unknown>;

/** Remove credentials and secrets before an event leaves the server or browser. */
export function scrubEvent<T>(event: T): T {
  const e = event as Loose;
  const request = e.request as Loose | undefined;
  if (request) {
    delete request.cookies;
    if (request.headers && typeof request.headers === 'object') {
      for (const k of Object.keys(request.headers as Loose)) if (SECRET_KEYS.test(k)) (request.headers as Loose)[k] = '[redacted]';
    }
    if (typeof request.url === 'string') request.url = request.url.replace(SECRET_IN_URL, '$1[redacted]');
    if (request.data && typeof request.data === 'object') {
      for (const k of Object.keys(request.data as Loose)) if (SECRET_KEYS.test(k)) (request.data as Loose)[k] = '[redacted]';
    }
  }
  const user = e.user as Loose | undefined;
  if (user) { delete user.email; delete user.ip_address; }
  return event;
}
