// Run: npx tsx --test lib/integrations/config.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readIntegrationConfig } from './config.ts';

const SECRET = 's'.repeat(32);
const KEY = 'k'.repeat(40);

test('nothing set: both targets off, no problems', () => {
  assert.deepEqual(readIntegrationConfig({}), { n8n: null, twenty: null, problems: [] });
});

test('valid settings are parsed; trailing slashes are trimmed from the Twenty URL', () => {
  const c = readIntegrationConfig({
    NODE_ENV: 'production', N8N_WEBHOOK_URL: 'https://n8n.example.com/webhook/soko', N8N_WEBHOOK_SECRET: SECRET,
    TWENTY_API_URL: 'https://crm.example.com//', TWENTY_API_KEY: KEY,
  });
  assert.deepEqual(c.n8n, { webhookUrl: 'https://n8n.example.com/webhook/soko', secret: SECRET });
  assert.deepEqual(c.twenty, { baseUrl: 'https://crm.example.com', apiKey: KEY });
  assert.deepEqual(c.problems, []);
});

test('half-configured or weak settings are reported and the target stays off', () => {
  const c = readIntegrationConfig({ N8N_WEBHOOK_URL: 'https://n8n.example.com/webhook/soko', N8N_WEBHOOK_SECRET: 'short', TWENTY_API_KEY: KEY });
  assert.equal(c.n8n, null);
  assert.equal(c.twenty, null);
  assert.ok(c.problems.some((p) => p.startsWith('N8N_WEBHOOK_SECRET')));
  assert.ok(c.problems.some((p) => p.startsWith('TWENTY_API_URL')));
});

test('http:// only outside production; other schemes never', () => {
  const local = { N8N_WEBHOOK_URL: 'http://localhost:5678/webhook/soko', N8N_WEBHOOK_SECRET: SECRET };
  assert.ok(readIntegrationConfig({ ...local, NODE_ENV: 'development' }).n8n);
  assert.equal(readIntegrationConfig({ ...local, NODE_ENV: 'production' }).n8n, null);
  assert.equal(readIntegrationConfig({ N8N_WEBHOOK_URL: 'file:///etc/passwd', N8N_WEBHOOK_SECRET: SECRET }).n8n, null);
  assert.equal(readIntegrationConfig({ N8N_WEBHOOK_URL: 'not a url', N8N_WEBHOOK_SECRET: SECRET }).n8n, null);
});
