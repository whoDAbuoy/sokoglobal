// Run: npx tsx --test lib/theme.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { THEME_INIT_SCRIPT, THEME_KEY, parseTheme, resolveTheme } from './theme.ts';

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
