// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://abcdefgh.supabase.co';
process.env.NEXT_PUBLIC_MAP_TILE_URL = 'https://{s}.tiles.example-maps.com/{z}/{x}/{y}.png';
const { buildCsp, createNonce, cspMode, reportingEndpointsHeader } = await import('../lib/security/csp.ts');

const directive = (csp: string, name: string) => csp.split('; ').find((d) => d.startsWith(name + ' ')) ?? '';

test('script-src: nonce + strict-dynamic, never unsafe-inline; unsafe-eval only in dev', () => {
  const csp = buildCsp({ nonce: 'abc123' });
  const s = directive(csp, 'script-src');
  assert.match(s, /'nonce-abc123'/);
  assert.match(s, /'strict-dynamic'/);
  assert.doesNotMatch(s, /unsafe-inline|unsafe-eval/);
  assert.match(directive(buildCsp({ nonce: 'x', isDev: true }), 'script-src'), /'unsafe-eval'/);
});

test('allows SokoGlobal third parties', () => {
  const csp = buildCsp({ nonce: 'n' });
  assert.match(directive(csp, 'connect-src'), /https:\/\/abcdefgh\.supabase\.co wss:\/\/abcdefgh\.supabase\.co/);   // API + Realtime chat
  assert.match(directive(csp, 'img-src'), /https:\/\/abcdefgh\.supabase\.co/);                                    // product photos
  assert.match(directive(csp, 'media-src'), /https:\/\/abcdefgh\.supabase\.co/);                                  // swatch videos
  assert.match(directive(csp, 'img-src'), /https:\/\/\*\.tiles\.example-maps\.com/);                              // custom tiles, {s} → *
  assert.match(directive(csp, 'img-src'), /https:\/\/\*\.basemaps\.cartocdn\.com/);
  assert.match(directive(csp, 'connect-src'), /https:\/\/api\.mapbox\.com/);
  assert.match(directive(csp, 'frame-src'), /https:\/\/checkout\.flutterwave\.com/);
  assert.match(directive(csp, 'form-action'), /https:\/\/checkout\.flutterwave\.com/);
  assert.match(directive(csp, 'script-src'), /https:\/\/va\.vercel-scripts\.com/);
});

test('lockdown directives + reporting', () => {
  const csp = buildCsp({ nonce: 'n' });
  for (const d of ["object-src 'none'", "base-uri 'self'", "frame-ancestors 'none'", 'report-uri /api/csp-report', 'report-to csp-endpoint']) assert.ok(csp.includes(d), d);
  assert.ok(!csp.includes('upgrade-insecure-requests'), 'not in report-only');
  assert.ok(buildCsp({ nonce: 'n', enforce: true }).includes('upgrade-insecure-requests'));
  assert.ok(!buildCsp({ nonce: 'n' }).includes('vercel.live'), 'preview toolbar only on previews');
  assert.ok(buildCsp({ nonce: 'n', isPreview: true }).includes('https://vercel.live'));
});

test('report endpoint override (e.g. Sentry) and mode switch', () => {
  assert.equal(reportingEndpointsHeader('https://sokoglobal.example'), 'csp-endpoint="https://sokoglobal.example/api/csp-report"');
  process.env.CSP_REPORT_URI = 'https://o1.ingest.sentry.io/api/2/security/?sentry_key=k';
  assert.match(buildCsp({ nonce: 'n' }), /report-uri https:\/\/o1\.ingest\.sentry\.io/);
  assert.equal(reportingEndpointsHeader('https://x'), 'csp-endpoint="https://o1.ingest.sentry.io/api/2/security/?sentry_key=k"');
  delete process.env.CSP_REPORT_URI;
  delete process.env.CSP_MODE; assert.equal(cspMode(), 'report-only');
  process.env.CSP_MODE = 'ENFORCE'; assert.equal(cspMode(), 'enforce');
  process.env.CSP_MODE = 'bogus'; assert.equal(cspMode(), 'report-only', 'unknown values fail safe to report-only');
});

test('nonces are random 128-bit base64', () => {
  const a = createNonce(), b = createNonce();
  assert.notEqual(a, b);
  assert.equal(Buffer.from(a, 'base64').length, 16);
});
