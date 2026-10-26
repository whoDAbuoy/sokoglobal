'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import clsx from 'clsx';
import { arcPoints, facing, HUBS, isVisible, landDots, rotate, ROUTES, toVec, type Vec3 } from '@/lib/geo/globe-math';
import { useLowPowerScreen, useMotionLoop, useReducedMotion } from './useMotionLoop';
import type { MotionPalette } from './WaveBackground';

const AUTO_SPIN = 0.00012; // rad per ms
const DRAG_SPEED = 0.006;  // rad per px
const KEY_STEP = 0.12;
const MAX_PITCH = 1.1;

/** Shader colours per palette: electric blue (default) or the Sellsy mint / teal over #050505. */
const COLORS = {
  electric: {
    halo: ['rgba(59,130,246,0.35)', 'rgba(6,182,212,0.10)', 'rgba(59,130,246,0)'], body: ['#13213a', '#070b13'], rim: 'rgba(96,165,250,0.45)',
    land: '#cbd5e1', arc: 'rgba(96,165,250,0.28)', pulse: ['rgba(34,211,238,0.95)', 'rgba(96,165,250,0.95)'], ring: '34,211,238', hub: '#60a5fa',
  },
  mint: {
    halo: ['rgba(90,152,149,0.38)', 'rgba(20,184,166,0.10)', 'rgba(90,152,149,0)'], body: ['#122321', '#050707'], rim: 'rgba(143,211,204,0.4)',
    land: '#d4d4d4', arc: 'rgba(143,211,204,0.26)', pulse: ['rgba(143,211,204,0.95)', 'rgba(20,184,166,0.95)'], ring: '143,211,204', hub: '#5a9895',
  },
} as const;

/**
 * Interactive dot-matrix globe with animated trade corridors between hubs
 * (Shanghai ⇄ Nairobi ⇄ London …). Canvas 2D (no WebGL), drawn only on the
 * client. Drag or use the arrow keys to rotate; spins slowly on its own unless
 * the user prefers reduced motion. Pauses off-screen.
 */
export default function Globe({ className, focus = { lat: 12, lon: 30 }, labels = true, interactive = true, maxFps, palette = 'electric' }: {
  className?: string;
  /** Initial point of view. */
  focus?: { lat: number; lon: number };
  labels?: boolean;
  /** false = purely decorative (ambient backdrop): no focus stop, no pointer handling, hidden from screen readers. */
  interactive?: boolean;
  /** Optional frame-rate cap (the ambient backdrop runs slower to keep blurred glass above it cheap). */
  maxFps?: number;
  palette?: MotionPalette;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const view = useRef({ ...facing(focus.lat, focus.lon), vYaw: 0, dragging: false, lastX: 0, lastY: 0, lastT: 0, lastMs: 0 });
  const size = useRef({ w: 0, h: 0, dpr: 1 });
  const drawRef = useRef<((ms: number) => void) | null>(null);
  const reduced = useReducedMotion();
  const lowPower = useLowPowerScreen();
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;

  const dots = useMemo(() => landDots(), []);
  const hubs = useMemo(() => HUBS.map((h) => ({ ...h, v: toVec(h.lat, h.lon) })), []);
  const arcs = useMemo(() => ROUTES.map(([a, b], i) => {
    const from = hubs.find((h) => h.id === a)!, to = hubs.find((h) => h.id === b)!;
    return { pts: arcPoints(from.v, to.v, 64), offset: i * 0.37 };
  }), [hubs]);

  useEffect(() => {
    const wrap = wrapRef.current, canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const resize = () => {
      const r = wrap.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      size.current = { w: r.width, h: r.height, dpr };
      canvas.width = Math.max(1, Math.round(r.width * dpr));
      canvas.height = Math.max(1, Math.round(r.height * dpr));
      drawRef.current?.(view.current.lastMs);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  const draw = useCallback((ms: number) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const { w, h, dpr } = size.current;
    if (!canvas || !ctx || w < 2) return;
    const v = view.current;
    const dt = Math.min(64, ms - v.lastMs);
    v.lastMs = ms;
    if (!v.dragging && !reducedRef.current) {
      v.yaw += v.vYaw * dt - AUTO_SPIN * dt;
      v.vYaw *= 0.94; // drag inertia
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const R = Math.min(w, h) * 0.42;
    const cx = w / 2, cy = h / 2;
    const P = (p: Vec3) => rotate(p, v.yaw, v.pitch);
    const c = COLORS[palette];

    // Atmosphere glow + body
    const halo = ctx.createRadialGradient(cx, cy, R * 0.85, cx, cy, R * 1.35);
    halo.addColorStop(0, c.halo[0]);
    halo.addColorStop(0.45, c.halo[1]);
    halo.addColorStop(1, c.halo[2]);
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, w, h);
    const body = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.1, cx, cy, R);
    body.addColorStop(0, c.body[0]);
    body.addColorStop(1, c.body[1]);
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = c.rim;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Land dots (front hemisphere), fading towards the limb
    const dotR = Math.max(0.6, R / 260);
    for (const d of dots) {
      const [x, y, z] = P(d);
      if (z <= 0.02) continue;
      ctx.globalAlpha = 0.25 + 0.7 * z;
      ctx.fillStyle = c.land;
      ctx.fillRect(cx + x * R - dotR, cy - y * R - dotR, dotR * 2, dotR * 2);
    }
    ctx.globalAlpha = 1;

    // Corridors: a faint full arc plus a travelling bright pulse
    const t = reducedRef.current ? 0.6 : (ms / 4200);
    for (const arc of arcs) {
      const pts = arc.pts.map(P);
      ctx.lineWidth = 1;
      ctx.strokeStyle = c.arc;
      strokeVisible(ctx, pts, 0, pts.length - 1, cx, cy, R);
      const head = frac(t + arc.offset) * (pts.length - 1);
      const tail = Math.max(0, head - pts.length * 0.35);
      const grad = ctx.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, c.pulse[0]);
      grad.addColorStop(1, c.pulse[1]);
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.75;
      strokeVisible(ctx, pts, Math.floor(tail), Math.ceil(head), cx, cy, R);
    }

    // Hubs
    ctx.font = '500 11px var(--font-inter), system-ui, sans-serif';
    for (const hub of hubs) {
      const [x, y, z] = P(hub.v);
      if (z <= 0.05) continue;
      const sx = cx + x * R, sy = cy - y * R;
      const pulse = reducedRef.current ? 0.5 : frac(ms / 1600 + hub.lat / 37);
      ctx.beginPath();
      ctx.arc(sx, sy, 3 + pulse * 9, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${c.ring},${0.6 * (1 - pulse)})`;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(sx, sy, 3, 0, Math.PI * 2);
      ctx.fillStyle = c.hub;
      ctx.fill();
      if (labels && z > 0.25) {
        ctx.globalAlpha = Math.min(1, (z - 0.25) * 3);
        ctx.fillStyle = 'rgba(226,232,240,0.95)';
        ctx.fillText(hub.label, sx + 7, sy + 4);
        ctx.globalAlpha = 1;
      }
    }
  }, [arcs, dots, hubs, labels, palette]);
  drawRef.current = draw;

  useMotionLoop(wrapRef, draw, reduced, Math.min(maxFps ?? 60, lowPower ? 30 : 60));

  // When paused (reduced motion) interactions still need a repaint.
  const repaint = () => { if (reducedRef.current) drawRef.current?.(view.current.lastMs + 16); };

  const onPointerDown = (e: React.PointerEvent) => {
    const v = view.current;
    v.dragging = true; v.lastX = e.clientX; v.lastY = e.clientY; v.lastT = e.timeStamp; v.vYaw = 0;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const v = view.current;
    if (!v.dragging) return;
    const dx = e.clientX - v.lastX, dy = e.clientY - v.lastY;
    const dtm = Math.max(1, e.timeStamp - v.lastT);
    v.yaw -= dx * DRAG_SPEED;
    v.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, v.pitch + dy * DRAG_SPEED));
    v.vYaw = (-dx * DRAG_SPEED) / dtm;
    v.lastX = e.clientX; v.lastY = e.clientY; v.lastT = e.timeStamp;
    repaint();
  };
  const onPointerUp = (e: React.PointerEvent) => {
    view.current.dragging = false;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const v = view.current;
    if (e.key === 'ArrowLeft') v.yaw += KEY_STEP;
    else if (e.key === 'ArrowRight') v.yaw -= KEY_STEP;
    else if (e.key === 'ArrowUp') v.pitch = Math.max(-MAX_PITCH, v.pitch - KEY_STEP);
    else if (e.key === 'ArrowDown') v.pitch = Math.min(MAX_PITCH, v.pitch + KEY_STEP);
    else return;
    e.preventDefault();
    repaint();
  };

  const description = `Interactive globe showing SokoGlobal trade corridors: ${ROUTES.map(([a, b]) =>
    `${HUBS.find((x) => x.id === a)!.label} to ${HUBS.find((x) => x.id === b)!.label}`).join(', ')}. Use arrow keys to rotate.`;

  return (
    <div ref={wrapRef} className={clsx('relative', className)} aria-hidden={interactive ? undefined : true}>
      {!interactive ? <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" /> : <canvas ref={canvasRef} role="img" aria-label={description} tabIndex={0}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        className="absolute inset-0 h-full w-full cursor-grab touch-pan-y rounded-full outline-none active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-4 focus-visible:ring-offset-midnight" />}
    </div>
  );
}

const frac = (x: number) => ((x % 1) + 1) % 1;

/** Stroke the part of a polyline [from, to] that is not hidden behind the globe. */
function strokeVisible(ctx: CanvasRenderingContext2D, pts: Vec3[], from: number, to: number, cx: number, cy: number, R: number) {
  let open = false;
  ctx.beginPath();
  for (let i = Math.max(0, from); i <= Math.min(pts.length - 1, to); i++) {
    const p = pts[i]!;
    if (!isVisible(p)) { open = false; continue; }
    const x = cx + p[0] * R, y = cy - p[1] * R;
    if (open) ctx.lineTo(x, y); else { ctx.moveTo(x, y); open = true; }
  }
  ctx.stroke();
}
