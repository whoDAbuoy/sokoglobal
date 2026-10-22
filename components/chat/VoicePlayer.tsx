'use client';

import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Loader2, Pause, Play } from 'lucide-react';
import { formatDuration } from '@/lib/chat-media';

/**
 * Voice-note player: play/pause, a scrubber over the waveform, and elapsed / total time.
 * Recorded WebM often reports an infinite duration until fully read, so the
 * duration measured while recording (metadata) is used until the browser knows better.
 */
export default function VoicePlayer({ src, durationSeconds, waveform, mine }: {
  src: string | null; durationSeconds?: number; waveform?: number[]; mine?: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(durationSeconds ?? 0);
  const bars = waveform?.length ? waveform : Array.from({ length: 32 }, () => 30);
  const progress = duration > 0 ? Math.min(1, current / duration) : 0;

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => setCurrent(a.currentTime);
    const onMeta = () => { if (Number.isFinite(a.duration) && a.duration > 0) setDuration(a.duration); };
    const onEnd = () => { setPlaying(false); setCurrent(0); };
    const onPause = () => setPlaying(false);
    const onPlay = () => setPlaying(true);
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('loadedmetadata', onMeta);
    a.addEventListener('durationchange', onMeta);
    a.addEventListener('ended', onEnd);
    a.addEventListener('pause', onPause);
    a.addEventListener('play', onPlay);
    return () => {
      a.removeEventListener('timeupdate', onTime); a.removeEventListener('loadedmetadata', onMeta); a.removeEventListener('durationchange', onMeta);
      a.removeEventListener('ended', onEnd); a.removeEventListener('pause', onPause); a.removeEventListener('play', onPlay);
    };
  }, [src]);

  function toggle() {
    const a = audioRef.current;
    if (!a || !src) return;
    if (a.paused) void a.play().catch(() => setPlaying(false)); else a.pause();
  }

  function seek(value: number) {
    const a = audioRef.current;
    if (!a || !duration) return;
    a.currentTime = value;
    setCurrent(value);
  }

  return (
    <div className="flex w-64 max-w-full items-center gap-3">
      <button type="button" onClick={toggle} disabled={!src} aria-label={playing ? 'Pause voice note' : 'Play voice note'}
        className={clsx('grid h-9 w-9 shrink-0 place-items-center rounded-full transition-colors disabled:opacity-60',
          mine ? 'bg-white/20 text-white hover:bg-white/30' : 'bg-neutral-900 text-white hover:bg-neutral-700 dark:bg-neutral-800')}>
        {!src ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : playing ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="ml-0.5 h-4 w-4" aria-hidden />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="relative h-8">
          <div className="absolute inset-0 flex items-center gap-[2px]" aria-hidden>
            {bars.map((v, i) => (
              <span key={i} className={clsx('flex-1 rounded-full', (i + 0.5) / bars.length <= progress
                ? (mine ? 'bg-white' : 'bg-blue-600 dark:bg-cyan-400')
                : (mine ? 'bg-white/40' : 'bg-neutral-300'))}
                style={{ height: `${Math.max(12, v)}%` }} />
            ))}
          </div>
          <input type="range" min={0} max={duration || 0} step={0.1} value={Math.min(current, duration || 0)}
            onChange={(e) => seek(Number(e.target.value))} disabled={!src || !duration}
            aria-label="Seek" aria-valuetext={`${formatDuration(current)} of ${formatDuration(duration)}`}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-default" />
        </div>
        <p className={clsx('mt-0.5 text-[11px] tabular-nums', mine ? 'text-white/80' : 'text-neutral-500')}>
          {playing || current > 0 ? `${formatDuration(current)} / ` : ''}{formatDuration(duration)}
        </p>
      </div>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- a voice note has no caption track */}
      {src && <audio ref={audioRef} src={src} preload="metadata" className="hidden" />}
    </div>
  );
}
