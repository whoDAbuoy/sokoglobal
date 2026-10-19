import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis/cloudflare';   // fetch-only build: runs in the Edge middleware without Node APIs
import { createMemoryLimiter, LIMIT_RULES, type LimitName, type LimitResult } from './rate-limit-core';

/**
 * Rate limiting for sensitive routes (Edge + Node safe).
 *   UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN set → Upstash Redis sliding
 *   window, shared by every instance (production).
 *   Not set → in-memory per instance (dev / preview); logged once.
 * Fails OPEN if Redis is unreachable, so an outage never blocks payments.
 */
const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = url && token ? new Redis({ url, token }) : null;

const limiters = new Map<LimitName, Ratelimit>();
function upstash(name: LimitName): Ratelimit | null {
  if (!redis) return null;
  let l = limiters.get(name);
  if (!l) {
    const { limit, windowSec } = LIMIT_RULES[name];
    l = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(limit, `${windowSec} s`), prefix: `sg:rl:${name}`, analytics: false });
    limiters.set(name, l);
  }
  return l;
}

const memory = createMemoryLimiter();
let warned = false;

export async function rateLimit(name: LimitName, key: string): Promise<LimitResult> {
  const l = upstash(name);
  if (!l) {
    if (!warned && process.env.NODE_ENV === 'production') { warned = true; console.warn('[rate-limit] Upstash not configured — using per-instance memory limits'); }
    return memory(name, key);
  }
  try {
    const r = await l.limit(key);
    return { success: r.success, limit: r.limit, remaining: r.remaining, reset: r.reset };
  } catch (err) {
    console.error('[rate-limit] Upstash error — allowing request', err);
    return { success: true, limit: LIMIT_RULES[name].limit, remaining: LIMIT_RULES[name].limit, reset: Date.now() };
  }
}

export function rateLimitHeaders(r: LimitResult): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(r.limit),
    'X-RateLimit-Remaining': String(r.remaining),
    'X-RateLimit-Reset': String(Math.ceil(r.reset / 1000)),
    ...(r.success ? {} : { 'Retry-After': String(Math.max(1, Math.ceil((r.reset - Date.now()) / 1000))) }),
  };
}
