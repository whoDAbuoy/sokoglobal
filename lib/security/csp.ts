/**
 * SokoGlobal Content-Security-Policy (Edge-runtime safe: no Node APIs).
 *
 * Rollout plan
 *   1. CSP_MODE=report-only (default) — browsers REPORT violations, block nothing.
 *   2. Watch reports for 1–2 weeks across Production traffic (incl. checkout,
 *      tracking map, uploads, support chat). Add any legitimate source below.
 *   3. CSP_MODE=enforce — same policy, now blocking. Keep reporting on.
 *   CSP_MODE=off is an emergency kill-switch.
 *
 * Design
 *   • Scripts: per-request nonce + 'strict-dynamic'. Next.js 15 reads the nonce
 *     from the CSP request header (enforced OR report-only) and stamps it on
 *     its own <script> tags. Host allow-lists in script-src are only a fallback
 *     for old browsers (CSP2); modern browsers ignore them under 'strict-dynamic'.
 *   • Styles: 'unsafe-inline' is kept because React `style={…}` attributes,
 *     Leaflet's positioning and the map's <style> block need it. Style
 *     injection is far lower risk than script injection; tighten later if needed.
 */

export type CspMode = 'report-only' | 'enforce' | 'off';

export function cspMode(): CspMode {
  const v = (process.env.CSP_MODE ?? 'report-only').toLowerCase();
  return v === 'enforce' || v === 'off' ? v : 'report-only';
}

export const cspHeaderName = (mode: Exclude<CspMode, 'off'>) =>
  mode === 'enforce' ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only';

/** 128-bit random nonce, base64. */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/**
 * ── WHERE VIOLATION REPORTS GO ─────────────────────────────────────────────
 * Default: our own collector at /api/csp-report (structured logs in Vercel →
 * forward with a Log Drain to Datadog/Axiom/Better Stack).
 *
 * To use Sentry instead, set CSP_REPORT_URI to the project's "Security Header"
 * endpoint (Sentry → Project Settings → Security Headers), e.g.
 *   https://o123456.ingest.sentry.io/api/7654321/security/?sentry_key=abc123&sentry_environment=production
 * Any other report collector (report-uri.com, a custom service) works the same way.
 * ───────────────────────────────────────────────────────────────────────────
 */
export function reportUri(): string {
  return process.env.CSP_REPORT_URI || '/api/csp-report';
}

/** Origin of an env URL, or null. */
function originOf(url: string | undefined): URL | null {
  if (!url) return null;
  try { return new URL(url); } catch { return null; }
}

/**
 * Tile host from NEXT_PUBLIC_MAP_TILE_URL, e.g.
 *   https://{s}.basemaps.cartocdn.com/...  →  https://*.basemaps.cartocdn.com
 *   https://api.maptiler.com/maps/...      →  https://api.maptiler.com
 */
function tileSource(): string | null {
  const tpl = process.env.NEXT_PUBLIC_MAP_TILE_URL;
  if (!tpl) return null;
  const wildcard = /^https:\/\/\{s\}\./.test(tpl);
  const u = originOf(tpl.replace(/\{[a-z]+\}/gi, 'a'));
  if (!u || u.protocol !== 'https:') return null;
  return wildcard ? `https://*.${u.hostname.split('.').slice(1).join('.')}` : `https://${u.hostname}`;
}

export interface CspOptions {
  nonce: string;
  isDev?: boolean;
  isPreview?: boolean;   // Vercel preview deployments (toolbar / comments)
  enforce?: boolean;
}

export function buildCsp({ nonce, isDev = false, isPreview = false, enforce = false }: CspOptions): string {
  const supabase = originOf(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const supabaseHttps = supabase ? `https://${supabase.host}` : null;
  const supabaseWss = supabase ? `wss://${supabase.host}` : null;   // Realtime (support chat)

  // ── Third parties ────────────────────────────────────────────────────────
  const FLUTTERWAVE = ['https://checkout.flutterwave.com', 'https://*.flutterwave.com'];
  const MAP_TILES = [
    tileSource(),
    'https://*.basemaps.cartocdn.com',      // default CARTO tiles
    'https://*.tile.openstreetmap.org',
    'https://api.mapbox.com', 'https://*.tiles.mapbox.com',   // if switching to Mapbox raster/GL
    'https://api.maptiler.com',
  ];
  const MAPBOX_API = ['https://api.mapbox.com', 'https://events.mapbox.com'];
  const VERCEL_ANALYTICS = ['https://va.vercel-scripts.com', 'https://vitals.vercel-insights.com'];
  // Same-origin /_vercel/insights and /_vercel/speed-insights are covered by 'self'.
  const VERCEL_TOOLBAR = isPreview ? ['https://vercel.live', 'https://*.pusher.com', 'wss://*.pusher.com'] : [];
  const CLOUDINARY = ['https://res.cloudinary.com'];

  const directives: Record<string, (string | null | false)[]> = {
    'default-src': ["'self'"],
    'script-src': [
      "'self'", `'nonce-${nonce}'`, "'strict-dynamic'",
      ...FLUTTERWAVE, ...VERCEL_ANALYTICS, ...(isPreview ? ['https://vercel.live'] : []),
      isDev && "'unsafe-eval'",   // React Refresh in `next dev` only
    ],
    'style-src': ["'self'", "'unsafe-inline'", ...(isPreview ? ['https://vercel.live'] : [])],
    'img-src': ["'self'", 'data:', 'blob:', supabaseHttps, ...MAP_TILES, ...CLOUDINARY, 'https://*.flutterwave.com', ...(isPreview ? ['https://vercel.live', 'https://vercel.com'] : [])],
    'font-src': ["'self'", 'data:', ...(isPreview ? ['https://vercel.live', 'https://assets.vercel.com'] : [])],
    'media-src': ["'self'", 'blob:', supabaseHttps, ...CLOUDINARY],   // swatch videos
    'connect-src': [
      "'self'", supabaseHttps, supabaseWss, ...MAPBOX_API, ...VERCEL_ANALYTICS, ...VERCEL_TOOLBAR,
      isDev && 'ws:',   // HMR
    ],
    'frame-src': [...FLUTTERWAVE, ...(isPreview ? ['https://vercel.live'] : [])],   // inline checkout modal, if adopted
    'worker-src': ["'self'", 'blob:'],
    'manifest-src': ["'self'"],
    'form-action': ["'self'", 'https://checkout.flutterwave.com'],
    'frame-ancestors': ["'none'"],
    'base-uri': ["'self'"],
    'object-src': ["'none'"],
    'report-uri': [reportUri()],
    'report-to': ['csp-endpoint'],
  };

  const parts = Object.entries(directives).map(([k, vals]) => {
    const unique = [...new Set(vals.filter((v): v is string => Boolean(v)))];
    return `${k} ${unique.join(' ')}`;
  });
  // Only meaningful when enforcing (ignored in report-only).
  if (enforce && !isDev) parts.push('upgrade-insecure-requests');
  return parts.join('; ');
}

/** Absolute URL for the Reporting API `Reporting-Endpoints` header. */
export function reportingEndpointsHeader(requestOrigin: string): string {
  const uri = reportUri();
  const abs = uri.startsWith('http') ? uri : `${requestOrigin}${uri}`;
  return `csp-endpoint="${abs}"`;
}
