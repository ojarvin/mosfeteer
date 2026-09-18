import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyTransform,
  transformToSvg,
  transformRect,
  rectFromPoints,
  rectUnion,
  rectsOverlap,
  distanceToSegment,
  fmt,
  segmentCrossesRect,
  pt,
  midSnap,
} from '../src/core/geometry.js';

function T(x, y, rotation = 0, mirrorX = false, mirrorY = false) {
  return { x, y, rotation, mirrorX, mirrorY };
}

test('applyTransform with no mirror/rotation is a pure translate', () => {
  assert.deepEqual(applyTransform(T(100, 50), 10, 20), { x: 110, y: 70 });
});

test('applyTransform negates a single axis with mirror', () => {
  assert.deepEqual(applyTransform(T(0, 0, 0, true), 10, 20), { x: -10, y: 20 });
  assert.deepEqual(applyTransform(T(0, 0, 0, false, true), 10, 20), { x: 10, y: -20 });
  assert.deepEqual(applyTransform(T(0, 0, 0, true, true), 10, 20), { x: -10, y: -20 });
});

test('applyTransform handles 90-degree rotation (mirror first, then rotate)', () => {
  // mirror none, rotate 90: (x,y) -> (-y, x)
  assert.deepEqual(applyTransform(T(0, 0, 90), 10, 20), { x: -20, y: 10 });
  // mirrorX first: (x,y)->(-x,y); then rotate 90 -> (-y, -x)
  assert.deepEqual(applyTransform(T(0, 0, 90, true), 10, 20), { x: -20, y: -10 });
  // translate applied last
  assert.deepEqual(applyTransform(T(5, 5, 90), 10, 20), { x: -15, y: 15 });
});

test('applyTransform handles 180 and 270 rotation', () => {
  // 180: (x,y) -> (-x,-y)
  assert.deepEqual(applyTransform(T(0, 0, 180), 10, 20), { x: -10, y: -20 });
  // 270: (x,y) -> (y,-x)
  assert.deepEqual(applyTransform(T(0, 0, 270), 10, 20), { x: 20, y: -10 });
});

test('applyTransform normalizes negative / >360 rotation', () => {
  assert.deepEqual(applyTransform(T(0, 0, -90), 10, 20), { x: 20, y: -10 });
  assert.deepEqual(applyTransform(T(0, 0, 450), 10, 20), { x: -20, y: 10 });
});

test('transformToSvg emits translate rotate scale in order', () => {
  assert.equal(transformToSvg(T(40, 80, 90, true, false)), 'translate(40 80) rotate(90) scale(-1 1)');
  assert.equal(transformToSvg(T(0, 0, 0, false, false)), 'translate(0 0) rotate(0) scale(1 1)');
  assert.equal(transformToSvg(T(0, 0, 270, true, true)), 'translate(0 0) rotate(270) scale(-1 -1)');
});

test('transformRect transforms the 4 corners into axis-aligned bbox', () => {
  const r = { x: 0, y: -40, w: 120, h: 80 };
  const out = transformRect(T(0, 0, 90), r);
  assert.deepEqual(out, { x: -40, y: 0, w: 80, h: 120 });
  const out2 = transformRect(T(400, 0, 0), r);
  assert.deepEqual(out2, { x: 400, y: -40, w: 120, h: 80 });
});

test('rectFromPoints computes min-x/min-y and extents', () => {
  assert.deepEqual(rectFromPoints([{ x: 5, y: 10 }, { x: 3, y: 2 }, { x: 8, y: 7 }]), {
    x: 3,
    y: 2,
    w: 5,
    h: 8,
  });
  assert.deepEqual(rectFromPoints([{ x: 0, y: 0 }]), { x: 0, y: 0, w: 0, h: 0 });
});

test('rectUnion combines multiple rects', () => {
  const union = rectUnion([
    { x: 0, y: 0, w: 10, h: 10 },
    { x: 20, y: 5, w: 10, h: 30 },
  ]);
  assert.deepEqual(union, { x: 0, y: 0, w: 30, h: 35 });
});

test('rectsOverlap uses STRICT positive-area overlap (touching is NOT overlap)', () => {
  assert.equal(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 }), false);
  assert.equal(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 10, w: 10, h: 10 }), false);
  assert.equal(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 10, w: 10, h: 10 }), false);
  assert.equal(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }), true);
  assert.equal(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 9, y: 0, w: 2, h: 10 }), true);
});

test('rectsOverlap identical rects overlap', () => {
  assert.equal(rectsOverlap({ x: 0, y: 0, w: 40, h: 80 }, { x: 0, y: 0, w: 40, h: 80 }), true);
});

test('segmentCrossesRect detects horizontal/vertical pass-through only', () => {
  const r = { x: 0, y: 0, w: 40, h: 40 };
  // vertical wire through interior
  assert.equal(segmentCrossesRect({ x: 20, y: -10 }, { x: 20, y: 50 }, r), true);
  // horizontal wire through interior
  assert.equal(segmentCrossesRect({ x: -10, y: 20 }, { x: 50, y: 20 }, r), true);
  // endpoints / boundary touch do NOT count
  assert.equal(segmentCrossesRect({ x: 0, y: -10 }, { x: 0, y: 20 }, r), false);
  assert.equal(segmentCrossesRect({ x: 40, y: -10 }, { x: 40, y: 50 }, r), false);
  assert.equal(segmentCrossesRect({ x: -10, y: 0 }, { x: 50, y: 0 }, r), false);
  // clears entirely
  assert.equal(segmentCrossesRect({ x: 50, y: -10 }, { x: 50, y: 90 }, r), false);
});

test('pt formats a point', () => {
  assert.equal(pt({ x: 40, y: 80 }), '40 80');
});

test('midSnap returns the unrounded midpoint', () => {
  assert.deepEqual(midSnap({ x: 0, y: 0 }, { x: 80, y: 40 }), { x: 40, y: 20 });
});

test('distanceToSegment clamps to the segment endpoints', () => {
  const a = { x: 0, y: 0 };
  const b = { x: 100, y: 0 };
  assert.equal(distanceToSegment({ x: 50, y: 30 }, a, b), 30, 'perpendicular drop inside the span');
  assert.equal(distanceToSegment({ x: 50, y: 0 }, a, b), 0, 'on the segment');
  assert.equal(distanceToSegment({ x: -40, y: 0 }, a, b), 40, 'clamped past the start');
  assert.equal(distanceToSegment({ x: 140, y: 0 }, a, b), 40, 'clamped past the end');
  // A degenerate segment is just its point, never a divide-by-zero.
  assert.equal(distanceToSegment({ x: 3, y: 4 }, a, a), 5);
});

test('fmt keeps integers exact and rounds others to two decimals', () => {
  assert.equal(fmt(40), '40');
  assert.equal(fmt(-120), '-120');
  assert.equal(fmt(0), '0');
  assert.equal(fmt(12.3456), '12.35');
});
