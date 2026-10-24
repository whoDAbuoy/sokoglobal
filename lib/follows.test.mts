// Run: npx tsx --test lib/follows.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canFollow, followerLabel, withFollow } from './follows.ts';

test('followerLabel: singular, plural, thousands, and junk input', () => {
  assert.equal(followerLabel(0), 'No followers yet');
  assert.equal(followerLabel(-3), 'No followers yet');
  assert.equal(followerLabel(Number.NaN), 'No followers yet');
  assert.equal(followerLabel(1), '1 follower');
  assert.equal(followerLabel(940), '940 followers');
  assert.equal(followerLabel(1000), '1k followers');
  assert.equal(followerLabel(1250), '1.3k followers');
  assert.equal(followerLabel(250_400), '250k followers');
});

test('withFollow adds and removes without mutating the original set', () => {
  const start = new Set(['a']);
  const added = withFollow(start, 'b', true);
  assert.deepEqual([...added].sort(), ['a', 'b']);
  assert.deepEqual([...withFollow(added, 'a', false)], ['b']);
  assert.deepEqual([...start], ['a']);
  assert.deepEqual([...withFollow(start, 'a', true)], ['a']);   // idempotent
});

test('canFollow: never yourself, never sample listings, never without a supplier', () => {
  assert.equal(canFollow('s1', 'b1'), true);
  assert.equal(canFollow('s1', 's1'), false);
  assert.equal(canFollow('s1', 'b1', true), false);
  assert.equal(canFollow(null, 'b1'), false);
  assert.equal(canFollow('s1', null), true);
});
