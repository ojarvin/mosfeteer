import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoRoute, balancedCrossCoupling, gateBodyCrossingAllowed, segmentsCross, smartRoute, segThroughInterior, steinerBranches, steinerRoute } from '../src/core/router.js';
import { onGrid } from '../src/core/grid.js';
import { junctionPoints } from '../src/core/wiring.js';

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
  // Three terminals in a Y formation: the exact rectilinear Steiner tree is a
  // single centered T-junction at the coordinate median (240, 0). The route
  // must visit that junction and every terminal, staying orthogonal + on grid.
  const route = autoRoute([
    { x: 120, y: 0 },
    { x: 360, y: 0 },
    { x: 240, y: 80 },
  ]);
  const flat = new Set(route.map((p) => `${p.x},${p.y}`));
  assert.ok(flat.has('240,0'), `junction at the median (240, 0), got ${JSON.stringify(route)}`);
  for (const t of ['120,0', '360,0', '240,80']) assert.ok(flat.has(t), `route visits ${t}`);
  assert.deepEqual(route[0], { x: 120, y: 0 });
  assert.deepEqual(route[route.length - 1], { x: 240, y: 80 });
  for (let i = 1; i < route.length; i++) {
    assert.ok(route[i].x === route[i - 1].x || route[i].y === route[i - 1].y, 'orthogonal segment');
  }
  allOnGrid(route);
});

const EMPTY_ENV = { rects: [], pins: new Map(), wires: [], labelRects: [] };

test('balancedCrossCoupling preserves matched diagonal endpoint pairs', () => {
  const [a, b] = balancedCrossCoupling(
    [{ x: 0, y: -160 }, { x: 240, y: 160 }],
    [{ x: 240, y: -160 }, { x: 0, y: 160 }],
  );
  assert.deepEqual(a, [{ x: 0, y: -160 }, { x: 240, y: 160 }]);
  assert.deepEqual(b, [{ x: 240, y: -160 }, { x: 0, y: 160 }]);
});

test('balancedCrossCoupling has one central diagonal crossing and matched metrics', () => {
  const paths = balancedCrossCoupling(
    [{ x: 0, y: -160 }, { x: 240, y: 160 }],
    [{ x: 240, y: -160 }, { x: 0, y: 160 }],
  );
  assert.equal(paths[0].length, 2);
  assert.equal(paths[1].length, 2);
  const cross = (a, b, c, d) => {
    const orient = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    return orient(a, b, c) * orient(a, b, d) < 0 && orient(c, d, a) * orient(c, d, b) < 0;
  };
  assert.equal(cross(paths[0][0], paths[0][1], paths[1][0], paths[1][1]), true);
  const length = (path) => Math.hypot(path[1].x - path[0].x, path[1].y - path[0].y);
  assert.equal(length(paths[0]), length(paths[1]));
});

test('balancedCrossCoupling returns independent protected diagonal paths', () => {
  const [a, b] = balancedCrossCoupling(
    [{ x: 0, y: -160 }, { x: 240, y: 160 }],
    [{ x: 240, y: -160 }, { x: 0, y: 160 }],
  );
  assert.notStrictEqual(a, b);
  assert.notStrictEqual(a[0], b[0]);
  assert.notStrictEqual(a[1], b[1]);
});

test('balancedCrossCoupling rejects non-mirrored and degenerate endpoint sets', () => {
  assert.throws(() => balancedCrossCoupling(
    [{ x: 0, y: -160 }, { x: 240, y: 160 }],
    [{ x: 0, y: 160 }, { x: 240, y: 160 }],
  ), /opposite diagonals|diagonals|rectangle/);
  assert.throws(() => balancedCrossCoupling(
    [{ x: 0, y: 0 }, { x: 80, y: 80 }],
    [{ x: 80, y: 0 }, { x: 0, y: 80 }],
  ), /too small|no grid center/);
  assert.throws(() => balancedCrossCoupling(
    [{ x: 0, y: 0 }, { x: 120, y: 80 }],
    [{ x: 120, y: 0 }, { x: 0, y: 80 }],
  ), /grid center|too small/);
});

function junctionOf(paths, terminals) {
  return junctionPoints(paths, terminals.map((p) => ({ x: p.x, y: p.y })));
}

test('steinerBranches places the junction AT the pair column (no detour past the pair)', () => {
  // CMOS-inverter VIN-style: gates share x=200, external port at x=-120.
  // The Steiner tree's junction lands AT (200, 0) — the x-median (both gates)
  // and the y-median of the three terminals — with three straight arms.
  const paths = steinerBranches([
    { x: 200, y: -120 },
    { x: 200, y: 120 },
    { x: -120, y: 0 },
  ], EMPTY_ENV);
  assert.equal(paths.length, 3, 'three branches for a T-junction');
  const flat = paths.flat();
  assert.ok(flat.some((p) => p.x === 200 && p.y === 0), 'junction at (200, 0) must appear');
  const js = junctionOf(paths, [
    { x: 200, y: -120 },
    { x: 200, y: 120 },
    { x: -120, y: 0 },
  ]);
  assert.deepEqual(js, [{ x: 200, y: 0 }], 'exactly one junction, at the pair column');
  // Every terminal is a branch endpoint and every branch is a straight line.
  const endpoints = paths.flatMap((p) => [p[0], p[p.length - 1]]);
  for (const t of [{ x: -120, y: 0 }, { x: 200, y: -120 }, { x: 200, y: 120 }]) {
    assert.ok(endpoints.some((p) => p.x === t.x && p.y === t.y), `terminal (${t.x},${t.y}) is a branch endpoint`);
  }
  for (const p of paths) {
    assert.ok(p.length === 2, `branch is a straight arm, got ${JSON.stringify(p)}`);
    for (let i = 1; i < p.length; i++) {
      assert.ok(p[i].x === p[i - 1].x || p[i].y === p[i - 1].y, 'orthogonal');
    }
  }
});

test('steinerBranches junction mirrors when external is to the right of the pair', () => {
  // CMOS-inverter VOUT-style: drains share x=320, external at x=560.
  const paths = steinerBranches([
    { x: 320, y: -40 },
    { x: 320, y: 40 },
    { x: 560, y: 0 },
  ], EMPTY_ENV);
  const js = junctionOf(paths, [
    { x: 320, y: -40 },
    { x: 320, y: 40 },
    { x: 560, y: 0 },
  ]);
  assert.deepEqual(js, [{ x: 320, y: 0 }], 'junction at (320, 0)');
  const endpoints = paths.flatMap((p) => [p[0], p[p.length - 1]]);
  for (const t of [{ x: 560, y: 0 }, { x: 320, y: -40 }, { x: 320, y: 40 }]) {
    assert.ok(endpoints.some((p) => p.x === t.x && p.y === t.y), `terminal (${t.x},${t.y}) is a branch endpoint`);
  }
});

test('steinerBranches corner lands at the pair row for y-paired (top/bottom) pairs', () => {
  // Pair shares y=80, external at (80, 200): junction lands at (80, 80).
  const paths = steinerBranches([
    { x: 0, y: 80 },
    { x: 160, y: 80 },
    { x: 80, y: 200 },
  ], EMPTY_ENV);
  const js = junctionOf(paths, [
    { x: 0, y: 80 },
    { x: 160, y: 80 },
    { x: 80, y: 200 },
  ]);
  assert.deepEqual(js, [{ x: 80, y: 80 }], 'junction at (80, 80)');
  const endpoints = paths.flatMap((p) => [p[0], p[p.length - 1]]);
  for (const t of [{ x: 80, y: 200 }, { x: 0, y: 80 }, { x: 160, y: 80 }]) {
    assert.ok(endpoints.some((p) => p.x === t.x && p.y === t.y), `terminal (${t.x},${t.y}) is a branch endpoint`);
  }
});

test('steinerBranches splits a collinear triple at the middle terminal', () => {
  // All three on y=0: the middle terminal is a pass-through tap, so the tree is
  // two branches meeting at it (that point is a real electrical junction).
  const paths = steinerBranches([
    { x: 0, y: 0 },
    { x: 120, y: 0 },
    { x: 400, y: 0 },
  ], EMPTY_ENV);
  assert.equal(paths.length, 2, 'middle terminal splits the run into two branches');
  const flat = paths.flat();
  for (const p of flat) {
    assert.equal(p.y, 0);
    assert.equal(p.x % 40, 0);
  }
  assert.ok(flat.some((p) => p.x === 120 && p.y === 0), 'middle terminal is a branch endpoint');
});

test('steinerRoute returns one orthogonal polyline visiting every terminal', () => {
  const terminals = [
    { x: 200, y: -120 },
    { x: 200, y: 120 },
    { x: -120, y: 0 },
  ];
  const r = steinerRoute(terminals, EMPTY_ENV);
  assert.ok(r.some((p) => p.x === 200 && p.y === 0), 'steinerRoute polyline must visit (200, 0)');
  for (const t of terminals) {
    assert.ok(r.some((p) => p.x === t.x && p.y === t.y), `visits (${t.x},${t.y})`);
  }
  for (let i = 1; i < r.length; i++) {
    assert.ok(r[i].x === r[i - 1].x || r[i].y === r[i - 1].y, 'orthogonal');
  }
  allOnGrid(r);
});

test('steinerBranches finds the optimal tree for a 4-terminal rectangle', () => {
  // Corners of a 400x200 rectangle. Optimal rectilinear Steiner length is 800
  // (a Pi/H tree); a naive sequential path would be ~1000+. The DP must find
  // an 800-unit tree with a sparse junction structure.
  const terminals = [
    { x: 0, y: 0 },
    { x: 400, y: 0 },
    { x: 0, y: 200 },
    { x: 400, y: 200 },
  ];
  const paths = steinerBranches(terminals, EMPTY_ENV);
  const total = paths.reduce((s, p) => s + p.slice(1).reduce((a, b, i) => a + Math.abs(b.x - p[i].x) + Math.abs(b.y - p[i].y), 0), 0);
  assert.equal(total, 800, `optimal total length is 800, got ${total} (${JSON.stringify(paths)})`);
  const js = junctionOf(paths, terminals);
  assert.ok(js.length <= 2, `sparse junctions, got ${js.length} (${JSON.stringify(js)})`);
  // every terminal reachable as a branch endpoint
  const endpoints = paths.flatMap((p) => [p[0], p[p.length - 1]]);
  for (const t of terminals) {
    assert.ok(endpoints.some((p) => p.x === t.x && p.y === t.y), `terminal (${t.x},${t.y}) is a branch endpoint`);
  }
  for (const p of paths) for (let i = 1; i < p.length; i++) {
    assert.ok(p[i].x === p[i - 1].x || p[i].y === p[i - 1].y, 'orthogonal');
  }
});

test('steinerBranches routes around a blocking body with one-cell clearance', () => {
  // Three terminals on the row of a wide body that covers the middle: every
  // segment must stay a full grid cell clear of the body and never drill it.
  const body = { x: 40, y: -80, w: 400, h: 240 };
  const env = { rects: [body], pins: new Map(), wires: [], labelRects: [] };
  const terminals = [
    { x: 0, y: 0 },
    { x: 480, y: 0 },
    { x: 240, y: -160 },
  ];
  const paths = steinerBranches(terminals, env);
  assert.ok(paths.length >= 2, `a connected tree exists, got ${JSON.stringify(paths)}`);
  const dist = (a, b) => {
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
    const y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
    const dx = x0 > body.x + body.w ? x0 - (body.x + body.w) : x1 < body.x ? body.x - x1 : 0;
    const dy = y0 > body.y + body.h ? y0 - (body.y + body.h) : y1 < body.y ? body.y - y1 : 0;
    return Math.hypot(dx, dy);
  };
  for (const p of paths) {
    for (let i = 1; i < p.length; i++) {
      const a = p[i - 1], b = p[i];
      assert.ok(!segThroughInterior(a, b, body), 'no segment through the body');
      assert.ok(dist(a, b) >= 40, `segment keeps >=1 cell clearance (${dist(a, b)}): ${JSON.stringify(p)}`);
    }
  }
  allOnGrid(paths.flat());
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

test('segThroughInterior catches a fixed diagonal drilling through a body', () => {
  const body = { x: 40, y: 40, w: 160, h: 160 };
  assert.equal(segThroughInterior({ x: 0, y: 0 }, { x: 240, y: 240 }, body), true);
  assert.equal(segThroughInterior({ x: 0, y: 0 }, { x: 40, y: 40 }, body), false, 'corner touch is not interior');
  assert.equal(segThroughInterior({ x: 0, y: 40 }, { x: 240, y: 40 }, body), false, 'edge hug is not interior');
});
test('smartRoute permits a shared MOS gate bus through participating bodies only', () => {
  const left = { x: 0, y: -80, w: 120, h: 160 };
  const right = { x: 400, y: -80, w: 120, h: 160 };
  const env = {
    rects: [left, right],
    pins: new Map([
      ['0,0', { x: -1, y: 0 }],
      ['400,0', { x: -1, y: 0 }],
    ]),
    gatePassages: [
      { rect: left, point: { x: 0, y: 0 }, dir: { x: -1, y: 0 } },
      { rect: right, point: { x: 400, y: 0 }, dir: { x: -1, y: 0 } },
    ],
    wires: [],
  };
  const route = smartRoute({ x: 0, y: 0 }, { x: 400, y: 0 }, env);
  assert.deepEqual(route, [{ x: 0, y: 0 }, { x: 400, y: 0 }]);
  assert.equal(gateBodyCrossingAllowed(route[0], route[1], left, env), true);
  assert.equal(gateBodyCrossingAllowed(route[0], route[1], right, env), true);

  const singleGateEnv = { ...env, gatePassages: [env.gatePassages[0]] };
  const safeRoute = smartRoute({ x: 0, y: 0 }, { x: 400, y: 0 }, singleGateEnv);
  assert.ok(safeRoute.every((p, i) => i === 0 || !segThroughInterior(safeRoute[i - 1], p, left)));
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

test('smartRoute falls back to a safe A* route or reports a maze as unroutable', () => {
  // wall from (200,20) up beyond the target row, so the top channel is blocked
  const rects = [
    R(240, -40),
    { x: 240, y: -240, w: 80, h: 220 }, // vertical wall left of the gap
    { x: 400, y: -40, w: 80, h: 80 },   // seal the 360..480 gap at y=0
    R(640, -40),
  ];
  const pins = [pin(240, 0, -1, 0), pin(760, 0, 1, 0)];
  const pts = runRobots({ x: 240, y: 0 }, { x: 760, y: 0 }, rects, pins);
  // A bounded A* search may find only a route that violates the hard
  // clearance invariant near the adjacent wall. That is explicitly
  // unroutable rather than a reason to return an unsafe candidate.
  if (!pts) return;
  assert.deepEqual(pts[0], { x: 240, y: 0 });
  assert.deepEqual(pts[pts.length - 1], { x: 760, y: 0 });
  for (const rect of rects) {
    for (let i = 1; i < pts.length; i++) assert.equal(segThroughInterior(pts[i - 1], pts[i], rect), false);
  }
  allOnGrid(pts);
});

test('smartRoute never returns a body-interior candidate when outer channels are occupied', () => {
  // The body leaves no candidate channel in the enumerated window. Occupy all
  // outer horizontal channels in the bounded A* windows as well; an unsafe
  // direct candidate must not be returned when A* cannot provide a hard-safe
  // alternative.
  const body = { x: 0, y: -400, w: 160, h: 800 };
  const pins = new Map([
    ['0,0', { x: -1, y: 0 }],
    ['160,0', { x: 1, y: 0 }],
  ]);
  const wires = [];
  for (let y = -1600; y <= 1600; y += 40) {
    if (y !== 0) wires.push([{ x: -1600, y }, { x: 1760, y }]);
  }
  const route = smartRoute({ x: 0, y: 0 }, { x: 160, y: 0 }, { rects: [body], pins, wires });
  assert.ok(!route || route.every((p, i) => i === 0 || !segThroughInterior(route[i - 1], p, body)),
    `unroutable or body-safe route expected, got ${JSON.stringify(route)}`);
});

test('smartRoute preserves legal perpendicular crossings of existing wires', () => {
  const existing = [{ x: 20, y: -10000 }, { x: 20, y: 10000 }];
  const route = smartRoute({ x: 0, y: 0 }, { x: 40, y: 0 }, { rects: [], pins: new Map(), wires: [existing] });
  assert.ok(route && route.length >= 2, 'perpendicular crossing remains routable');
  assert.ok(route.some((p, i) => i > 0 && segmentsCross(route[i - 1], p, existing[0], existing[1])),
    `expected a legal perpendicular crossing, got ${JSON.stringify(route)}`);
});

test('smartRoute chooses a legal crossing over a wrong-side drain approach', () => {
  const body = { x: 0, y: -80, w: 120, h: 160 };
  const pins = new Map([
    ['0,80', { x: -1, y: 0 }],   // source route must leave west
    ['120,80', { x: 0, y: 1 }],  // another terminal on the body boundary
    ['120,-80', { x: 0, y: -1 }], // drain route must approach from above
  ]);
  const crossing = [{ x: 80, y: -160 }, { x: 80, y: -100 }];
  const wires = [crossing];
  // Occupy the other outer channels so the choice is between the crossing
  // route at y=-120 and the shorter boundary route through (120,80).
  for (let y = -440; y <= 40; y += 40) {
    if (y !== -120) wires.push([{ x: -40, y }, { x: 120, y }]);
  }
  const route = smartRoute({ x: 0, y: 80 }, { x: 120, y: -80 }, { rects: [body], pins, wires });
  assert.ok(route && route.length >= 2, 'a safe route exists');
  assert.deepEqual(
    { x: Math.sign(route[1].x - route[0].x), y: Math.sign(route[1].y - route[0].y) },
    { x: -1, y: 0 },
    `source escape must be west, got ${JSON.stringify(route)}`,
  );
  const last = route.length - 1;
  assert.deepEqual(
    { x: Math.sign(route[last].x - route[last - 1].x), y: Math.sign(route[last].y - route[last - 1].y) },
    { x: 0, y: 1 },
    `drain must be approached from its outward side, got ${JSON.stringify(route)}`,
  );
  assert.ok(route.some((p, i) => i > 0 && segmentsCross(route[i - 1], p, crossing[0], crossing[1])),
    `the legal route must cross the existing wire, got ${JSON.stringify(route)}`);
  for (let i = 1; i < route.length; i++) assert.equal(segThroughInterior(route[i - 1], route[i], body), false);
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

test('smartRoute leaves a bulk pin through its outward direction', () => {
  const env = {
    rects: [{ x: 0, y: -80, w: 120, h: 160 }],
    pins: new Map([['120,0', { x: 1, y: 0 }]]),
    wires: [],
  };
  const pts = smartRoute({ x: 120, y: 0 }, { x: 320, y: 240 }, env);
  const d = { x: pts[1].x - pts[0].x, y: pts[1].y - pts[0].y };
  assert.ok(d.x > 0, `first segment leaves bulk pin outward, got ${JSON.stringify(d)}`);
  assert.equal(d.y, 0, `bulk pin first segment is horizontal, got ${JSON.stringify(d)}`);
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
