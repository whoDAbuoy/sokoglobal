/**
 * Pure rate-limit rules + an in-memory sliding-window limiter (Edge-safe, no I/O).
 * Production uses Upstash Redis (lib/security/rate-limit.ts); the in-memory
 * limiter is the per-instance fallback for local dev or a missing Redis config.
 */

export type LimitName = 'checkout' | 'payment' | 'upload' | 'moderation' | 'action' | 'twofactor';

export const LIMIT_RULES: Record<LimitName, { limit: number; windowSec: number }> = {
  checkout: { limit: 10, windowSec: 60 },     // creating orders / carts / pool pledges
  payment: { limit: 10, windowSec: 60 },      // starting M-Pesa / card payments, confirming charges
  upload: { limit: 30, windowSec: 60 },       // signed upload URLs
  moderation: { limit: 30, windowSec: 60 },   // admin server actions (ban, delete, approve, reconcile)
  action: { limit: 60, windowSec: 60 },       // other server actions (profile change requests, replies)
  twofactor: { limit: 6, windowSec: 60 },     // 2FA codes and password changes (brute-force guard)
};

/** Which limit (if any) applies to a request. Only state-changing methods are limited. */
export function limitFor(method: string, path: string, isServerAction: boolean): LimitName | null {
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return null;
  if (isServerAction) return path.startsWith('/admin') ? 'moderation' : 'action';
  if (!path.startsWith('/api/')) return null;
  if (path.startsWith('/api/webhooks') || path.startsWith('/api/cron') || path === '/api/csp-report') return null;
  if (/^\/api\/(payments\/|orders\/[^/]+\/(mpesa|checkout|confirm)|checkout\/[^/]+\/(card|mpesa))/.test(path)) return 'payment';
  if (path.startsWith('/api/uploads')) return 'upload';
  if (path.startsWith('/api/auth/2fa')) return 'twofactor';
  if (path.startsWith('/api/orders') || path.startsWith('/api/checkout') || path.startsWith('/api/pools')) return 'checkout';
  return null;
}

/** First hop of X-Forwarded-For (set by Vercel), else a constant bucket. */
export function clientIp(forwardedFor: string | null, realIp: string | null): string {
  const first = forwardedFor?.split(',')[0]?.trim();
  return first || realIp?.trim() || 'unknown';
}

export interface LimitResult { success: boolean; limit: number; remaining: number; reset: number }

/** Sliding-window log limiter kept in memory (per server instance). */
export function createMemoryLimiter(maxKeys = 10_000) {
  const hits = new Map<string, number[]>();
  return function check(name: LimitName, key: string, now = Date.now()): LimitResult {
    const { limit, windowSec } = LIMIT_RULES[name];
    const windowMs = windowSec * 1000;
    const k = `${name}:${key}`;
    const recent = (hits.get(k) ?? []).filter((t) => now - t < windowMs);
    const success = recent.length < limit;
    if (success) recent.push(now);
    hits.delete(k);
    hits.set(k, recent);
    if (hits.size > maxKeys) hits.delete(hits.keys().next().value!);   // drop the least recently used key
    const reset = (recent[0] ?? now) + windowMs;
    return { success, limit, remaining: Math.max(0, limit - recent.length), reset };
  };
}
