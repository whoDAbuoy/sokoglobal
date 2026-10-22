'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Loader2, Mic, Pause, Play, Send, Trash2 } from 'lucide-react';
import { MAX_VOICE_SECONDS, WAVEFORM_BARS, computeWaveform, formatDuration, pickRecorderMime } from '@/lib/chat-media';

export interface VoiceClip { blob: Blob; mimeType: string; durationSeconds: number; waveform: number[] }

const LIVE_BARS = 32;

/**
 * Inline voice-note recorder (MediaRecorder): record, pause / resume, cancel,
 * or send. Shows the running time (paused time excluded) and a live waveform;
 * stops on its own at MAX_VOICE_SECONDS. `onRecordingChange` lets the composer
 * hide the text box while recording.
 */
export default function VoiceRecorder({ onSend, onRecordingChange, disabled }: {
  onSend: (clip: VoiceClip) => Promise<void>;
  onRecordingChange?: (recording: boolean) => void;
  disabled?: boolean;
}) {
  const [state, setState] = useState<'idle' | 'starting' | 'recording' | 'paused' | 'sending'>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [live, setLive] = useState<number[]>(() => Array(LIVE_BARS).fill(0));
  const [error, setError] = useState<string | null>(null);

  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const chunks = useRef<Blob[]>([]);
  const levels = useRef<number[]>([]);
  const raf = useRef(0);
  const clock = useRef({ startedAt: 0, banked: 0 });
  const finish = useRef<'send' | 'cancel'>('cancel');

  const seconds = () => (clock.current.banked + (clock.current.startedAt ? performance.now() - clock.current.startedAt : 0)) / 1000;

  const teardown = useCallback(() => {
    cancelAnimationFrame(raf.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    void audioCtx.current?.close().catch(() => undefined);
    audioCtx.current = null;
    recorder.current = null;
  }, []);

  // Leaving the page mid-recording discards it and releases the microphone.
  useEffect(() => () => {
    finish.current = 'cancel';
    if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop();
    teardown();
  }, [teardown]);
  useEffect(() => { onRecordingChange?.(state !== 'idle'); }, [state, onRecordingChange]);

  async function start() {
    setError(null);
    const mime = typeof MediaRecorder === 'undefined' ? null : pickRecorderMime((m) => MediaRecorder.isTypeSupported(m));
    if (!mime || !navigator.mediaDevices?.getUserMedia) { setError('Voice notes are not supported in this browser.'); return; }
    setState('starting');
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      setState('idle');
      setError('Microphone access was blocked. Allow it in your browser settings to record voice notes.');
      return;
    }
    chunks.current = [];
    levels.current = [];
    const rec = new MediaRecorder(stream.current, { mimeType: mime, audioBitsPerSecond: 32_000 });
    rec.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
    rec.onstop = () => {
      const duration = Math.round(seconds() * 10) / 10;
      const blob = new Blob(chunks.current, { type: mime });
      const waveform = computeWaveform(levels.current, WAVEFORM_BARS);
      teardown();
      if (finish.current === 'send' && blob.size > 0) {
        setState('sending');
        void onSend({ blob, mimeType: mime, durationSeconds: duration, waveform })
          .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not send the voice note'))
          .finally(() => { setState('idle'); setElapsed(0); });
      } else {
        setState('idle');
        setElapsed(0);
      }
    };
    recorder.current = rec;

    // Live level meter: RMS of the time-domain signal each frame.
    const ctx = new AudioContext();
    audioCtx.current = ctx;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream.current).connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    const tick = () => {
      if (recorder.current?.state === 'recording') {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += ((v - 128) / 128) ** 2;
        const rms = Math.min(1, Math.sqrt(sum / buf.length) * 3);
        levels.current.push(rms);
        setLive((prev) => [...prev.slice(1), Math.round(rms * 100)]);
        const s = seconds();
        setElapsed(s);
        if (s >= MAX_VOICE_SECONDS) { stop('send'); return; }
      }
      raf.current = requestAnimationFrame(tick);
    };

    rec.start(250);
    clock.current = { startedAt: performance.now(), banked: 0 };
    setState('recording');
    raf.current = requestAnimationFrame(tick);
  }

  function togglePause() {
    const rec = recorder.current;
    if (!rec) return;
    if (rec.state === 'recording') {
      rec.pause();
      clock.current = { startedAt: 0, banked: clock.current.banked + performance.now() - clock.current.startedAt };
      setState('paused');
    } else if (rec.state === 'paused') {
      rec.resume();
      clock.current = { ...clock.current, startedAt: performance.now() };
      setState('recording');
    }
  }

  function stop(how: 'send' | 'cancel') {
    const rec = recorder.current;
    finish.current = how;
    if (rec && rec.state !== 'inactive') {
      if (rec.state === 'paused') rec.resume();   // some browsers drop the last chunk when stopping while paused
      rec.stop();
    } else { teardown(); setState('idle'); }
  }

  if (state === 'idle' || state === 'starting') {
    return (
      <div className="flex items-center">
        <button type="button" onClick={() => void start()} disabled={disabled || state === 'starting'} aria-label="Record a voice note"
          className="grid h-9 w-9 place-items-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-50">
          {state === 'starting' ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <Mic className="h-5 w-5" aria-hidden />}
        </button>
        {error && <span role="alert" className="ml-1 max-w-[16rem] text-xs text-red-600">{error}</span>}
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-neutral-200 bg-neutral-50 py-1 pl-3 pr-1" role="group" aria-label="Voice note recorder">
      <span className={clsx('h-2.5 w-2.5 shrink-0 rounded-full', state === 'recording' ? 'animate-pulse bg-red-500' : 'bg-neutral-400')} aria-hidden />
      <span className="w-12 shrink-0 text-sm tabular-nums text-neutral-900" aria-live="off">{formatDuration(elapsed)}</span>
      <span className="sr-only" aria-live="polite">{state === 'paused' ? 'Recording paused' : state === 'sending' ? 'Sending voice note' : 'Recording'}</span>
      <div className="flex h-7 min-w-0 flex-1 items-center gap-[2px]" aria-hidden>
        {live.map((v, i) => <span key={i} className="flex-1 rounded-full bg-red-500/70" style={{ height: `${Math.max(8, v)}%` }} />)}
      </div>
      <button type="button" onClick={() => stop('cancel')} disabled={state === 'sending'} aria-label="Discard voice note"
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-neutral-500 hover:bg-neutral-200 hover:text-red-700">
        <Trash2 className="h-4 w-4" aria-hidden />
      </button>
      <button type="button" onClick={togglePause} disabled={state === 'sending'} aria-label={state === 'paused' ? 'Resume recording' : 'Pause recording'}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-neutral-600 hover:bg-neutral-200">
        {state === 'paused' ? <Play className="h-4 w-4" aria-hidden /> : <Pause className="h-4 w-4" aria-hidden />}
      </button>
      <button type="button" onClick={() => stop('send')} disabled={state === 'sending'} aria-label="Send voice note"
        className="btn-primary h-8 shrink-0 rounded-full px-3">
        {state === 'sending' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
      </button>
    </div>
  );
}
