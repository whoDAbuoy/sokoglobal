// Run: npx tsx --conditions=react-server --test tests/n8n-bridge-route.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as route from '../app/api/v1/webhooks/n8n/route.ts';
import { signedHeaders } from '../lib/integrations/signature.ts';

const SECRET = 'n'.repeat(40);
process.env.N8N_WEBHOOK_URL = 'https://n8n.example.com/webhook/sokoglobal';
process.env.N8N_WEBHOOK_SECRET = SECRET;
process.env.CRON_SECRET = 'c'.repeat(32);
delete process.env.TWENTY_API_URL;
delete process.env.TWENTY_API_KEY;

const URL = 'https://x/api/v1/webhooks/n8n';
const post = (body: string, headers: Record<string, string> = {}) =>
  route.POST(new Request(URL, { method: 'POST', body, headers: { 'Content-Type': 'application/json', ...headers } }));

test('route config: node runtime, never cached', () => {
  assert.equal(route.runtime, 'nodejs');
  assert.equal(route.dynamic, 'force-dynamic');
});

test('GET needs the cron secret', async () => {
  assert.equal((await route.GET(new Request(URL))).status, 401);
  assert.equal((await route.GET(new Request(URL, { headers: { authorization: 'Bearer wrong' } }))).status, 401);
});

test('POST without a valid signature is refused', async () => {
  const body = JSON.stringify({ targets: ['twenty'] });
  assert.equal((await post(body)).status, 401, 'unsigned');
  const h = signedHeaders('w'.repeat(40), body);
  assert.equal((await post(body, h)).status, 401, 'wrong secret');
  const good = signedHeaders(SECRET, body);
  assert.equal((await post(JSON.stringify({ targets: ['n8n'] }), good)).status, 401, 'signature for a different body');
  const stale = signedHeaders(SECRET, body, Date.now() - 10 * 60_000);
  assert.equal((await post(body, stale)).status, 401, 'replayed outside the 5-minute window');
});

test('signed POST: body is validated with the schema', async () => {
  for (const bad of ['{"targets":["salesforce"]}', '{"limit":0}', '{"limit":1.5}', '{"unexpected":true}']) {
    const res = await post(bad, signedHeaders(SECRET, bad));
    assert.equal(res.status, 422, bad);
  }
  const notJson = 'targets=n8n';
  assert.equal((await post(notJson, signedHeaders(SECRET, notJson))).status, 400);
  const huge = JSON.stringify({ pad: 'x'.repeat(5000) });
  assert.equal((await post(huge, signedHeaders(SECRET, huge))).status, 413);
});

test('signed POST for an unconfigured target is accepted and does nothing', async () => {
  const body = JSON.stringify({ targets: ['twenty'] });
  const res = await post(body, signedHeaders(SECRET, body));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { configured: ['n8n'], problems: [], purged: 0, results: {} });
});

test('cron bearer also works on POST', async () => {
  const body = JSON.stringify({ targets: ['twenty'] });
  const res = await post(body, { authorization: `Bearer ${'c'.repeat(32)}` });
  assert.equal(res.status, 200);
});
