// Run: npx tsx --test lib/ratings.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStars, ratingLabel, starFills } from './ratings.ts';

test('starFills rounds to the nearest half star', () => {
  assert.deepEqual(starFills(null), ['empty', 'empty', 'empty', 'empty', 'empty']);
  assert.deepEqual(starFills(5), ['full', 'full', 'full', 'full', 'full']);
  assert.deepEqual(starFills(3.5), ['full', 'full', 'full', 'half', 'empty']);
  assert.deepEqual(starFills(3.74), ['full', 'full', 'full', 'half', 'empty']);
  assert.deepEqual(starFills(3.76), ['full', 'full', 'full', 'full', 'empty']);
  assert.deepEqual(starFills(0.2), ['empty', 'empty', 'empty', 'empty', 'empty']);
  assert.deepEqual(starFills(9), starFills(5));
});

test('ratingLabel and parseStars', () => {
  assert.equal(ratingLabel(null, 0), 'No ratings yet');
  assert.equal(ratingLabel(4.5, 12), '4.5 · 12 ratings');
  assert.equal(ratingLabel(5, 1), '5.0 · 1 rating');
  assert.equal(parseStars('4'), 4);
  assert.equal(parseStars(5), 5);
  for (const bad of [0, 6, 2.5, '', 'x', null, undefined]) assert.equal(parseStars(bad), null);
});
