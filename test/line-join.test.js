import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { joinLineAnnotations, joinPolylines, tidyPolyline } from '../src/core/line-join.js';

const P = (...xy) => xy.map(([x, y]) => ({ x, y }));
// One clock cycle: low, rise, high, fall, low.
const cycle = (x) => P([x, 0], [x + 80, 0], [x + 80, -80], [x + 240, -80], [x + 240, 0], [x + 320, 0]);

test('tidyPolyline drops repeats and straight-through vertices', () => {
  assert.deepEqual(tidyPolyline(P([0, 0], [40, 0], [40, 0], [80, 0], [80, 40])), P([0, 0], [80, 0], [80, 40]));
  // A path that doubles back keeps its turn.
  assert.deepEqual(tidyPolyline(P([0, 0], [80, 0], [40, 0])), P([0, 0], [80, 0], [40, 0]));
});

test('cycles laid end to end join into one waveform', () => {
  const joined = joinPolylines([cycle(0), cycle(320), cycle(640)]);
  assert.deepEqual(joined[0], { x: 0, y: 0 });
  assert.deepEqual(joined.at(-1), { x: 960, y: 0 });
  // The two lows meeting at a cycle boundary become one segment.
  assert.ok(joined.some((p, i) => i && joined[i - 1].x === 560 && p.x === 720 && p.y === 0));
  assert.equal(joined.length, 14);
});

test('cycles overlapping along a stretch, in either direction, join once', () => {
  const second = cycle(280).reverse();
  const joined = joinPolylines([cycle(0), second]);
  assert.deepEqual(joined.map((p) => p.x).sort((a, b) => a - b)[0], 0);
  assert.equal(joined.filter((p) => p.y === -80).length, 4);
  assert.equal(new Set(joined.map((p) => `${p.x},${p.y}`)).size, joined.length);
});

test('lines that are apart, branch, or cross do not join', () => {
  assert.equal(joinPolylines([P([0, 0], [80, 0]), P([200, 0], [280, 0])]), null);
  assert.equal(joinPolylines([P([0, 0], [160, 0]), P([80, 0], [80, 80])]), null);
  assert.equal(joinPolylines([P([0, 0], [160, 0]), P([80, -80], [80, 80])]), null);
});

test('joinLineAnnotations keeps the first line and removes the rest', () => {
  const c = new Circuit();
  const a = c.addAnnotation('line', { points: cycle(0), style: { color: 'red' } });
  const b = c.addAnnotation('line', { points: cycle(320) });
  const kept = joinLineAnnotations(c, [a.id, b.id]);
  assert.equal(kept.id, a.id);
  assert.equal(c.labels.has(b.id), false);
  assert.deepEqual(kept.end, { x: 640, y: 0 });
  const far = c.addAnnotation('line', { points: P([0, 400], [80, 400]) });
  assert.throws(() => joinLineAnnotations(c, [a.id, far.id]), /continuous/);
  assert.equal(c.labels.has(far.id), true);
});

test('a line moves and removes several vertices at once', () => {
  const c = new Circuit();
  const line = c.addAnnotation('line', { points: cycle(0) });
  line.moveVertices([2, 3], 0, -40);
  assert.deepEqual(line.points.slice(2, 4), P([80, -120], [240, -120]));
  assert.equal(line.removeVertices([1, 2, 3, 4]), true);
  assert.deepEqual(line.points, P([0, 0], [320, 0]));
  assert.equal(line.removeVertices([0]), false);
});
