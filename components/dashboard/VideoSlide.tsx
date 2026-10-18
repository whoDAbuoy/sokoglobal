'use client';

import { useEffect, useRef, useState, type MouseEvent } from 'react';
import clsx from 'clsx';
import { Play, Video } from 'lucide-react';
import { parseVideoUrl } from '@/lib/video';

/**
 * One video slide in the swipe gallery. Shows the first frame (or a YouTube
 * thumbnail) with a "Video" badge and play button; plays inline on tap. HLS
 * uses native playback where available (Safari/iOS) and lazy-loads hls.js
 * otherwise. Pauses — and unloads embeds — when swiped away (`active` false).
 */
export default function VideoSlide({ url, poster, title, active, className }: {
  url: string;
  poster?: string | null;
  title: string;
  active: boolean;
  className?: string;
}) {
  const source = parseVideoUrl(url);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<{ destroy: () => void } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (active) return;
    videoRef.current?.pause();
    if (source?.kind === 'youtube' || source?.kind === 'vimeo') setPlaying(false);
  }, [active, source?.kind]);

  useEffect(() => () => hlsRef.current?.destroy(), []);

  async function play(e: MouseEvent) {
    e.stopPropagation();   // inside a clickable card: play here, don't open Quick View
    if (!source) return;
    setPlaying(true);
    const el = videoRef.current;
    if (source.kind === 'hls' && el && !el.canPlayType('application/vnd.apple.mpegurl') && !hlsRef.current) {
      const { default: Hls } = await import('hls.js');
      if (!Hls.isSupported()) { setFailed(true); return; }
      const hls = new Hls();
      hls.loadSource(source.src);
      hls.attachMedia(el);
      hlsRef.current = hls;
    }
    el?.play().catch(() => { /* user can press play on the native controls */ });
  }

  if (!source) return null;
  const embed = source.kind === 'youtube' || source.kind === 'vimeo';

  return (
    <div className={clsx('relative overflow-hidden bg-neutral-900', className)}>
      {embed ? (
        playing ? (
          <iframe src={source.embed} title={title} className="absolute inset-0 h-full w-full" loading="lazy"
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen />
        ) : source.kind === 'youtube' ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={poster ?? source.thumbnail} alt="" className="absolute inset-0 h-full w-full object-cover opacity-90" />
        ) : null
      ) : (
        <video ref={videoRef} playsInline preload="metadata" controls={playing} poster={poster ?? undefined}
          src={source.kind === 'file' ? `${source.src}#t=0.1` : source.src}
          onEnded={() => setPlaying(false)} onClick={(e) => e.stopPropagation()}
          className="absolute inset-0 h-full w-full object-cover" aria-label={title} />
      )}

      {!playing && (
        <>
          <span className="pill pointer-events-none absolute right-3 top-3 border-transparent bg-neutral-900/80 text-white">
            <Video className="h-3.5 w-3.5" /> Video
          </span>
          <button type="button" onClick={(e) => void play(e)} aria-label={`Play video: ${title}`}
            className="absolute left-1/2 top-1/2 grid h-14 w-14 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-neutral-900 shadow-overlay ring-1 ring-black/5 backdrop-blur transition hover:scale-105 hover:bg-white">
            <Play className="ml-0.5 h-6 w-6 fill-current" />
          </button>
        </>
      )}
      {failed && <p className="absolute inset-x-3 bottom-12 rounded bg-white/90 p-2 text-center text-xs text-neutral-700">This video can’t play in your browser.</p>}
    </div>
  );
}
