import type { NextConfig } from 'next';

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

export default nextConfig;
