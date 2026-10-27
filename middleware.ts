import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { buildCsp, createNonce, cspHeaderName, cspMode, reportingEndpointsHeader } from '@/lib/security/csp';
import { clientIp, limitFor } from '@/lib/security/rate-limit-core';
import { rateLimit, rateLimitHeaders } from '@/lib/security/rate-limit';
import { maintenanceDecision } from '@/lib/platform';
import { twoFactorGate } from '@/lib/security/two-factor-gate';
import { kycGate, parseKycStatus, type KycRequirements } from '@/lib/kyc';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';

/**
 * Ban, 2FA and KYC state in one round trip (my_security_state). null when it can't be read: the caller
 * then refuses API calls and lets pages through, where Postgres still enforces 2FA (check_request, migration
 * 041), bans and KYC. It never falls back to "not banned, no 2FA".
 */
async function loadSecurityState(supabase: SupabaseClient<Database>) {
  const { data, error } = await supabase.rpc('my_security_state');
  if (error || !data) return null;
  const s = data as { is_banned?: boolean; two_factor_enabled?: boolean; two_factor_ok?: boolean; kyc_status?: unknown; kyc_required?: Partial<KycRequirements> };
  return {
    is_banned: !!s.is_banned, two_factor_enabled: !!s.two_factor_enabled, two_factor_ok: s.two_factor_ok === true,
    kyc_status: parseKycStatus(s.kyc_status),
    kyc_required: { listings: s.kyc_required?.listings !== false, orders: s.kyc_required?.orders !== false },
  };
}

// Maintenance flag (platform_settings, migration 014), cached per instance so pages don't each pay a query.
const MAINTENANCE_TTL_MS = 15_000;
let maintenanceCache: { on: boolean; at: number } | null = null;

const PROTECTED = ['/dashboard', '/supplier', '/admin', '/rfqs'];

/** `root` itself or anything below it, matched on whole path segments: "/supplier" covers "/supplier/orders", never "/suppliers/x". */
const under = (path: string, root: string) => path === root || path.startsWith(`${root}/`);
/** Pages that need a signed-in session (the public /products and /suppliers pages are not among them). */
export const isProtectedPath = (path: string) => PROTECTED.some((root) => under(path, root));
const AUTH_PAGES = ['/login', '/signup'];

/**
 * 1. Content-Security-Policy with a per-request nonce (report-only by default;
 *    see lib/security/csp.ts for the rollout plan and reporting endpoint).
 * 2. Refreshes the Supabase session cookie and guards private routes.
 */
export async function middleware(request: NextRequest) {
  // ── CSP ────────────────────────────────────────────────────────────────────
  const mode = cspMode();
  const nonce = createNonce();
  const csp = mode === 'off' ? null : buildCsp({
    nonce,
    isDev: process.env.NODE_ENV === 'development',
    isPreview: process.env.VERCEL_ENV === 'preview',
    enforce: mode === 'enforce',
  });

  // Next.js reads the nonce from the CSP *request* header during rendering and
  // applies it to framework scripts; x-nonce lets server components read it
  // (e.g. for <Script nonce={…}> with third-party tags).
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  if (csp && mode !== 'off') requestHeaders.set(cspHeaderName(mode), csp);

  const next = () => {
    // Carry any cookies Supabase refreshed below into the forwarded request.
    const cookie = request.headers.get('cookie');
    if (cookie !== null) requestHeaders.set('cookie', cookie);
    return NextResponse.next({ request: { headers: requestHeaders } });
  };
  let response = next();
  /** The page response with its CSP and reporting headers. */
  const withCsp = (res: NextResponse) => {
    if (csp && mode !== 'off') {
      res.headers.set(cspHeaderName(mode), csp);
      res.headers.set('Reporting-Endpoints', reportingEndpointsHeader(request.nextUrl.origin));
    }
    return res;
  };

  // ── Supabase session ───────────────────────────────────────────────────────
  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(list: { name: string; value: string; options: CookieOptions }[]) {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = next();
          list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  // getClaims() refreshes an expired session (writing the new cookies) and verifies the access token's
  // signature: locally against the project's cached JWKS when it uses asymmetric signing keys, otherwise by
  // asking Supabase Auth (getUser), exactly as before. Pages still call getUser() for the authoritative check.
  const { data: claimsData } = await supabase.auth.getClaims();
  const user = typeof claimsData?.claims?.sub === 'string' ? { id: claimsData.claims.sub } : null;
  const path = request.nextUrl.pathname;
  const isProtectedPage = isProtectedPath(path);
  // Independent reads, started together once the session is settled (a refresh above must finish first,
  // so these never race it): the maintenance flag (cached per instance) and the caller's ban / 2FA / KYC state.
  const maintenanceRead = !maintenanceCache || Date.now() - maintenanceCache.at > MAINTENANCE_TTL_MS
    // Capped at 1.5 s with no retries (supabase-js would otherwise retry 3× with 1/2/4 s backoff): a slow database must
    // not hold every page. An unanswered read counts as "off", like a missing table, and is re-read after 15 s.
    ? supabase.from('platform_settings').select('maintenance_mode').abortSignal(AbortSignal.timeout(1500)).retry(false).maybeSingle<{ maintenance_mode: boolean }>()
        .then(({ data, error }) => { maintenanceCache = { on: !error && data?.maintenance_mode === true, at: Date.now() }; })   // unanswered → off
    : null;
  const securityRead = user && (isProtectedPage || path.startsWith('/api/')) ? loadSecurityState(supabase) : null;

  // ── Rate limits on state-changing API routes and server actions (lib/security/rate-limit-core.ts) ──
  const limitName = limitFor(request.method, path, request.headers.has('next-action'));
  if (limitName) {
    const key = user?.id ?? `ip:${clientIp(request.headers.get('x-forwarded-for'), request.headers.get('x-real-ip'))}`;
    const result = await rateLimit(limitName, key);
    if (!result.success) {
      return NextResponse.json({ error: 'Too many requests — please wait a moment and try again.' },
        { status: 429, headers: rateLimitHeaders(result) });
    }
  }

  // ── Maintenance mode (kill switch in /admin/control). Admins pass; everyone else sees /maintenance. ──
  await maintenanceRead;
  if (maintenanceCache?.on) {
    let isAdminUser = false;
    if (user) {
      const { data: access, error } = await supabase.rpc('my_admin_access');
      isAdminUser = !error && access !== null;
    }
    const decision = maintenanceDecision({ maintenance: true, path, isAdminUser, isServerAction: request.headers.has('next-action') });
    if (decision === 'api') {
      return NextResponse.json({ error: 'SokoGlobal is in maintenance mode. Please try again shortly.' }, { status: 503, headers: { 'Retry-After': '120' } });
    }
    if (decision === 'page') {
      const url = request.nextUrl.clone();
      url.pathname = '/maintenance';
      url.search = '';
      const rewrite = NextResponse.rewrite(url, { request: { headers: requestHeaders }, status: 503 });
      response.cookies.getAll().forEach((c) => rewrite.cookies.set(c));
      if (csp && mode !== 'off') rewrite.headers.set(cspHeaderName(mode), csp);
      return rewrite;
    }
  }

  if (!user && isProtectedPage) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';   // keep the page's own query inside redirectTo, not on /login
    url.searchParams.set('redirectTo', `${path}${request.nextUrl.search}`);
    return NextResponse.redirect(url);
  }

  // Banned accounts (profiles.is_banned, set from /admin/users) are signed out on any private page.
  // Supabase Auth also refuses their sign-in and token refresh; this catches sessions issued before the ban.
  // Two-factor (migration 016): a session that has not passed the code is sent to /auth/2fa (pages)
  // or refused (API / server actions). Postgres refuses the same session on every API call (migration 041).
  if (user && securityRead) {
    const security = await securityRead;
    if (!security) {
      if (path.startsWith('/api/') || request.headers.has('next-action')) {
        return NextResponse.json({ error: 'Your account status could not be checked. Please try again in a moment.' }, { status: 503, headers: { 'Retry-After': '5' } });
      }
      return withCsp(response);
    }
    if (security.is_banned && isProtectedPage) {
      await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      url.search = '';
      url.searchParams.set('error', 'banned');
      const redirect = NextResponse.redirect(url);
      response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
      for (const c of request.cookies.getAll()) {
        if (c.name.startsWith('sb-')) redirect.cookies.set(c.name, '', { path: '/', maxAge: 0 });
      }
      return redirect;
    }
    const gate = twoFactorGate({ path, isServerAction: request.headers.has('next-action'), enabled: security.two_factor_enabled, ok: security.two_factor_ok });
    if (gate === 'api') {
      return NextResponse.json({ error: 'Two-factor verification required', twoFactor: true }, { status: 401 });
    }
    if (gate === 'challenge') {
      const url = request.nextUrl.clone();
      url.pathname = '/auth/2fa';
      url.search = '';
      url.searchParams.set('redirectTo', `${path}${request.nextUrl.search}`);
      const redirect = NextResponse.redirect(url);
      response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
      return redirect;
    }
    // KYC (migration 017): new listings and new escrow orders need an approved verification.
    const kyc = kycGate({
      path, method: request.method, isServerAction: request.headers.has('next-action'),
      role: under(path, '/supplier') ? 'supplier' : null, status: security.kyc_status, required: security.kyc_required,
    });
    if (kyc.kind === 'forbid') return NextResponse.json({ error: kyc.error, kyc: true }, { status: 403 });
    if (kyc.kind === 'redirect') {
      const url = request.nextUrl.clone();
      const [pathname, query] = kyc.to.split('?');
      url.pathname = pathname;
      url.search = query ? `?${query}` : '';
      const redirect = NextResponse.redirect(url);
      response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
      return redirect;
    }
  }

  if (user && AUTH_PAGES.includes(path)) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return withCsp(response);
}

export const config = {
  // Pages only: skip static assets (build output, images, fonts, media, source maps), webhooks, cron, the
  // n8n bridge (all authenticated by signature or cron secret, never by session) and the CSP collector.
  // Prefetches are skipped too (they'd mint nonces for documents never rendered).
  matcher: [
    {
      source: '/((?!_next/static|_next/image|favicon.ico|api/webhooks|api/v1/webhooks|api/payments/paypal/webhook|api/cron|api/csp-report|monitoring|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|txt|xml|woff2?|ttf|otf|webmanifest|mp4|webm|map)$).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
