// Run: npx tsx --test lib/tours.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { TOURS, tourById, tourFor, tourSeenKey } from './tours.ts';

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? sources(p) : /\.tsx?$/.test(f) ? [p] : [];
  });
}
const root = join(import.meta.dirname, '..');
const code = ['app', 'components'].flatMap((d) => sources(join(root, d))).map((f) => readFileSync(f, 'utf8')).join('\n');

test('every tour step points at an element that exists somewhere in the app', () => {
  for (const t of TOURS) {
    for (const s of t.steps) {
      if (s.target) assert.ok(code.includes(`data-tour="${s.target}"`), `${t.id}: no element has data-tour="${s.target}"`);
    }
  }
});

test('tours are well formed', () => {
  const ids = new Set<string>();
  for (const t of TOURS) {
    assert.ok(!ids.has(t.id), `duplicate tour id ${t.id}`);
    ids.add(t.id);
    assert.ok(t.steps.length >= 2, `${t.id} needs at least two steps`);
    for (const s of t.steps) {
      assert.ok(s.title.length <= 60, `${t.id}: title too long: ${s.title}`);
      assert.ok(s.body.length <= 320, `${t.id}: body too long: ${s.title}`);
    }
  }
});

test('the right tour for each page and role', () => {
  assert.equal(tourFor('/dashboard', 'importer')?.id, 'buyer-home');
  assert.equal(tourFor('/dashboard/discover', 'importer')?.id, 'buyer-catalog');
  assert.equal(tourFor('/dashboard/orders', 'importer')?.id, 'buyer-orders');
  assert.equal(tourFor('/dashboard/orders/abc-123', 'importer')?.id, 'buyer-order');
  assert.equal(tourFor('/dashboard/orders/abc/extra', 'importer'), null);
  assert.equal(tourFor('/supplier', 'supplier')?.id, 'supplier-home');
  assert.equal(tourFor('/supplier/products/new', 'supplier')?.id, 'supplier-new-listing');
  assert.equal(tourFor('/dashboard', 'supplier'), null, 'tours are per role');
  assert.equal(tourFor('/admin', 'admin'), null, 'staff get no tours');
  assert.equal(tourFor('/dashboard', null), null);
});

test('lookups and the remembered key', () => {
  assert.equal(tourById('buyer-pools')?.title, 'Trend Pools');
  assert.equal(tourById('nope'), null);
  assert.equal(tourSeenKey({ id: 'buyer-home', version: 2 }), 'sg-tour:buyer-home:v2');
});

test('every Help Center "Show me" opens a real tour on the page it names', async () => {
  const { HELP_GUIDES, showMeHref } = await import('./help-guides.ts');
  for (const g of HELP_GUIDES) {
    if (!g.show) continue;
    const t = tourById(g.show.tour);
    assert.ok(t, `${g.id}: unknown tour ${g.show.tour}`);
    const path = g.show.href.split('?')[0];
    assert.equal(tourFor(path, t!.role)?.id, t!.id, `${g.id}: ${path} does not run ${t!.id}`);
  }
  assert.equal(showMeHref({ href: '/dashboard/settings?tab=security', tour: 'buyer-settings' }), '/dashboard/settings?tab=security&tour=buyer-settings');
});
