// Run: npx tsx --conditions=react-server --test lib/resumable-upload.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHUNK_BYTES, RESUMABLE_THRESHOLD, encodeMetadata, nextChunk, retryDelayMs } from './resumable-upload.ts';

test('chunks are 6 MB (Supabase requirement) and the last one is short', () => {
  assert.equal(CHUNK_BYTES, 6 * 1024 * 1024);
  assert.equal(RESUMABLE_THRESHOLD, CHUNK_BYTES);
  const size = 15 * 1024 * 1024;
  assert.deepEqual(nextChunk(0, size), { start: 0, end: CHUNK_BYTES });
  assert.deepEqual(nextChunk(2 * CHUNK_BYTES, size), { start: 2 * CHUNK_BYTES, end: size });
});

test('TUS metadata is base64 per value and UTF-8 safe', () => {
  const meta = encodeMetadata({ bucketName: 'product-media', objectName: 'u/p/vidéo.mp4' });
  const [bucket, object] = meta.split(',');
  assert.equal(bucket, `bucketName ${Buffer.from('product-media').toString('base64')}`);
  assert.equal(Buffer.from(object.split(' ')[1], 'base64').toString('utf8'), 'u/p/vidéo.mp4');
});

test('retry backoff doubles and caps at 20 s', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 9].map(retryDelayMs), [1000, 2000, 4000, 8000, 16000, 20000, 20000]);
});
