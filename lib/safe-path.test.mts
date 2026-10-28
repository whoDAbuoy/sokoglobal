// Run: npx tsx --test lib/safe-path.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameSitePath } from './safe-path.ts';

test('same-site paths pass through unchanged', () => {
  assert.equal(sameSitePath('/dashboard'), '/dashboard');
  assert.equal(sameSitePath('/dashboard/orders/1?tab=x#top'), '/dashboard/orders/1?tab=x#top');
  assert.equal(sameSitePath('/products/aviator-4998afbb'), '/products/aviator-4998afbb');
});

test('anything that can leave the site is refused', () => {
  for (const v of [
    '//evil.example', 'https://evil.example', '/\\evil.example/x', '/%5Cevil.example', '/%5cevil.example',
    '/\t/evil.example', '/%09/evil.example/x', '/\n/evil.example', '/%0A/evil.example', '/%2F/evil.example',
    'evil.example', 'javascript:alert(1)', '', null, undefined, '/%E0%A4%A',
  ]) assert.equal(sameSitePath(v), null, String(v));
});
