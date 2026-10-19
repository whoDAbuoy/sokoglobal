/**
 * Pure maths for the dot-matrix globe (no DOM). Unit vectors use a y-up frame:
 * x = east at lon 0, y = north pole, z = towards the viewer at lon 0 / lat 0.
 */
import { LAND_COLS, LAND_MASK_B64, LAND_ROWS, LAND_STEP_DEG } from './land';

export type Vec3 = [number, number, number];
const RAD = Math.PI / 180;

/** Decode the base64 bit-packed mask (MSB first, row-major). Works in Node and browsers. */
export function decodeMask(b64: string, rows: number, cols: number): Uint8Array {
  const bin = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
  const out = new Uint8Array(rows * cols);
  for (let i = 0; i < out.length; i++) {
    const byte = bin.charCodeAt(i >> 3);
    out[i] = (byte >> (7 - (i & 7))) & 1;
  }
  return out;
}

let cachedMask: Uint8Array | null = null;
const mask = () => (cachedMask ??= decodeMask(LAND_MASK_B64, LAND_ROWS, LAND_COLS));

/** Is (lat, lon) land in the low-res mask? */
export function isLand(lat: number, lon: number): boolean {
  const row = Math.floor((90 - lat) / LAND_STEP_DEG);
  const col = Math.floor((((lon + 180) % 360) + 360) % 360 / LAND_STEP_DEG);
  if (row < 0 || row >= LAND_ROWS) return false;
  return mask()[row * LAND_COLS + col] === 1;
}

export function toVec(lat: number, lon: number, radius = 1): Vec3 {
  const la = lat * RAD, lo = lon * RAD;
  return [radius * Math.cos(la) * Math.sin(lo), radius * Math.sin(la), radius * Math.cos(la) * Math.cos(lo)];
}

/**
 * Evenly spaced land dots: one row per mask row, with the number of dots per
 * row scaled by cos(latitude) so density is even on the sphere.
 */
export function landDots(): Vec3[] {
  const dots: Vec3[] = [];
  for (let r = 0; r < LAND_ROWS; r++) {
    const lat = 90 - LAND_STEP_DEG / 2 - r * LAND_STEP_DEG;
    const n = Math.max(1, Math.round(LAND_COLS * Math.cos(lat * RAD)));
    for (let j = 0; j < n; j++) {
      const lon = -180 + ((j + 0.5) * 360) / n;
      if (isLand(lat, lon)) dots.push(toVec(lat, lon));
    }
  }
  return dots;
}

/** Rotate by yaw (around the poles) then pitch (tilt towards the viewer). Angles in radians. */
export function rotate([x, y, z]: Vec3, yaw: number, pitch: number): Vec3 {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const x1 = x * cy - z * sy;
  const z1 = x * sy + z * cy;
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  return [x1, y * cp - z1 * sp, y * sp + z1 * cp];
}

/** Yaw/pitch that bring (lat, lon) to the centre of the view. */
export function facing(lat: number, lon: number): { yaw: number; pitch: number } {
  return { yaw: lon * RAD, pitch: lat * RAD };
}

/** A point is drawn if it faces the viewer, or (for raised arc points) lies outside the globe's disc. */
export function isVisible([x, y, z]: Vec3): boolean {
  return z > 0 || x * x + y * y > 1;
}

/** Points along the great circle from a to b, raised into an arc (peak height scales with distance). */
export function arcPoints(a: Vec3, b: Vec3, segments = 48, lift = 0.32): Vec3[] {
  const dot = Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const omega = Math.acos(dot);
  const s = Math.sin(omega);
  const pts: Vec3[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const wa = s < 1e-6 ? 1 - t : Math.sin((1 - t) * omega) / s;
    const wb = s < 1e-6 ? t : Math.sin(t * omega) / s;
    const h = 1 + lift * (omega / Math.PI) * Math.sin(Math.PI * t);
    pts.push([(a[0] * wa + b[0] * wb) * h, (a[1] * wa + b[1] * wb) * h, (a[2] * wa + b[2] * wb) * h]);
  }
  return pts;
}

export interface Hub { id: string; label: string; lat: number; lon: number }

/** Trading hubs and the corridors drawn between them. */
export const HUBS: Hub[] = [
  { id: 'nbo', label: 'Nairobi', lat: -1.29, lon: 36.82 },
  { id: 'los', label: 'Lagos', lat: 6.52, lon: 3.38 },
  { id: 'jnb', label: 'Johannesburg', lat: -26.2, lon: 28.05 },
  { id: 'sha', label: 'Shanghai', lat: 31.23, lon: 121.47 },
  { id: 'lon', label: 'London', lat: 51.51, lon: -0.13 },
  { id: 'dxb', label: 'Dubai', lat: 25.2, lon: 55.27 },
  { id: 'nyc', label: 'New York', lat: 40.71, lon: -74.0 },
];
export const ROUTES: [string, string][] = [
  ['sha', 'nbo'], ['lon', 'nbo'], ['lon', 'los'], ['nyc', 'los'], ['dxb', 'nbo'], ['sha', 'jnb'], ['dxb', 'los'],
];
