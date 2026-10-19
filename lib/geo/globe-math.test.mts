// Run: npx tsx --test lib/geo/globe-math.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arcPoints, facing, HUBS, isLand, isVisible, landDots, rotate, ROUTES, toVec } from './globe-math.ts';

const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('land mask knows continents from oceans', () => {
  assert.equal(isLand(-1.29, 36.82), true);    // Nairobi
  assert.equal(isLand(51.5, -0.13), true);     // London
  assert.equal(isLand(31.23, 121.2), true);    // Shanghai
  assert.equal(isLand(0, -30), false);         // mid-Atlantic
  assert.equal(isLand(-30, 80), false);        // Indian Ocean
  assert.equal(isLand(-80, 0), false);         // Antarctica omitted
});

test('land dots are unit vectors, a few thousand of them', () => {
  const dots = landDots();
  assert.ok(dots.length > 4000 && dots.length < 12000, `got ${dots.length}`);
  for (const d of dots.slice(0, 50)) close(Math.hypot(...d), 1, 1e-6);
});

test('facing() brings a city to the centre of the view', () => {
  const nbo = HUBS.find((h) => h.id === 'nbo')!;
  const { yaw, pitch } = facing(nbo.lat, nbo.lon);
  const [x, y, z] = rotate(toVec(nbo.lat, nbo.lon), yaw, pitch);
  close(x, 0, 1e-6); close(y, 0, 1e-6); close(z, 1, 1e-6);
  assert.equal(isVisible([x, y, z]), true);
  assert.equal(isVisible([0, 0, -1]), false);
  assert.equal(isVisible([1.2, 0, -0.1]), true); // raised arc point beyond the limb
});

test('arcs start and end at their hubs and rise in between', () => {
  const a = toVec(31.23, 121.47), b = toVec(-1.29, 36.82);
  const pts = arcPoints(a, b, 20);
  assert.equal(pts.length, 21);
  pts[0]!.forEach((v, i) => close(v, a[i]!, 1e-9));
  pts[20]!.forEach((v, i) => close(v, b[i]!, 1e-9));
  assert.ok(Math.hypot(...pts[10]!) > 1.05);
  for (const [from, to] of ROUTES) {
    assert.ok(HUBS.some((h) => h.id === from) && HUBS.some((h) => h.id === to));
  }
});
