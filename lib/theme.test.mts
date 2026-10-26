// Run: npx tsx --test lib/theme.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { THEME_INIT_SCRIPT, THEME_KEY, isSellsyRoute, parseTheme, resolveTheme } from './theme.ts';

test('parseTheme defaults to system for anything unexpected', () => {
  assert.equal(parseTheme('dark'), 'dark');
  assert.equal(parseTheme('light'), 'light');
  assert.equal(parseTheme('system'), 'system');
  for (const raw of [null, undefined, '', 'DARK', 'blue']) assert.equal(parseTheme(raw), 'system');
});

test('resolveTheme: explicit choice wins, system follows the OS', () => {
  assert.equal(resolveTheme('dark', false), 'dark');
  assert.equal(resolveTheme('light', true), 'light');
  assert.equal(resolveTheme('system', true), 'dark');
  assert.equal(resolveTheme('system', false), 'light');
});

test('init script uses the same storage key and only toggles the dark class', () => {
  assert.ok(THEME_INIT_SCRIPT.includes(THEME_KEY));
  assert.ok(THEME_INIT_SCRIPT.includes("classList.toggle('dark'"));
  assert.ok(!/<\/?script/i.test(THEME_INIT_SCRIPT));   // safe to inline
});

test('init script: stored choice wins, system follows the OS, blocked storage still applies the OS theme', async () => {
  const { runInNewContext } = await import('node:vm');
  const run = (stored: string | null | 'throws', osDark: boolean) => {
    const classes = new Set<string>(['font']);
    const root = { classList: { toggle: (c: string, on: boolean) => (on ? classes.add(c) : classes.delete(c)) }, style: { colorScheme: '' } };
    runInNewContext(THEME_INIT_SCRIPT, {
      localStorage: { getItem: (k: string) => { if (stored === 'throws') throw new Error('SecurityError'); return k === THEME_KEY ? stored : null; } },
      window: { matchMedia: (q: string) => ({ matches: q.includes('dark') && osDark }) },
      document: { documentElement: root },
    });
    return { dark: classes.has('dark'), scheme: root.style.colorScheme, kept: classes.has('font') };
  };
  assert.deepEqual(run('dark', false), { dark: true, scheme: 'dark', kept: true });
  assert.deepEqual(run('light', true), { dark: false, scheme: 'light', kept: true });
  assert.deepEqual(run('system', true), { dark: true, scheme: 'dark', kept: true });
  assert.deepEqual(run(null, false), { dark: false, scheme: 'light', kept: true });
  assert.deepEqual(run('throws', true), { dark: true, scheme: 'dark', kept: true });   // used to abort the whole script
});

test('isSellsyRoute: supplier portal and the buyer side, not the landing, auth or admin pages', () => {
  for (const p of ['/supplier', '/supplier/orders', '/dashboard', '/dashboard/discover', '/dashboard/checkout/x', '/dashboard/settings', '/rfqs/x']) {
    assert.equal(isSellsyRoute(p), true, p);
  }
  for (const p of ['/', '/login', '/signup', '/admin', '/admin/orders', '/supplierx', '/dashboardx', '/maintenance', null, undefined]) {
    assert.equal(isSellsyRoute(p), false, String(p));
  }
});
