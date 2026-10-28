// Run: npx tsx --test lib/file-signature.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentMatches, mimeFromPath, sniffFileType } from './file-signature.ts';

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)));

test('real files are recognised by their first bytes', () => {
  assert.equal(sniffFileType(bytes([0x89], 'PNG', [0x0d, 0x0a, 0x1a, 0x0a, 0, 0])), 'image/png');
  assert.equal(sniffFileType(bytes([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.equal(sniffFileType(bytes('RIFF', [1, 2, 3, 4], 'WEBPVP8 ')), 'image/webp');
  assert.equal(sniffFileType(bytes('%PDF-1.7\n')), 'application/pdf');
  assert.equal(sniffFileType(bytes([0xef, 0xbb, 0xbf], '%PDF-1.4')), 'application/pdf', 'a PDF header after a few bytes still counts');
  assert.equal(sniffFileType(bytes([0, 0, 0, 0x20], 'ftypisom')), 'video/mp4');
  assert.equal(sniffFileType(bytes([0, 0, 0, 0x14], 'ftypqt  ')), 'video/quicktime');
  assert.equal(sniffFileType(bytes([0x1a, 0x45, 0xdf, 0xa3])), 'video/webm');
});

test('text, HTML and SVG renamed to an image or PDF are rejected', () => {
  for (const fake of ['this is not a png really', '<!doctype html><script>', '<svg xmlns="http://www.w3.org/2000/svg">', '']) {
    assert.equal(sniffFileType(bytes(fake)), null, fake || '(empty)');
    assert.equal(contentMatches('image/png', bytes(fake)), false);
    assert.equal(contentMatches('application/pdf', bytes(fake)), false);
  }
});

test('the declared type must match the content', () => {
  const png = bytes([0x89], 'PNG', [0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(contentMatches('image/png', png), true);
  assert.equal(contentMatches('image/jpeg', png), false, 'a PNG labelled JPEG is a mismatch');
  assert.equal(contentMatches('video/quicktime', bytes([0, 0, 0, 0x20], 'ftypisom')), true, 'MP4 and MOV share a container');
});

test('types from stored paths', () => {
  assert.equal(mimeFromPath('u/verification/x.PDF'), 'application/pdf');
  assert.equal(mimeFromPath('u/p/x.jpg'), 'image/jpeg');
  assert.equal(mimeFromPath('u/p/x.html'), null);
});
