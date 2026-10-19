// Run: npx tsx --test lib/wishlist.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WISHLIST_MAX, parseWishlist, toggleId, wishlistKey } from './wishlist.ts';

test('wishlist key is per user', () => {
  assert.equal(wishlistKey('u1'), 'sokoglobal.wishlist.v1:u1');
  assert.equal(wishlistKey(undefined), 'sokoglobal.wishlist.v1:guest');
});

test('parseWishlist tolerates junk and de-duplicates', () => {
  assert.deepEqual(parseWishlist(null), []);
  assert.deepEqual(parseWishlist('not json'), []);
  assert.deepEqual(parseWishlist('{"a":1}'), []);
  assert.deepEqual(parseWishlist(JSON.stringify(['a', 'a', 7, '', 'b'])), ['a', 'b']);
  assert.equal(parseWishlist(JSON.stringify(Array.from({ length: 150 }, (_, i) => `p${i}`))).length, WISHLIST_MAX);
});

test('toggleId adds then removes', () => {
  assert.deepEqual(toggleId([], 'x'), ['x']);
  assert.deepEqual(toggleId(['x', 'y'], 'x'), ['y']);
});
