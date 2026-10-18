// Run: npx tsx --test lib/video.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVideoUrl } from './video.ts';

test('direct video files (incl. Supabase Storage URLs)', () => {
  const u = 'https://abc.supabase.co/storage/v1/object/public/product-media/s/p/clip.MP4';
  assert.deepEqual(parseVideoUrl(u), { kind: 'file', src: u });
  assert.equal(parseVideoUrl('https://cdn.example.com/a/b.webm')?.kind, 'file');
  assert.equal(parseVideoUrl('https://cdn.example.com/a/b.mov?token=1')?.kind, 'file');
});

test('HLS playlists', () => {
  assert.equal(parseVideoUrl('https://stream.example.com/v/master.m3u8')?.kind, 'hls');
});

test('YouTube links in all common shapes → nocookie embed', () => {
  for (const u of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://youtu.be/dQw4w9WgXcQ',
    'https://www.youtube.com/embed/dQw4w9WgXcQ', 'https://youtube.com/shorts/dQw4w9WgXcQ']) {
    const v = parseVideoUrl(u);
    assert.equal(v?.kind, 'youtube', u);
    assert.ok(v?.kind === 'youtube' && v.embed.startsWith('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'), u);
  }
});

test('Vimeo links → player embed', () => {
  const v = parseVideoUrl('https://vimeo.com/76979871');
  assert.ok(v?.kind === 'vimeo' && v.embed.startsWith('https://player.vimeo.com/video/76979871'));
});

test('rejects non-https, unknown hosts/types and malformed ids', () => {
  for (const u of ['http://cdn.example.com/a.mp4', 'javascript:alert(1)', 'not a url', 'https://example.com/page.html',
    'https://www.youtube.com/watch?v=short', 'https://vimeo.com/channels/staffpicks']) {
    assert.equal(parseVideoUrl(u), null, u);
  }
});
