import test from 'node:test';
import assert from 'node:assert/strict';
import { axisTicks, fitRange, thinSeries, tickText, valueAt, zoomAbout, zoomAxes } from '../src/core/plot-scale.js';

test('a dragged box zooms the axis it runs along', () => {
  assert.equal(zoomAxes(200, 4), 'x');
  assert.equal(zoomAxes(3, 150), 'y');
  assert.equal(zoomAxes(120, 80), 'both');
  assert.equal(zoomAxes(2, 3), null);
  // A drag along x that wanders a little is still along x.
  assert.equal(zoomAxes(-180, 12), 'x');
});

test('log axes tick decades, then 1-2-5, then plain numbers', () => {
  assert.deepEqual(axisTicks('log', -4, -0.3).map((t) => t.text), ['10^{-4}', '10^{-3}', '10^{-2}', '10^{-1}']);
  const near = axisTicks('log', -2, -0.5);
  assert.deepEqual(near.map((t) => t.text), ['0.01', '0.02', '0.05', '0.1', '0.2']);
  assert.deepEqual(near.filter((t) => t.major).map((t) => t.text), ['0.01', '0.1']);
  const zoomed = axisTicks('log', Math.log10(0.24), Math.log10(0.26));
  assert.ok(zoomed.length >= 3 && zoomed.every((t) => /^0\.2[4-6]\d*$/.test(t.text)), zoomed.map((t) => t.text).join());
  assert.ok(axisTicks('log', -12, 12).length <= 13, 'many decades are thinned');
});

test('linear axes tick 1-2-5 steps, or the step asked for', () => {
  assert.deepEqual(axisTicks('linear', -0.1, 1.05).map((t) => t.text), ['0', '0.2', '0.4', '0.6', '0.8', '1']);
  assert.deepEqual(axisTicks('linear', -100, 20, { step: 20 }).map((t) => t.text), ['-100', '-80', '-60', '-40', '-20', '0', '20']);
  assert.equal(tickText(3e-9), '3·10^{-9}');
  assert.equal(tickText(1e6), '10^{6}');
});

test('fitted ranges round out, and a flat series still gets one', () => {
  assert.deepEqual(fitRange([-37, 4], { step: 20 }), [-40, 20]);
  assert.deepEqual(fitRange([5, 5]), [4, 6]);
  assert.deepEqual(fitRange([]), [-1, 1]);
});

test('zooming keeps the point under the pointer', () => {
  const view = zoomAbout({ x: [0, 10], y: [-1, 1] }, { x: 2, y: 0 }, 0.5, 'x');
  assert.deepEqual(view, { x: [1, 6], y: [-1, 1] });
});

test('series are read between points and thinned without losing peaks', () => {
  const points = [[0, 0], [1, 10], [2, 0]];
  assert.equal(valueAt(points, 0.5), 5);
  assert.equal(valueAt(points, 0.5, { stairs: true }), 0);
  assert.equal(valueAt(points, 3), null);
  const long = Array.from({ length: 100000 }, (_, i) => [i, i === 54321 ? 99 : Math.sin(i / 50)]);
  const thin = thinSeries(long, 0, 99999, 200);
  assert.ok(thin.length < 2000, String(thin.length));
  assert.ok(thin.some((p) => p[1] === 99), 'the spike survives');
  assert.ok(thin.every((p, i) => !i || p[0] >= thin[i - 1][0]), 'in order');
});
