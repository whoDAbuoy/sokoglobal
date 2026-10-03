import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/csp-report — CSP violation collector.
 *
 * Accepts both formats browsers send:
 *   • legacy `report-uri`:  Content-Type application/csp-report  → {"csp-report": {...}}
 *   • Reporting API `report-to`: application/reports+json      → [{type:"csp-violation", body:{...}}]
 *
 * Output: one structured log line per unique violation ("[csp-violation] {...}").
 * In Vercel these appear in Runtime Logs; add a Log Drain (Datadog, Axiom,
 * Better Stack…) and alert on them. To send reports to Sentry instead, set
 * CSP_REPORT_URI (see lib/security/csp.ts) and this route stops receiving traffic.
 *
 * Endpoint is unauthenticated by necessity (browsers send reports anonymously),
 * so it is size-capped, strips query strings (they can carry tokens), drops
 * extension noise, de-duplicates and always answers 204.
 */
const MAX_BYTES = 16 * 1024;
const DEDUP_MS = 10 * 60_000;
const DEDUP_MAX = 500;
const seen = new Map<string, number>();   // per-instance de-dup; good enough to cut noise

type Raw = Record<string, unknown>;

// Extension/injected-script noise. Tested on the RAW value: URL parsing turns
// chrome-extension://… into origin "null", which would defeat the filter.
const NOISE = /^(chrome|moz|safari(-web)?|ms-browser)-extension:|^about:|^webkit-masked-url:/i;
const isNoise = (r: Raw) =>
  [r['blocked-uri'], r.blockedURL, r['source-file'], r.sourceFile].some((v) => typeof v === 'string' && NOISE.test(v));

const s = (v: unknown, max = 300) => (typeof v === 'string' ? v.slice(0, max) : typeof v === 'number' ? String(v) : undefined);

/** Keep scheme/host/path only — query strings and fragments can contain secrets. */
function scrubUrl(v: unknown): string | undefined {
  const str = s(v, 1000);
  if (!str) return undefined;
  if (['inline', 'eval', 'wasm-eval', 'data', 'blob', 'self'].includes(str)) return str;
  try { const u = new URL(str); return `${u.origin}${u.pathname}`.slice(0, 300); } catch { return str.split(/[?#]/)[0].slice(0, 300); }
}

function normalize(r: Raw) {
  return {
    directive: s(r['effective-directive'] ?? r.effectiveDirective ?? r['violated-directive'] ?? r.violatedDirective, 80),
    blocked: scrubUrl(r['blocked-uri'] ?? r.blockedURL),
    document: scrubUrl(r['document-uri'] ?? r.documentURL),
    source: scrubUrl(r['source-file'] ?? r.sourceFile),
    line: s(r['line-number'] ?? r.lineNumber, 10),
    column: s(r['column-number'] ?? r.columnNumber, 10),
    disposition: s(r.disposition, 20),        // "report" while in report-only mode
    sample: s(r['script-sample'] ?? r.sample, 80),
    status: s(r['status-code'] ?? r.statusCode, 5),
  };
}


export async function POST(request: Request) {
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BYTES) return new NextResponse(null, { status: 413 });
  const text = await request.text();
  if (text.length > MAX_BYTES) return new NextResponse(null, { status: 413 });

  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return new NextResponse(null, { status: 204 }); }

  const raws: Raw[] = Array.isArray(parsed)
    ? parsed.filter((x) => x && typeof x === 'object' && (x as Raw).type === 'csp-violation').map((x) => ((x as Raw).body ?? {}) as Raw)
    : parsed && typeof parsed === 'object' && (parsed as Raw)['csp-report']
      ? [(parsed as Raw)['csp-report'] as Raw]
      : [];

  const now = Date.now();
  for (const raw of raws.slice(0, 20)) {
    if (isNoise(raw)) continue;
    const v = normalize(raw);
    if (!v.directive) continue;

    const key = `${v.directive}|${v.blocked}|${v.document}`;
    const last = seen.get(key);
    if (last && now - last < DEDUP_MS) continue;
    if (seen.size >= DEDUP_MAX) seen.delete(seen.keys().next().value as string);
    seen.set(key, now);

    console.warn(`[csp-violation] ${JSON.stringify({ ...v, env: process.env.VERCEL_ENV ?? process.env.NODE_ENV, ua: s(request.headers.get('user-agent'), 120) })}`);
  }
  return new NextResponse(null, { status: 204 });
}
