// Run: npx tsx --test lib/chat-hub.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatBoxCounts, filterThreads, inChatBox, parseChatBox, productLabels, threadDot } from './chat-hub.ts';
import type { ChatThreadSummary } from './chat.ts';

const ME = 'me';
const t = (id: string, o: Partial<ChatThreadSummary> = {}): ChatThreadSummary => ({
  thread_id: id, product_id: 'p1', product_title: 'Shea Butter', my_role: 'buyer', counterpart_id: 'x', counterpart_name: 'Karité Co',
  last_message: 'Hello', last_message_at: '2026-10-19T10:00:00Z', last_sender_id: 'x', unread_count: 0, updated_at: '2026-10-19T10:00:00Z', ...o,
});

test('mailboxes', () => {
  assert.equal(parseChatBox('spam'), 'inbox');
  assert.equal(parseChatBox('sent'), 'sent');
  assert.equal(inChatBox(t('a', { unread_count: 2 }), 'unread', ME, []), true);
  assert.equal(inChatBox(t('a'), 'awaiting', ME, []), true);
  assert.equal(inChatBox(t('a', { last_sender_id: ME }), 'sent', ME, []), true);
  assert.equal(inChatBox(t('a', { last_message: null, last_sender_id: null }), 'awaiting', ME, []), false);
  assert.equal(inChatBox(t('a'), 'muted', ME, ['a']), true);
  const c = chatBoxCounts([t('a', { unread_count: 1 }), t('b', { last_sender_id: ME })], ME, ['b']);
  assert.deepEqual(c, { inbox: 2, unread: 1, awaiting: 1, sent: 1, muted: 1 });
});

test('product labels and filtering', () => {
  const threads = [
    t('a', { product_id: 'p1', unread_count: 1, last_message_at: '2026-10-19T09:00:00Z' }),
    t('b', { product_id: 'p2', product_title: 'Linen Shirts', counterpart_name: 'Maison Rouge', last_message_at: '2026-10-19T11:00:00Z' }),
    t('c', { product_id: 'p2', product_title: 'Linen Shirts', last_message_at: '2026-10-18T11:00:00Z' }),
  ];
  assert.deepEqual(productLabels(threads).map((l) => [l.key, l.count, l.unread]), [['p1', 1, 1], ['p2', 2, 0]]);
  assert.deepEqual(filterThreads(threads, { box: 'inbox', label: null, query: '', myId: ME, muted: [] }).map((x) => x.thread_id), ['b', 'a', 'c']);
  assert.deepEqual(filterThreads(threads, { box: 'inbox', label: 'p2', query: '', myId: ME, muted: [] }).map((x) => x.thread_id), ['b', 'c']);
  assert.deepEqual(filterThreads(threads, { box: 'inbox', label: null, query: 'maison', myId: ME, muted: [] }).map((x) => x.thread_id), ['b']);
});

test('status dots', () => {
  assert.equal(threadDot(t('a', { unread_count: 3 }), ME).className, 'bg-amber-500');
  assert.equal(threadDot(t('a', { last_sender_id: ME }), ME).className, 'bg-emerald-500');
  assert.equal(threadDot(t('a', { last_message: null }), ME).className, 'bg-neutral-400');
});
