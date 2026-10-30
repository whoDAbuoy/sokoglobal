// Run: npx tsx --test lib/product-layout.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PRODUCT_LAYOUT, LAYOUT_CONTAINER, PRODUCT_LAYOUTS, parseProductLayout } from './product-layout.ts';

test('the detailed card stays the default; saved choices are honoured; junk falls back', () => {
  assert.equal(DEFAULT_PRODUCT_LAYOUT, 'detailed');
  assert.equal(parseProductLayout('grid'), 'grid');
  assert.equal(parseProductLayout('list'), 'list');
  assert.equal(parseProductLayout(null), 'detailed');
  assert.equal(parseProductLayout('tiles'), 'detailed');
});

test('grid shows two products per row on phones; every layout has a container', () => {
  assert.match(LAYOUT_CONTAINER.grid, /(^| )grid-cols-2( |$)/);
  for (const l of PRODUCT_LAYOUTS) assert.ok(LAYOUT_CONTAINER[l]);
});
