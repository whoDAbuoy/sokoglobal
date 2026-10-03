import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { buildCsp, createNonce, cspHeaderName, cspMode, reportingEndpointsHeader } from '@/lib/security/csp';

const PROTECTED = ['/dashboard', '/supplier', '/admin'];
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

  if (!user && PROTECTED.some((p) => path.startsWith(p))) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('redirectTo', path);
    return NextResponse.redirect(url);
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
      source: '/((?!_next/static|_next/image|favicon.ico|api/webhooks|api/cron|api/csp-report|.*\\.(?:svg|png|jpg|jpeg|webp|ico|txt|xml)$).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
