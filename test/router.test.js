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
  // pair shares y=0 at x=120 and x=360; external at (240, 80). Junction
  // lands AT the pair's row (y=0), centered between the pair's x — i.e.
  // (240, 0). The external lead drops straight down to the pair's row,
  // then the pair splits to each member on the same row — no detour.
  const route = autoRoute([
    { x: 120, y: 0 },
    { x: 360, y: 0 },
    { x: 240, y: 80 },
  ]);
  assert.deepEqual(route, [
    { x: 240, y: 80 },
    { x: 240, y: 0 },
    { x: 120, y: 0 },
    { x: 360, y: 0 },
  ]);
});

import { balancedPaths, balancedRoute } from '../src/core/router.js';

test('balancedPaths places junction AT the pair column (no detour past the pair)', () => {
  // CMOS-inverter VIN-style: gates share x=200, external port at x=-120.
  // The junction lands AT (200, 0) — on the gate column, at the midpoint
  // of the two gates' y values. The external lead goes straight RIGHT
  // from the port to the junction, then splits vertically to each gate
  // — textbook Razavi layout, no detour.
  const paths = balancedPaths([
    { x: 200, y: -120 },
    { x: 200, y: 120 },
    { x: -120, y: 0 },
  ], { rects: [], pins: new Map(), wires: [] });
  assert.equal(paths.length, 3, 'must emit three branches for a T-junction');
  const flat = paths.flat();
  // Each branch must reach (200, 0) — that's where the solder dot lands.
  assert.ok(flat.some((p) => p.x === 200 && p.y === 0), 'junction at (200, 0) must appear in some branch');
  // External branch: VIN.p (-120, 0) → junction (200, 0).
  assert.deepEqual(paths[0], [{ x: -120, y: 0 }, { x: 200, y: 0 }]);
  // Pair branch: junction (200, 0) → M2.g (200, -120) — straight vertical.
  assert.deepEqual(paths[1], [{ x: 200, y: 0 }, { x: 200, y: -120 }]);
  // Other branch: junction (200, 0) → M1.g (200, 120) — straight vertical.
  assert.deepEqual(paths[2], [{ x: 200, y: 0 }, { x: 200, y: 120 }]);
});

test('balancedPaths junction mirrors when external is to the right of the pair', () => {
  // CMOS-inverter VOUT-style: drains share x=320, external at x=560.
  // Junction lands at (320, 0) — ON the drain column.
  const paths = balancedPaths([
    { x: 320, y: -40 },
    { x: 320, y: 40 },
    { x: 560, y: 0 },
  ], { rects: [], pins: new Map(), wires: [] });
  assert.equal(paths.length, 3);
  const flat = paths.flat();
  assert.ok(flat.some((p) => p.x === 320 && p.y === 0), 'junction at (320, 0)');
  assert.deepEqual(paths[0], [{ x: 560, y: 0 }, { x: 320, y: 0 }]);
  // Pair branch: junction → M2.d straight vertical up.
  assert.deepEqual(paths[1], [{ x: 320, y: 0 }, { x: 320, y: -40 }]);
  // Other branch: junction → M1.d straight vertical down.
  assert.deepEqual(paths[2], [{ x: 320, y: 0 }, { x: 320, y: 40 }]);
});

test('balancedPaths corner lands at the pair row for y-paired (top/bottom) pairs', () => {
  // Pair shares y=80, external at (80, 200). Junction lands AT y=80 (the
  // pair's row), centered between the pair's x — i.e. (80, 80).
  const paths = balancedPaths([
    { x: 0, y: 80 },
    { x: 160, y: 80 },
    { x: 80, y: 200 },
  ], { rects: [], pins: new Map(), wires: [] });
  // pair.y = 80, so junction.y = 80; junction.x = midpoint(0, 160) = 80
  const flat = paths.flat();
  assert.ok(flat.some((p) => p.x === 80 && p.y === 80), 'junction at (80, 80)');
  // External branch: (80, 200) → junction (80, 80)
  assert.deepEqual(paths[0], [{ x: 80, y: 200 }, { x: 80, y: 80 }]);
  // Pair branch: junction → (0, 80) — straight horizontal.
  assert.deepEqual(paths[1], [{ x: 80, y: 80 }, { x: 0, y: 80 }]);
  // Other branch: junction → (160, 80) — straight horizontal.
  assert.deepEqual(paths[2], [{ x: 80, y: 80 }, { x: 160, y: 80 }]);
});

test('balancedPaths falls back to simpleAutoRoute for collinear (no centered-branch pattern)', () => {
  // All three on y=0 with no third between in x → hasCenteredBranch false.
  const paths = balancedPaths([
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 300, y: 0 },
  ], { rects: [], pins: new Map(), wires: [] });
  // Should be a single straight-line polyline wrapped in an array.
  assert.equal(paths.length, 1);
  // Path points are all on y=0 and on the grid.
  for (const p of paths[0]) {
    assert.equal(p.y, 0);
    assert.equal(p.x % 40, 0);
  }
});

test('balancedRoute single polyline uses the same junction-at-pair-column', () => {
  // The single-polyline variant (used when net has user-defined junctions)
  // also gets the junction AT the pair's column — no geometric midpoint
  // artifact at x=40, and no offset toward the external.
  const r = balancedRoute([
    { x: 200, y: -120 },
    { x: 200, y: 120 },
    { x: -120, y: 0 },
  ], { rects: [], pins: new Map(), wires: [] });
  // Junction (200, 0) must be a vertex.
  assert.ok(r.some((p) => p.x === 200 && p.y === 0), 'balancedRoute polyline must visit (200, 0)');
  // No geometric-midpoint artifact at x=40.
  assert.ok(!r.some((p) => p.x === 40 && p.y === 0), 'no junction at the old midpoint (40, 0)');
  // No offset-toward-external artifact at x=160.
  assert.ok(!r.some((p) => p.x === 160 && p.y === 0), 'no junction at the old offset (160, 0)');
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

test('smartRoute approaches a pin on a body boundary with a straight segment, not a detour', () => {
  // A free point directly above M2.d (a drain pin on the body top-right corner)
  // must connect with a straight vertical segment. The clearance check must
  // recognize the touch at the pin, not force a detour through the neighbour.
  const rects = [{ x: 400, y: -80, w: 120, h: 160 }];
  const pins = new Map([
    ['400,0', { x: -1, y: 0 }],
    ['520,-80', { x: 0, y: -1 }],
    ['520,80', { x: 0, y: 1 }],
  ]);
  const pts = smartRoute({ x: 520, y: -120 }, { x: 520, y: -80 }, { rects, pins, wires: [] });
  assert.deepEqual(pts, [{ x: 520, y: -120 }, { x: 520, y: -80 }]);
});

test('smartRoute returns a straight line to a pin one cell below a free point', () => {
  const pts = runRobots({ x: 520, y: -120 }, { x: 520, y: -80 }, [R(400, -80)], [pin(520, -80, 0, -1)]);
  assert.deepEqual(pts, [{ x: 520, y: -120 }, { x: 520, y: -80 }]);
});

test('smartRoute prefers a channel one cell clear of a label box (soft obstacle)', () => {
  // The straight run along y=0 passes within a grid cell of the label box above
  // it; the y=-80 channel stays clear. Labels are soft: the router picks the
  // clean channel when one exists but never hard-blocks a connection.
  const labelRects = [{ x: 40, y: -40, w: 320, h: 80 }]; // y -40..40, so y=0 grazes it
  const env = { rects: [], pins: new Map(), wires: [], labelRects };
  const pts = smartRoute({ x: 0, y: 0 }, { x: 400, y: 0 }, env);
  assert.deepEqual(pts[0], { x: 0, y: 0 });
  assert.deepEqual(pts[pts.length - 1], { x: 400, y: 0 });
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
    const y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
    const dx = x0 > labelRects[0].x + labelRects[0].w ? x0 - (labelRects[0].x + labelRects[0].w) : x1 < labelRects[0].x ? labelRects[0].x - x1 : 0;
    const dy = y0 > labelRects[0].y + labelRects[0].h ? y0 - (labelRects[0].y + labelRects[0].h) : y1 < labelRects[0].y ? labelRects[0].y - y1 : 0;
    assert.ok(Math.hypot(dx, dy) >= 40, `segment ${i} keeps >=1 cell from the label: ${JSON.stringify(pts)}`);
  }
  allOnGrid(pts);
});

test('smartRoute still connects when every channel grazes the label (labels are soft)', () => {
  // A label box covering the whole corridor: no clean channel exists, but
  // labels are NOT hard obstacles, so the connection is still made.
  const labelRects = [{ x: 0, y: -120, w: 400, h: 240 }];
  const env = { rects: [], pins: new Map(), wires: [], labelRects };
  const pts = smartRoute({ x: 0, y: 0 }, { x: 400, y: 0 }, env);
  assert.ok(pts.length >= 2, 'a route exists');
  assert.deepEqual(pts[0], { x: 0, y: 0 });
  assert.deepEqual(pts[pts.length - 1], { x: 400, y: 0 });
});

test('smartRoute leaves aligned gate pins in their direction (no boundary run)', () => {
  // NMOS gate (200,120) and PMOS gate (200,-120), both facing WEST. The direct
  // vertical run hugs the body edges; the router must leave each gate one cell
  // west and route in the x=160 channel instead.
  const rects = [{ x: 200, y: 40, w: 120, h: 160 }, { x: 200, y: -200, w: 120, h: 160 }];
  const pins = new Map([
    ['200,120', { x: -1, y: 0 }],
    ['200,-120', { x: -1, y: 0 }],
  ]);
  const pts = smartRoute({ x: 200, y: 120 }, { x: 200, y: -120 }, { rects, pins, wires: [] });
  assert.deepEqual(pts, [
    { x: 200, y: 120 },
    { x: 160, y: 120 },
    { x: 160, y: -120 },
    { x: 200, y: -120 },
  ]);
  // every body segment keeps at least one grid cell of clearance
  for (const rect of rects) {
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
      const y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
      const dx = x0 > rect.x + rect.w ? x0 - (rect.x + rect.w) : x1 < rect.x ? rect.x - x1 : 0;
      const dy = y0 > rect.y + rect.h ? y0 - (rect.y + rect.h) : y1 < rect.y ? rect.y - y1 : 0;
      if (i === 1 || i === pts.length - 1) continue; // pin legs exempt
      assert.ok(Math.hypot(dx, dy) >= 40, `segment ${i} keeps >=1 cell clearance (${Math.hypot(dx, dy)})`);
    }
  }
  allOnGrid(pts);
});

test('smartRoute still prefers the straight run for facing pins in open space', () => {
  // Two resistors facing each other on the same row: the escapes are collinear
  // with the target, so the route stays a single straight wire.
  const rects = [{ x: 0, y: -40, w: 160, h: 80 }, { x: 400, y: -40, w: 160, h: 80 }];
  const pins = new Map([
    ['160,0', { x: 1, y: 0 }],
    ['400,0', { x: -1, y: 0 }],
  ]);
  const pts = smartRoute({ x: 160, y: 0 }, { x: 400, y: 0 }, { rects, pins, wires: [] });
  assert.deepEqual(pts, [{ x: 160, y: 0 }, { x: 400, y: 0 }]);
});
