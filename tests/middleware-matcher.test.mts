// Run: npx tsx --conditions=react-server --test tests/middleware-matcher.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../middleware.ts';

// The matcher source is a path regex (Next.js anchors it to the whole pathname).
const source = (config.matcher[0] as { source: string }).source;
const runsOn = (path: string) => new RegExp(`^${source}$`).test(path);

test('middleware runs on pages, server actions and session-authenticated API routes', () => {
  for (const path of ['/', '/login', '/dashboard', '/dashboard/discover', '/supplier/rfqs', '/rfqs/abc', '/admin/financials',
    '/api/orders', '/api/checkout/abc/card', '/api/auth/2fa/verify', '/api/uploads/sign']) {
    assert.ok(runsOn(path), `runs on ${path}`);
  }
});

test('middleware never runs on static assets', () => {
  for (const path of ['/_next/static/chunks/main.js', '/_next/static/css/app.css', '/_next/image', '/favicon.ico',
    '/logo.svg', '/hero.webp', '/hero.avif', '/anim.gif', '/fonts/inter.woff2', '/fonts/inter.woff', '/fonts/x.ttf',
    '/site.webmanifest', '/robots.txt', '/sitemap.xml', '/intro.mp4', '/app.js.map']) {
    assert.ok(!runsOn(path), `skips ${path}`);
  }
});

test('middleware skips endpoints authenticated by signature or secret, not by session', () => {
  for (const path of ['/api/webhooks/paystack', '/api/webhooks/daraja/token', '/api/v1/webhooks/n8n', '/api/payments/paypal/webhook',
    '/api/cron/expire-orders', '/api/csp-report', '/monitoring']) {
    assert.ok(!runsOn(path), `skips ${path}`);
  }
});

test('prefetches are skipped', () => {
  const missing = (config.matcher[0] as { missing: { key: string }[] }).missing.map((m) => m.key);
  assert.deepEqual(missing.sort(), ['next-router-prefetch', 'purpose']);
});
