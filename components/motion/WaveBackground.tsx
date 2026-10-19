'use client';

import { useCallback, useEffect, useRef } from 'react';
import clsx from 'clsx';
import { useLowPowerScreen, useMotionLoop, useReducedMotion } from './useMotionLoop';

/** Ribbon definitions: amplitude/frequency/speed per wave, as fractions of the canvas size. */
const RIBBONS = [
  { amp: 0.09, freq: 1.3, speed: 0.11, thick: 0.13, phase: 0.0, hue: 'blue' },
  { amp: 0.12, freq: 0.9, speed: -0.08, thick: 0.10, phase: 1.7, hue: 'cyan' },
  { amp: 0.07, freq: 1.8, speed: 0.14, thick: 0.08, phase: 3.1, hue: 'indigo' },
  { amp: 0.10, freq: 1.1, speed: -0.12, thick: 0.06, phase: 4.4, hue: 'cyan' },
] as const;

const STOPS = {
  blue: ['rgba(59,130,246,0)', 'rgba(59,130,246,0.85)', 'rgba(6,182,212,0.75)', 'rgba(59,130,246,0)'],
  cyan: ['rgba(6,182,212,0)', 'rgba(6,182,212,0.8)', 'rgba(59,130,246,0.7)', 'rgba(6,182,212,0)'],
  indigo: ['rgba(99,102,241,0)', 'rgba(99,102,241,0.75)', 'rgba(59,130,246,0.65)', 'rgba(99,102,241,0)'],
} as const;

/**
 * Two-tone liquid wave wallpaper (electric blue / cyan / indigo). Drawn on two
 * small canvases — a heavily blurred glow and a lightly blurred filament layer —
 * so it stays cheap. Decorative only (aria-hidden); pauses off-screen and in
 * background tabs, and renders a still frame for prefers-reduced-motion.
 *
 * Place inside a `relative` container; it fills it.
 */
export default function WaveBackground({ className, band = 0.55, intensity = 1, speed = 1, maxFps, fade = true }: {
  /** Vertical centre of the wave band, 0 (top) – 1 (bottom). */
  band?: number;
  /** Overall opacity multiplier (0–1). */
  intensity?: number;
  speed?: number;
  /** Optional frame-rate cap. */
  maxFps?: number;
  /** Fade the band out towards the top and bottom edges. */
  fade?: boolean;
  className?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLCanvasElement>(null);
  const lineRef = useRef<HTMLCanvasElement>(null);
  const size = useRef({ w: 0, h: 0 });
  const lastMs = useRef(4000);
  const drawRef = useRef<((ms: number) => void) | null>(null);
  const reduced = useReducedMotion();
  const lowPower = useLowPowerScreen();

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const resize = () => {
      const r = wrap.getBoundingClientRect();
      // Low internal resolution: the layers are blurred anyway.
      const w = Math.max(1, Math.round(r.width / 2));
      const h = Math.max(1, Math.round(r.height / 2));
      size.current = { w, h };
      for (const c of [glowRef.current, lineRef.current]) if (c) { c.width = w; c.height = h; }
      drawRef.current?.(lastMs.current); // resizing clears the canvas; repaint (matters when paused)
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  const draw = useCallback((ms: number) => {
    const glow = glowRef.current?.getContext('2d');
    const line = lineRef.current?.getContext('2d');
    const { w, h } = size.current;
    if (!glow || !line || w < 2) return;
    lastMs.current = ms;
    const t = (ms / 1000) * speed;
    const dark = !!wrapRef.current?.closest('.dark');
    glow.clearRect(0, 0, w, h);
    line.clearRect(0, 0, w, h);
    glow.globalCompositeOperation = dark ? 'lighter' : 'source-over';
    line.globalCompositeOperation = dark ? 'lighter' : 'source-over';
    const step = Math.max(4, Math.round(w / 90));
    const cy = h * band;

    RIBBONS.forEach((r, k) => {
      const centre = (x: number) => {
        const u = (x / w) * Math.PI * 2;
        return cy + h * r.amp * Math.sin(u * r.freq + t * r.speed * 6 + r.phase)
          + h * r.amp * 0.45 * Math.sin(u * r.freq * 2.3 - t * r.speed * 4 + r.phase * 1.3);
      };
      const thick = (x: number) => {
        const u = (x / w) * Math.PI * 2;
        return h * r.thick * (0.25 + 0.75 * (0.5 + 0.5 * Math.sin(u * 1.4 + t * 0.5 + k * 1.9)));
      };
      const grad = glow.createLinearGradient(0, 0, w, 0);
      const stops = STOPS[r.hue];
      const drift = 0.5 + 0.12 * Math.sin(t * 0.3 + k);
      grad.addColorStop(0, stops[0]);
      grad.addColorStop(Math.max(0.05, drift - 0.3), stops[1]);
      grad.addColorStop(Math.min(0.95, drift + 0.25), stops[2]);
      grad.addColorStop(1, stops[3]);

      glow.globalAlpha = (dark ? 0.55 : 0.28) * intensity;
      glow.fillStyle = grad;
      glow.beginPath();
      for (let x = 0; x <= w + step; x += step) glow.lineTo(x, centre(x) - thick(x) / 2);
      for (let x = w + step; x >= -step; x -= step) glow.lineTo(x, centre(x) + thick(x) / 2);
      glow.closePath();
      glow.fill();

      line.globalAlpha = (dark ? 0.7 : 0.35) * intensity;
      line.strokeStyle = grad;
      line.lineWidth = 1;
      for (const off of [-0.35, 0, 0.3]) {
        line.beginPath();
        for (let x = 0; x <= w + step; x += step) line.lineTo(x, centre(x) + thick(x) * off);
        line.stroke();
      }
    });
  }, [band, intensity, speed]);
  drawRef.current = draw;

  useMotionLoop(wrapRef, draw, reduced, Math.min(maxFps ?? 60, lowPower ? 30 : 60));

  return (
    <div ref={wrapRef} aria-hidden className={clsx('pointer-events-none absolute inset-0 overflow-hidden', className)}
      style={fade ? { maskImage: 'linear-gradient(to bottom, transparent, black 18%, black 82%, transparent)', WebkitMaskImage: 'linear-gradient(to bottom, transparent, black 18%, black 82%, transparent)' } : undefined}>
      <canvas ref={glowRef} className="absolute inset-0 h-full w-full blur-2xl" />
      <canvas ref={lineRef} className="absolute inset-0 h-full w-full blur-[1.5px]" />
    </div>
  );
}
