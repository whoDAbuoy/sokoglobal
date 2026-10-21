import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs/config';

/**
 * Whitelist ONLY this project's Supabase Storage host for <Image /> optimisation
 * (tighter than a *.supabase.co wildcard, which would let anyone's bucket be
 * proxied through our image optimiser). Derived from the env var so staging and
 * production each allow their own project.
 */
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!supabaseUrl) throw new Error('NEXT_PUBLIC_SUPABASE_URL must be set (see .env.example)');
const supabaseHost = new URL(supabaseUrl).hostname; // e.g. abcdefgh.supabase.co

/**
 * Baseline security headers for every route.
 *
 * Content-Security-Policy is NOT set here: it needs a fresh nonce per request,
 * so it's emitted by middleware.ts using lib/security/csp.ts
 *   - CSP_MODE=report-only (default) → Content-Security-Policy-Report-Only
 *   - CSP_MODE=enforce              → Content-Security-Policy
 *   - CSP_MODE=off                  → no CSP (emergency kill-switch)
 * Violation reports go to /api/csp-report, or to CSP_REPORT_URI (e.g. Sentry's
 * security endpoint) if set.
 */
const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(), payment=(self)' },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    // No Server Action body cap (avatars go through a Server Action). A number, not the string
    // 'Infinity': Next parses strings with `bytes`, which turns 'Infinity' into NaN.
    // Vercel still caps any function request body at 4.5 MB; large media uploads go
    // browser → Supabase Storage directly via signed URLs and never pass through here.
    serverActions: { bodySizeLimit: Infinity },
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      // Public bucket objects: /storage/v1/object/public/product-media/...
      { protocol: 'https', hostname: supabaseHost, pathname: '/storage/v1/object/public/**' },
      // Supabase on-the-fly transforms (Pro plan), if enabled later
      { protocol: 'https', hostname: supabaseHost, pathname: '/storage/v1/render/image/public/**' },
      // Optional Cloudinary storage backend
      { protocol: 'https', hostname: 'res.cloudinary.com' },
    ],
  },
};

/**
 * Sentry build integration. Source maps are uploaded only when SENTRY_AUTH_TOKEN
 * (+ SENTRY_ORG / SENTRY_PROJECT) are set at build time; without them the build
 * is unchanged apart from the /monitoring tunnel route (same-origin, so the CSP
 * needs no Sentry host and ad-blockers don't drop events).
 */
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  sentryUrl: process.env.SENTRY_URL,   // only for EU-hosted orgs (https://de.sentry.io)
  silent: !process.env.CI,
  tunnelRoute: '/monitoring',
  widenClientFileUpload: true,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  telemetry: false,
});
