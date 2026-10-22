import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { buildCsp, createNonce, cspHeaderName, cspMode, reportingEndpointsHeader } from '@/lib/security/csp';
import { clientIp, limitFor } from '@/lib/security/rate-limit-core';
import { rateLimit, rateLimitHeaders } from '@/lib/security/rate-limit';
import { maintenanceDecision } from '@/lib/platform';
import { twoFactorGate } from '@/lib/security/two-factor-gate';
import { kycGate, parseKycStatus, type KycRequirements } from '@/lib/kyc';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Ban + 2FA state in one round trip (my_security_state, migration 016). Before 016 the RPC
 * is missing: fall back to the ban flag alone; if that column is missing too, nobody is banned.
 */
async function loadSecurityState(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase.rpc('my_security_state');
  if (!error && data) {
    const s = data as { is_banned?: boolean; two_factor_enabled?: boolean; two_factor_ok?: boolean; kyc_status?: unknown; kyc_required?: Partial<KycRequirements> };
    return {
      is_banned: !!s.is_banned, two_factor_enabled: !!s.two_factor_enabled, two_factor_ok: s.two_factor_ok !== false,
      // Migration 017+: KYC state for the listing / order gate (null before it → no gate).
      kyc_status: parseKycStatus(s.kyc_status),
      kyc_required: { listings: s.kyc_required?.listings !== false, orders: s.kyc_required?.orders !== false },
    };
  }
  const { data: flags } = await supabase.from('profiles').select('is_banned').eq('id', userId).maybeSingle<{ is_banned: boolean }>();
  return { is_banned: !!flags?.is_banned, two_factor_enabled: false, two_factor_ok: true, kyc_status: null, kyc_required: { listings: false, orders: false } };
}

// Maintenance flag (platform_settings, migration 014), cached per instance so pages don't each pay a query.
const MAINTENANCE_TTL_MS = 15_000;
let maintenanceCache: { on: boolean; at: number } | null = null;

const PROTECTED = ['/dashboard', '/supplier', '/admin', '/rfqs'];
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

  // ── Supabase session ───────────────────────────────────────────────────────
  const supabase = createServerClient(
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

  const { data: { user } } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;

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
  if (!maintenanceCache || Date.now() - maintenanceCache.at > MAINTENANCE_TTL_MS) {
    const { data, error } = await supabase.from('platform_settings').select('maintenance_mode').maybeSingle<{ maintenance_mode: boolean }>();
    maintenanceCache = { on: !error && data?.maintenance_mode === true, at: Date.now() };   // table missing (pre-014) → off
  }
  if (maintenanceCache.on) {
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

  if (!user && PROTECTED.some((p) => path.startsWith(p))) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';   // keep the page's own query inside redirectTo, not on /login
    url.searchParams.set('redirectTo', `${path}${request.nextUrl.search}`);
    return NextResponse.redirect(url);
  }

  // Banned accounts (profiles.is_banned, set from /admin/users) are signed out on any private page.
  // Supabase Auth also refuses their sign-in and token refresh; this catches sessions issued before the ban.
  // Two-factor (migration 016): a session that has not passed the code is sent to /auth/2fa (pages)
  // or refused (API / server actions). Postgres enforces the same for audited admin actions.
  const isProtectedPage = PROTECTED.some((p) => path.startsWith(p));
  if (user && (isProtectedPage || path.startsWith('/api/'))) {
    const security = await loadSecurityState(supabase, user.id);
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
      role: path.startsWith('/supplier') ? 'supplier' : null, status: security.kyc_status, required: security.kyc_required,
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

  if (csp && mode !== 'off') {
    response.headers.set(cspHeaderName(mode), csp);
    response.headers.set('Reporting-Endpoints', reportingEndpointsHeader(request.nextUrl.origin));
  }
  return response;
}

export const config = {
  // Pages only: skip static assets, webhooks, cron and the CSP collector itself.
  // Prefetches are skipped too (they'd mint nonces for documents never rendered).
  matcher: [
    {
      source: '/((?!_next/static|_next/image|favicon.ico|api/webhooks|api/cron|api/csp-report|monitoring|.*\\.(?:svg|png|jpg|jpeg|webp|ico|txt|xml)$).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
