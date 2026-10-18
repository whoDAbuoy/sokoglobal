// Run: npx tsx --test lib/chat.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_MESSAGE_LENGTH, formatChatTime, mergeMessages, pickChannelName, validateMessage, type ChatMessage } from './chat.ts';

const msg = (id: string, created_at: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id, thread_id: 't1', sender_id: 'u1', content: `m ${id}`, created_at, read_at: null, ...extra,
});

test('validateMessage trims and accepts normal text', () => {
  assert.deepEqual(validateMessage('  hello\n'), { ok: true, content: 'hello' });
  assert.deepEqual(validateMessage('line 1\nline 2'), { ok: true, content: 'line 1\nline 2' });
});

test('validateMessage rejects empty and whitespace-only text', () => {
  assert.equal(validateMessage('').ok, false);
  assert.equal(validateMessage('   \n\t ').ok, false);
  assert.equal(validateMessage(undefined).ok, false);
});

test('validateMessage enforces the 4000 character limit after trimming', () => {
  assert.equal(MAX_MESSAGE_LENGTH, 4000);
  assert.equal(validateMessage('a'.repeat(4000)).ok, true);
  assert.equal(validateMessage(`  ${'a'.repeat(4000)}  `).ok, true);
  const tooLong = validateMessage('a'.repeat(4001));
  assert.equal(tooLong.ok, false);
  if (!tooLong.ok) assert.match(tooLong.error, /4,000/);
});

test('mergeMessages de-duplicates by id (insert response + realtime echo)', () => {
  const a = msg('a', '2026-10-18T10:00:00Z');
  const b = msg('b', '2026-10-18T10:01:00Z');
  const merged = mergeMessages([a, b], [{ ...b }]);
  assert.deepEqual(merged.map((m) => m.id), ['a', 'b']);
});

test('mergeMessages sorts by created_at, ties broken by id', () => {
  const merged = mergeMessages(
    [msg('c', '2026-10-18T10:02:00Z'), msg('a', '2026-10-18T10:00:00Z')],
    [msg('b2', '2026-10-18T10:01:00Z'), msg('b1', '2026-10-18T10:01:00Z')],
  );
  assert.deepEqual(merged.map((m) => m.id), ['a', 'b1', 'b2', 'c']);
});

test('mergeMessages lets later copies win but never clears read_at', () => {
  const read = msg('a', '2026-10-18T10:00:00Z', { read_at: '2026-10-18T10:05:00Z' });
  assert.equal(mergeMessages([msg('a', '2026-10-18T10:00:00Z')], [read])[0].read_at, read.read_at);
  assert.equal(mergeMessages([read], [msg('a', '2026-10-18T10:00:00Z')])[0].read_at, read.read_at);
});

test('mergeMessages does not mutate its inputs', () => {
  const existing = [msg('b', '2026-10-18T10:01:00Z'), msg('a', '2026-10-18T10:00:00Z')];
  mergeMessages(existing, []);
  assert.deepEqual(existing.map((m) => m.id), ['b', 'a']);
});

// Local-time dates so the tests are timezone independent.
const now = new Date(2026, 9, 18, 16, 30); // Sun 18 Oct 2026, 16:30

test('formatChatTime: today shows the 24h time', () => {
  assert.equal(formatChatTime(new Date(2026, 9, 18, 14, 5).toISOString(), now), '14:05');
  assert.equal(formatChatTime(new Date(2026, 9, 18, 0, 1).toISOString(), now), '00:01');
});

test('formatChatTime: the last 6 days show the weekday', () => {
  assert.equal(formatChatTime(new Date(2026, 9, 17, 23, 59).toISOString(), now), 'Sat');
  assert.equal(formatChatTime(new Date(2026, 9, 12, 9, 0).toISOString(), now), 'Mon');
});

test('formatChatTime: older dates show day and month, plus year if different', () => {
  assert.equal(formatChatTime(new Date(2026, 9, 11, 9, 0).toISOString(), now), '11 Oct');
  assert.equal(formatChatTime(new Date(2026, 0, 2, 9, 0).toISOString(), now), '2 Jan');
  assert.equal(formatChatTime(new Date(2025, 9, 12, 9, 0).toISOString(), now), '12 Oct 2025');
});

test('formatChatTime: empty or invalid input gives an empty string', () => {
  assert.equal(formatChatTime(null, now), '');
  assert.equal(formatChatTime('not a date', now), '');
});

test('pickChannelName keeps the base name unless that topic is taken', () => {
  assert.equal(pickChannelName('messages', []), 'messages');
  assert.equal(pickChannelName('messages', ['realtime:messages:inbox']), 'messages');
  assert.equal(pickChannelName('messages', ['realtime:messages']), 'messages#2');
  assert.equal(pickChannelName('messages', ['realtime:messages', 'realtime:messages#2']), 'messages#3');
});
