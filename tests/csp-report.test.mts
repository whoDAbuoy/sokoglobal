import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POST } from '../app/api/csp-report/route.ts';
const logs: string[] = []; console.warn = (m: string) => { logs.push(m); };
const post = (body: string, ct = 'application/csp-report') => POST(new Request('http://x/api/csp-report', { method: 'POST', headers: { 'content-type': ct }, body }));
test('extension noise dropped (raw check), real violations logged with secrets scrubbed', async () => {
  for (const blocked of ['chrome-extension://abc/inject.js', 'moz-extension://x/y.js', 'safari-web-extension://z/a.js']) {
    assert.equal((await post(JSON.stringify({ 'csp-report': { 'document-uri': 'https://s.example/login', 'blocked-uri': blocked, 'effective-directive': 'script-src-elem' } }))).status, 204);
  }
  assert.equal(logs.length, 0, 'no extension noise logged');
  await post(JSON.stringify({ 'csp-report': { 'document-uri': 'https://s.example/orders/1?token=SECRET', 'blocked-uri': 'https://evil.example/a.js?k=SECRET#f', 'effective-directive': 'script-src-elem', 'disposition': 'report' } }));
  assert.equal(logs.length, 1);
  assert.ok(!logs[0].includes('SECRET'), 'query strings stripped');
  assert.match(logs[0], /"blocked":"https:\/\/evil.example\/a.js"/);
});
test('Reporting API batch: only csp-violation entries, capped', async () => {
  logs.length = 0;
  const batch = [{ type: 'deprecation', body: {} }, ...Array.from({ length: 30 }, (_, i) => ({ type: 'csp-violation', body: { effectiveDirective: 'img-src', blockedURL: `https://t${i}.example/p.png`, documentURL: 'https://s.example/' } }))];
  await post(JSON.stringify(batch), 'application/reports+json');
  assert.equal(logs.length, 20, 'max 20 per request');
});
