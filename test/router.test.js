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

test('autoRoute balances a centered three-way branch', () => {
  const route = autoRoute([
    { x: 120, y: 0 },
    { x: 360, y: 0 },
    { x: 240, y: 80 },
  ]);
  assert.deepEqual(route, [
    { x: 240, y: 80 },
    { x: 240, y: 40 },
    { x: 120, y: 40 },
    { x: 120, y: 0 },
    { x: 360, y: 0 },
  ]);
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
  // Pin-conformant and clearance-keeping: each pin leaves one cell outward
  // (left/right) before bending; the crossing row sits one full grid cell clear
  // of the blocker bodies (y=-80) rather than hugging their y=-40 top edge.
  assert.deepEqual(pts, [
    { x: 240, y: 0 },
    { x: 200, y: 0 },
    { x: 200, y: -80 },
    { x: 800, y: -80 },
    { x: 800, y: 0 },
    { x: 760, y: 0 },
  ]);
  for (const rect of rects) {
    for (let i = 1; i < pts.length; i++) assert.equal(segThroughInterior(pts[i - 1], pts[i], rect), false);
  }
  // every body segment keeps at least one grid cell of clearance
  for (const rect of rects) {
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
      const y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
      const dx = x0 > rect.x + rect.w ? x0 - (rect.x + rect.w) : x1 < rect.x ? rect.x - x1 : 0;
      const dy = y0 > rect.y + rect.h ? y0 - (rect.y + rect.h) : y1 < rect.y ? rect.y - y1 : 0;
      const d = Math.hypot(dx, dy);
      if (i === 1 || i === pts.length - 1) continue; // pin legs exempt
      assert.ok(d >= 40, `segment ${i} keeps >=1 cell clearance (${d})`);
    }
  }
  allOnGrid(pts);
});

test('smartRoute extends a pin one cell outward in its direction before bending', () => {
  // gate (faces west) to drain (faces north): leave the gate left, approach the
  // drain from above — a clean outside bend around the body.
  const rects = [{ x: 0, y: -80, w: 120, h: 160 }];
  const pins = [
    pin(0, 0, -1, 0),
    pin(120, -80, 0, -1),
    pin(120, 80, 0, 1),
  ];
  const pts = runRobots({ x: 0, y: 0 }, { x: 120, y: -80 }, rects, pins);
  assert.deepEqual(pts, [
    { x: 0, y: 0 },
    { x: -40, y: 0 },
    { x: -40, y: -120 },
    { x: 120, y: -120 },
    { x: 120, y: -80 },
  ]);
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

test('smartRoute prefers the terminal outward direction (a down-pointing NMOS source goes down first)', () => {
  // NMOS source terminal at (120,80) points DOWN (0,1) because the source wire
  // leaves the body downward. The first segment must leave down, not left/right,
  // and never back up into the body.
  const env = {
    rects: [{ x: 0, y: -80, w: 120, h: 160 }],
    pins: new Map([
      ['120,80', { x: 0, y: 1 }], // source outward = down
    ]),
    wires: [],
  };
  const pts = smartRoute({ x: 120, y: 80 }, { x: 320, y: 240 }, env);
  const d = { x: pts[1].x - pts[0].x, y: pts[1].y - pts[0].y };
  assert.equal(d.x, 0, `first segment leaves straight down, got ${JSON.stringify(d)}`);
  assert.ok(d.y > 0, `first segment leaves downward, got ${JSON.stringify(d)}`);
  allOnGrid(pts);
});

test('smartRoute does not route the first segment up INTO the component from a downward pin', () => {
  const env = {
    rects: [{ x: 0, y: -80, w: 120, h: 160 }],
    pins: new Map([['120,80', { x: 0, y: 1 }]]),
    wires: [],
  };
  // target is above the source; even so the wire must not initially go up into the body
  const pts = smartRoute({ x: 120, y: 80 }, { x: 120, y: -240 }, env);
  assert.deepEqual(pts[0], { x: 120, y: 80 });
  // going straight up through the body would be a bbox interior crossing
  let interior = false;
  for (let i = 1; i < pts.length; i++) {
    if (segThroughInterior(pts[i - 1], pts[i], { x: 0, y: -80, w: 120, h: 160 })) interior = true;
  }
  assert.equal(interior, false, `no segment through the component body: ${JSON.stringify(pts)}`);
  allOnGrid(pts);
});

test('smartRoute avoids running parallel on top of an existing wire', () => {
  // an existing wire already occupies the y=40 channel; a straight route along
  // y=40 would overlap it, so the router must prefer a non-overlapping line.
  const wire = [{ x: 0, y: 40 }, { x: 400, y: 40 }];
  const env = { rects: [], pins: new Map(), wires: [wire] };
  const pts = smartRoute({ x: 0, y: 40 }, { x: 400, y: 40 }, env);
  assert.deepEqual(pts[0], { x: 0, y: 40 });
  assert.deepEqual(pts[pts.length - 1], { x: 400, y: 40 });
  // not an overlapping straight run along y=40
  const overlap = pts.length > 2 || pts[0].y !== 40 || pts[1].y !== 40;
  assert.ok(pts.length > 2 && pts.some((p) => p.y !== 40), `detoured off the shared line: ${JSON.stringify(pts)}`);
  allOnGrid(pts);
});
