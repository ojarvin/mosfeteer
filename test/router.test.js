import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoRoute, segmentsCross, smartRoute, segThroughInterior } from '../src/core/router.js';
import { onGrid } from '../src/core/grid.js';

function allOnGrid(pts) {
  for (const p of pts) assert.ok(onGrid(p.x) && onGrid(p.y), `point (${p.x},${p.y}) on grid`);
}

const R = (x, y, rot = 0) => ({ x, y, w: 120, h: 80 }); // resistor bbox (rot 0)
const pin = (x, y, dx, dy) => [`${x},${y}`, { x: dx, y: dy }];

function runRobots(from, to, rects, pins, wires = []) {
  return smartRoute(from, to, { rects, pins: new Map(pins), wires });
}

test('autoRoute empty list returns []', () => {
  assert.deepEqual(autoRoute([]), []);
});

test('autoRoute single point returns just that point', () => {
  assert.deepEqual(autoRoute([{ x: 40, y: 80 }]), [{ x: 40, y: 80 }]);
});

test('autoRoute straight run on a grid line stays straight (1 segment)', () => {
  const pts = autoRoute([{ x: 0, y: 0 }, { x: 120, y: 0 }]);
  assert.equal(pts.length, 2);
  assert.deepEqual(pts, [{ x: 0, y: 0 }, { x: 120, y: 0 }]);
  // vertical aligned
  const vt = autoRoute([{ x: 80, y: 0 }, { x: 80, y: 160 }]);
  assert.equal(vt.length, 2);
  assert.deepEqual(vt, [{ x: 80, y: 0 }, { x: 80, y: 160 }]);
});

test('autoRoute drops coincident duplicate points', () => {
  const pts = autoRoute([{ x: 40, y: 0 }, { x: 40, y: 0 }, { x: 120, y: 0 }]);
  assert.deepEqual(pts, [{ x: 40, y: 0 }, { x: 120, y: 0 }]);
});

test('autoRoute L-shapes a non-aligned pair; preserves endpoints, all on grid', () => {
  const pts = autoRoute([{ x: 0, y: 0 }, { x: 120, y: 80 }]);
  assert.deepEqual(pts[0], { x: 0, y: 0 });
  assert.deepEqual(pts[pts.length - 1], { x: 120, y: 80 });
  assert.equal(pts.length, 4, 'cornered orthogonal path');
  assert.deepEqual(pts, [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 80 }, { x: 120, y: 80 }]);
  allOnGrid(pts);
  // every consecutive pair is axis-aligned orthogonal
  for (let i = 1; i < pts.length; i++) {
    assert.ok(pts[i].x === pts[i - 1].x || pts[i].y === pts[i - 1].y, 'orthogonal segment');
  }
});

test('autoRoute multi-point chain preserves all intermediate grid lines', () => {
  const chain = autoRoute([
    { x: 0, y: 0 },
    { x: 160, y: 120 },
    { x: 80, y: 240 },
  ]);
  assert.deepEqual(chain[0], { x: 0, y: 0 });
  assert.deepEqual(chain[chain.length - 1], { x: 80, y: 240 });
  assert.ok(chain.some((p) => p.x === 160 && p.y === 120), 'intermediate endpoint preserved');
  allOnGrid(chain);
});

test('segmentsCross detects interior orthogonal crossings', () => {
  // vertical a-b crossing horizontal c-d at interior points
  assert.equal(segmentsCross({ x: 20, y: -10 }, { x: 20, y: 50 }, { x: -10, y: 20 }, { x: 50, y: 20 }), true);
  // horizontal a-b crossing vertical c-d
  assert.equal(segmentsCross({ x: -10, y: 20 }, { x: 50, y: 20 }, { x: 20, y: -10 }, { x: 20, y: 50 }), true);
});

test('segmentsCross does NOT count non-crossing or endpoint-touching segments', () => {
  // separated (no crossing)
  assert.equal(segmentsCross({ x: 20, y: -10 }, { x: 20, y: 50 }, { x: 60, y: 20 }, { x: 80, y: 20 }), false);
  // vertical outside horizontal y-span
  assert.equal(segmentsCross({ x: 50, y: -10 }, { x: 50, y: 5 }, { x: 0, y: 20 }, { x: 100, y: 20 }), false);
  // horizontal outside vertical x-span
  assert.equal(segmentsCross({ x: 20, y: -10 }, { x: 20, y: 50 }, { x: 40, y: 0 }, { x: 80, y: 0 }), false);
  // parallel segments never cross
  assert.equal(segmentsCross({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 20 }, { x: 100, y: 20 }), false);
  // diagonal (not orthogonal) is unsupported -> false
  assert.equal(segmentsCross({ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }, { x: 100, y: 0 }), false);
});

test('segThroughInterior catches wires drilling through a body from its own pin', () => {
  const r = R(240, -40);
  // leaving a left-edge pin straight across the body does enter the interior
  assert.equal(segThroughInterior({ x: 240, y: 0 }, { x: 760, y: 0 }, r), true);
  // exiting outward from the pin does not
  assert.equal(segThroughInterior({ x: 240, y: 0 }, { x: 120, y: 0 }, r), false);
  // hugging the top boundary line does not
  assert.equal(segThroughInterior({ x: 240, y: -40 }, { x: 760, y: -40 }, r), false);
  // straight through an unrelated body
  assert.equal(segThroughInterior({ x: 0, y: 0 }, { x: 800, y: 0 }, R(240, -40)), true);
});

test('smartRoute: collinear pair stays straight and on grid', () => {
  const pts = runRobots({ x: 0, y: 0 }, { x: 120, y: 0 }, [], []);
  assert.deepEqual(pts, [{ x: 0, y: 0 }, { x: 120, y: 0 }]);
  allOnGrid(pts);
});

test('smartRoute avoids drilling through the source body even when endpoint is on the boundary', () => {
  // straight (240,0)-(760,0) would run through the resistor occupying 240..360
  const pts = runRobots({ x: 240, y: 0 }, { x: 760, y: 0 }, [R(240, -40)], [pin(240, 0, -1, 0), pin(360, 0, 1, 0)]);
  const ortho = pts.every((p, i) => i === 0 || p.x === pts[i - 1].x || p.y === pts[i - 1].y);
  assert.ok(ortho, `orthogonal route, got ${JSON.stringify(pts)}`);
  for (const rect of [R(240, -40)]) {
    for (let i = 1; i < pts.length; i++) assert.equal(segThroughInterior(pts[i - 1], pts[i], rect), false);
  }
  assert.deepEqual(pts[0], { x: 240, y: 0 });
  assert.deepEqual(pts[pts.length - 1], { x: 760, y: 0 });
});

test('smartRoute detours around an in-line blocker over the clean top channel', () => {
  const rects = [R(240, -40), R(640, -40), R(480, -40)];
  const pins = [
    pin(240, 0, -1, 0), pin(360, 0, 1, 0),
    pin(640, 0, -1, 0), pin(760, 0, 1, 0),
    pin(480, 0, -1, 0), pin(600, 0, 1, 0),
  ];
  const pts = runRobots({ x: 240, y: 0 }, { x: 760, y: 0 }, rects, pins);
  assert.deepEqual(pts, [
    { x: 240, y: 0 },
    { x: 240, y: -40 },
    { x: 760, y: -40 },
    { x: 760, y: 0 },
  ]);
  for (const rect of rects) {
    for (let i = 1; i < pts.length; i++) assert.equal(segThroughInterior(pts[i - 1], pts[i], rect), false);
  }
  allOnGrid(pts);
});

test('smartRoute never returns a diagonal (always axis-aligned)', () => {
  const pts = runRobots({ x: 0, y: 0 }, { x: 200, y: -160 }, [], []);
  assert.ok(pts.length >= 2);
  for (let i = 1; i < pts.length; i++) {
    assert.ok(pts[i].x === pts[i - 1].x || pts[i].y === pts[i - 1].y, `orthogonal seg ${i}`);
  }
  assert.deepEqual(pts[0], { x: 0, y: 0 });
  assert.deepEqual(pts[pts.length - 1], { x: 200, y: -160 });
});

test('smartRoute falls back to A* when the direct path is sealed off (maze-like)', () => {
  // wall from (200,20) up beyond the target row, so the top channel is blocked
  const rects = [
    R(240, -40),
    { x: 240, y: -240, w: 80, h: 220 }, // vertical wall left of the gap
    { x: 400, y: -40, w: 80, h: 80 },   // seal the 360..480 gap at y=0
    R(640, -40),
  ];
  const pins = [pin(240, 0, -1, 0), pin(760, 0, 1, 0)];
  const pts = runRobots({ x: 240, y: 0 }, { x: 760, y: 0 }, rects, pins);
  assert.deepEqual(pts[0], { x: 240, y: 0 });
  assert.deepEqual(pts[pts.length - 1], { x: 760, y: 0 });
  for (const rect of rects) {
    for (let i = 1; i < pts.length; i++) assert.equal(segThroughInterior(pts[i - 1], pts[i], rect), false);
  }
  allOnGrid(pts);
});
