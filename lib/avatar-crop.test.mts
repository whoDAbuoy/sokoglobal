// Run: npx tsx --conditions=react-server --test lib/avatar-crop.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_ZOOM, clampOffset, fillScale, fitScale, initialCrop, rotateCw, rotated, scaleBounds, scaleToSlider, sliderToScale, zoomTo,
} from './avatar-crop.ts';

const WIDE = { width: 2000, height: 1000 };
const V = 300;

test('fill covers the frame, fit shows the whole image', () => {
  assert.equal(fillScale(WIDE, V), 0.3);     // short side 1000 → 300
  assert.equal(fitScale(WIDE, V), 0.15);     // long side 2000 → 300
  assert.deepEqual(scaleBounds(WIDE, V, 0), { min: 0.15, max: 0.3 * MAX_ZOOM });
});

test('initial crop is centred and filled', () => {
  assert.deepEqual(initialCrop(WIDE, V), { scale: 0.3, x: 0, y: 0, rotation: 0 });
});

test('a filled image cannot be dragged far enough to show a gap', () => {
  const s = clampOffset({ scale: 0.3, x: 999, y: 999, rotation: 0 }, WIDE, V);
  assert.equal(s.x, 150);   // (2000·0.3 − 300) / 2
  assert.equal(s.y, 0);     // height exactly fills the frame
});

test('a fitted (smaller) image stays fully inside the frame', () => {
  const s = clampOffset({ scale: 0.15, x: -999, y: 999, rotation: 0 }, WIDE, V);
  assert.equal(s.x, -0);    // width exactly fits
  assert.equal(s.y, 75);    // (300 − 1000·0.15) / 2
});

test('zoom keeps the centred point fixed and respects bounds', () => {
  const s = zoomTo({ scale: 0.3, x: 100, y: 0, rotation: 0 }, 0.6, WIDE, V);
  assert.equal(s.scale, 0.6);
  assert.equal(s.x, 200);
  assert.equal(zoomTo(s, 99, WIDE, V).scale, 0.3 * MAX_ZOOM);
  assert.equal(zoomTo(s, 0, WIDE, V).scale, 0.15);
});

test('rotation swaps dimensions and re-fills', () => {
  assert.deepEqual(rotated(WIDE, 90), { width: 1000, height: 2000 });
  const r = rotateCw({ scale: 1, x: 40, y: 40, rotation: 270 }, WIDE, V);
  assert.deepEqual(r, { rotation: 0, x: 0, y: 0, scale: 0.3 });
  const clamped = clampOffset({ scale: 0.3, x: 999, y: 999, rotation: 90 }, WIDE, V);
  assert.deepEqual([clamped.x, clamped.y], [0, 150]);
});

test('slider maps to the scale range and back', () => {
  assert.equal(sliderToScale(0, WIDE, V, 0), 0.15);
  assert.ok(Math.abs(sliderToScale(1, WIDE, V, 0) - 1.2) < 1e-9);
  assert.ok(Math.abs(scaleToSlider(sliderToScale(0.4, WIDE, V, 0), WIDE, V, 0) - 0.4) < 1e-9);
});
