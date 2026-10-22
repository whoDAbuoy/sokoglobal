// Run: npx tsx --conditions=react-server --test lib/chat-media.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ATTACH_ACCEPT, MAX_ATTACHMENT_BYTES, attachmentPath, baseMime, classifyFile, computeWaveform, extForAudio, formatBytes,
  formatDuration, pickRecorderMime, safeFileName, signatureMatches, sniffMime,
} from './chat-media.ts';
import { insertAtCursor } from './emoji.ts';

test('classifyFile: type from extension, cross-checked with the browser MIME and the 50 MB cap', () => {
  assert.deepEqual(classifyFile({ name: 'Packing List.PDF', type: 'application/pdf', size: 1000 }), { ok: true, type: 'document', mime: 'application/pdf', ext: 'pdf' });
  assert.deepEqual(classifyFile({ name: 'shelf.jpg', type: 'image/jpeg', size: 10 }), { ok: true, type: 'image', mime: 'image/jpeg', ext: 'jpg' });
  assert.equal(classifyFile({ name: 'clip.webm', type: '', size: 10 }).ok, true);                       // some browsers send no type
  assert.equal(classifyFile({ name: 'sheet.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 5 }).ok, true);
  assert.equal(classifyFile({ name: 'evil.exe', type: 'application/x-msdownload', size: 5 }).ok, false);
  assert.equal(classifyFile({ name: 'anim.gif', type: 'image/gif', size: 5 }).ok, false);
  assert.equal(classifyFile({ name: 'fake.pdf', type: 'text/html', size: 5 }).ok, false);              // renamed file
  assert.equal(classifyFile({ name: 'empty.png', type: 'image/png', size: 0 }).ok, false);
  const big = classifyFile({ name: 'big.mp4', type: 'video/mp4', size: MAX_ATTACHMENT_BYTES + 1 });
  assert.equal(big.ok, false);
  if (!big.ok) assert.match(big.error, /50 MB/);
  assert.ok(ATTACH_ACCEPT.includes('.docx') && ATTACH_ACCEPT.includes('image/webp') && !ATTACH_ACCEPT.includes('audio/'));
});

test('sniffMime + signatureMatches: real file headers, not names', () => {
  const b = (...xs: (number | string)[]) => Uint8Array.from(xs.flatMap((x) => (typeof x === 'string' ? [...x].map((c) => c.charCodeAt(0)) : [x])));
  assert.equal(sniffMime(b(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a)), 'image/png');
  assert.equal(sniffMime(b(0xff, 0xd8, 0xff, 0xe0)), 'image/jpeg');
  assert.equal(sniffMime(b('RIFF', 0, 0, 0, 0, 'WEBP')), 'image/webp');
  assert.equal(sniffMime(b('%PDF-1.7')), 'application/pdf');
  assert.equal(sniffMime(b(0x1a, 0x45, 0xdf, 0xa3)), 'webm');
  assert.equal(sniffMime(b(0, 0, 0, 0x20, 'ftypisom')), 'mp4');
  assert.equal(sniffMime(b('<html>')), null);
  assert.equal(signatureMatches('application/vnd.openxmlformats-officedocument.wordprocessingml.document', sniffMime(b(0x50, 0x4b, 0x03, 0x04))), true);
  assert.equal(signatureMatches('application/pdf', sniffMime(b(0x50, 0x4b, 0x03, 0x04))), false);
  assert.equal(signatureMatches('audio/webm;codecs=opus', 'webm'), true);
  assert.equal(signatureMatches('image/png', null), false);
});

test('safe names and the "<order>/<sender>/<file>" path the database requires', () => {
  assert.equal(safeFileName('Pro-forma invoice (v2) — Ünïcode.PDF'), 'Pro-forma-invoice-v2-Unicode.pdf');
  assert.equal(safeFileName('../../etc/passwd'), 'etc-passwd.bin');
  assert.equal(safeFileName('...'), 'file.bin');
  assert.ok(safeFileName(`${'a'.repeat(400)}.png`).length <= 150);
  const p = attachmentPath('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'My photo.jpg', 'k3j2-91x!');
  assert.equal(p, '11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/k3j291x-My-photo.jpg');
  assert.match(p.split('/')[2], /^[A-Za-z0-9][A-Za-z0-9._-]{0,150}$/);   // same regex as chat_message_media_guard()
});

test('formatting helpers', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(48 * 1024 * 1024), '48 MB');
  assert.equal(formatDuration(0), '0:00');
  assert.equal(formatDuration(75.4), '1:15');
  assert.equal(formatDuration(3725), '1:02:05');
  assert.equal(formatDuration(Number.NaN), '0:00');
  assert.equal(baseMime('Audio/WebM; codecs=opus'), 'audio/webm');
});

test('waveform peaks are 0–100 integers scaled to the loudest bar; silence stays flat', () => {
  const samples = Float32Array.from({ length: 4800 }, (_, i) => (i < 2400 ? 0.1 : 0.5) * Math.sin(i));
  const w = computeWaveform(samples, 48);
  assert.equal(w.length, 48);
  assert.ok(w.every((v) => Number.isInteger(v) && v >= 0 && v <= 100));
  assert.equal(Math.max(...w), 100);
  assert.ok(w[0] < w[47]);
  assert.deepEqual(computeWaveform(new Float32Array(100), 4), [0, 0, 0, 0]);
  assert.deepEqual(computeWaveform([], 3), [0, 0, 0]);
});

test('recorder format: WebM/Opus first, Safari falls back to MP4', () => {
  assert.equal(pickRecorderMime((m) => m.startsWith('audio/webm')), 'audio/webm;codecs=opus');
  assert.equal(pickRecorderMime((m) => m === 'audio/mp4'), 'audio/mp4');
  assert.equal(pickRecorderMime(() => false), null);
  assert.equal(extForAudio('audio/mp4'), 'm4a');
  assert.equal(extForAudio('audio/webm;codecs=opus'), 'webm');
});

test('emoji insertion replaces the selection and moves the caret after the emoji', () => {
  assert.deepEqual(insertAtCursor('Hi there', 2, 2, ' 👋'), { text: 'Hi 👋 there', caret: 2 + ' 👋'.length });
  assert.deepEqual(insertAtCursor('Hello world', 6, 11, '🌍'), { text: 'Hello 🌍', caret: 6 + '🌍'.length });
  assert.deepEqual(insertAtCursor('abc', null, null, '✅'), { text: 'abc✅', caret: 3 + '✅'.length });
  assert.deepEqual(insertAtCursor('abc', 99, -5, '!'), { text: 'abc!', caret: 4 });
});
