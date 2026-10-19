// Run: npx tsx --test lib/admin-inbox.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  inboxCounts, inMailbox, initials, parseLabel, parseMailbox, parseMuted, relativeTime, snippet,
  sortTickets, splitHistory, statusDot, toggleMuted,
} from './admin-inbox.ts';

const t = (status: 'open' | 'awaiting_customer' | 'resolved', category: 'order_inquiry' | 'dispute' | 'payment' | 'shipping' | 'other' = 'order_inquiry', last_message_at = '2026-10-19T10:00:00Z') =>
  ({ status, category, last_message_at });

test('mailboxes map to ticket status / category', () => {
  assert.equal(inMailbox(t('open'), 'inbox'), true);
  assert.equal(inMailbox(t('resolved'), 'inbox'), false);
  assert.equal(inMailbox(t('open'), 'needs_reply'), true);
  assert.equal(inMailbox(t('awaiting_customer'), 'awaiting'), true);
  assert.equal(inMailbox(t('open', 'dispute'), 'disputes'), true);
  assert.equal(inMailbox(t('resolved', 'dispute'), 'disputes'), false);
  assert.equal(inMailbox(t('resolved'), 'resolved'), true);
  assert.equal(parseMailbox('spam'), 'inbox');
  assert.equal(parseMailbox('resolved'), 'resolved');
  assert.equal(parseLabel('payment'), 'payment');
  assert.equal(parseLabel('promotions'), null);
});

test('badge counts', () => {
  const c = inboxCounts([t('open'), t('open', 'dispute'), t('awaiting_customer', 'payment'), t('resolved', 'payment')]);
  assert.deepEqual(c.boxes, { inbox: 3, needs_reply: 2, awaiting: 1, disputes: 1, resolved: 1 });
  assert.equal(c.labels.payment, 1);
  assert.equal(c.labels.dispute, 1);
  assert.equal(c.labels.shipping, 0);
});

test('status dots', () => {
  assert.equal(statusDot(t('open')).className, 'bg-amber-500');
  assert.equal(statusDot(t('awaiting_customer')).className, 'bg-emerald-500');
  assert.equal(statusDot(t('open', 'dispute')).className, 'bg-red-500');
  assert.equal(statusDot(t('resolved', 'dispute')).className, 'bg-neutral-400');
});

test('disputes pinned first, then newest', () => {
  const sorted = sortTickets([
    { id: 'a', ...t('open', 'order_inquiry', '2026-10-19T12:00:00Z') },
    { id: 'b', ...t('open', 'dispute', '2026-10-10T00:00:00Z') },
    { id: 'c', ...t('open', 'payment', '2026-10-19T13:00:00Z') },
  ]);
  assert.deepEqual(sorted.map((x) => x.id), ['b', 'c', 'a']);
});

test('initials, snippet, relative time', () => {
  assert.equal(initials('Sarah Johnson'), 'SJ');
  assert.equal(initials('acme'), 'A');
  assert.equal(initials(''), '?');
  assert.equal(snippet('Hello\n\n  there'), 'Hello there');
  assert.equal(snippet('x'.repeat(100), 10).length, 10);
  const now = new Date('2026-10-19T12:00:00Z');
  assert.equal(relativeTime('2026-10-19T11:59:40Z', now), 'just now');
  assert.equal(relativeTime('2026-10-19T11:55:00Z', now), '5 min ago');
  assert.equal(relativeTime('2026-10-19T10:00:00Z', now), '2 hours ago');
  assert.equal(relativeTime('2026-10-18T08:00:00Z', now), 'Yesterday');
  assert.equal(relativeTime('2026-10-16T08:00:00Z', now), 'Oct 16');
  assert.equal(relativeTime('2025-10-16T08:00:00Z', now), 'Oct 16, 2025');
});

test('collapsed history keeps the last three', () => {
  assert.deepEqual(splitHistory([1, 2]), { earlier: [], recent: [1, 2] });
  assert.deepEqual(splitHistory([1, 2, 3, 4, 5]), { earlier: [1, 2], recent: [3, 4, 5] });
});

test('mute preference round-trip', () => {
  assert.deepEqual(toggleMuted(['a'], 'b', true), ['a', 'b']);
  assert.deepEqual(toggleMuted(['a', 'b'], 'a', false), ['b']);
  assert.deepEqual(parseMuted('["a",1,"b"]'), ['a', 'b']);
  assert.deepEqual(parseMuted('not json'), []);
  assert.deepEqual(parseMuted(null), []);
});
