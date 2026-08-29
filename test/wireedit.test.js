import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wireRunAt, collapseCollinear, moveWireRun } from '../src/core/wireedit.js';
import { deleteWireSegment, junctionPoints, normalizePath, reduceBranches } from '../src/core/wiring.js';
import { onGrid } from '../src/core/grid.js';
import { Circuit } from '../src/core/model.js';

function ortho(pts) {
  for (let i = 1; i < pts.length; i++) {
    assert.ok(pts[i].x === pts[i - 1].x || pts[i].y === pts[i - 1].y, `orthogonal segment ${i}: ${JSON.stringify(pts)}`);
  }
  for (const p of pts) assert.ok(onGrid(p.x) && onGrid(p.y), `on grid (${p.x},${p.y})`);
}

test('wireRunAt returns the maximal collinear run of a segment', () => {
  const pts = [{ x: 0, y: 0 }, { x: 0, y: 40 }, { x: 200, y: 40 }, { x: 200, y: 80 }, { x: 400, y: 80 }, { x: 400, y: 0 }];
  const h = wireRunAt(pts, 2); // seg[1]->seg[2] is the horizontal y=40 run
  assert.deepEqual(h, { lo: 1, hi: 2, orient: 'h', val: 40 });
  const v = wireRunAt(pts, 1); // vertical x=0 lead
  assert.deepEqual(v, { lo: 0, hi: 1, orient: 'v', val: 0 });
});

test('dragging an interior run into line with a neighbouring run collapses the corner', () => {
  const pts = [
    { x: 0, y: 0 }, { x: 0, y: 40 }, { x: 200, y: 40 },
    { x: 200, y: 80 }, { x: 400, y: 80 }, { x: 400, y: 0 },
  ];
  // drag the y=40 horizontal run down to y=80 (the neighbouring run) -> collapse
  moveWireRun(pts, 'h', 40, 80);
  // the x=200 jog vanishes and the two horizontal runs merge into one
  assert.deepEqual(pts, [{ x: 0, y: 0 }, { x: 0, y: 80 }, { x: 400, y: 80 }, { x: 400, y: 0 }]);
  ortho(pts);
  assert.deepEqual(pts[0], { x: 0, y: 0 }, 'terminal A fixed');
  assert.deepEqual(pts[pts.length - 1], { x: 400, y: 0 }, 'terminal B fixed');
});

test('dragging a run up to collapse removes every now-invisible collinear vertex', () => {
  const pts = [
    { x: 0, y: 0 }, { x: 0, y: 40 }, { x: 40, y: 40 }, { x: 40, y: 80 },
    { x: 240, y: 80 }, { x: 240, y: 0 },
  ];
  moveWireRun(pts, 'v', 40, 0); // x=40 vertical run left to x=0 -> collapse the staircase
  ortho(pts);
  assert.deepEqual(pts[0], { x: 0, y: 0 });
  assert.deepEqual(pts[pts.length - 1], { x: 240, y: 0 });
  assert.ok(pts.length < 5, `staircase collapsed, got ${JSON.stringify(pts)}`);
});

test('dragging a run touching a terminal endpoint keeps the pin fixed and EXTENDS the wire', () => {
  const pts = [
    { x: 0, y: 0 }, { x: 0, y: 80 }, { x: 80, y: 80 }, { x: 80, y: 160 },
    { x: 240, y: 160 }, { x: 240, y: 0 },
  ];
  // drag the vertical lead at x=0 (which holds the fixed terminal (0,0)) to x=40
  moveWireRun(pts, 'v', 0, 40);
  // pin stays fixed; an added horizontal segment (0,0)->(40,0) reconnects
  assert.deepEqual(pts[0], { x: 0, y: 0 }, 'terminal pin never moves');
  assert.deepEqual(pts[1], { x: 40, y: 0 }, 'added connector segment retains the pin');
  assert.deepEqual(pts[2], { x: 40, y: 80 }, 'the moved run continues');
  ortho(pts);
});

test('a run cannot slide past a neighbour (no inverted fold)', () => {
  const pts = [
    { x: 0, y: 0 }, { x: 0, y: 80 }, { x: 200, y: 80 }, { x: 200, y: 0 },
  ];
  // the y=80 run is bounded by the two terminal leads (y=0); it cannot pass through
  moveWireRun(pts, 'h', 80, -999);
  assert.deepEqual(pts[0], { x: 0, y: 0 });
  assert.deepEqual(pts[pts.length - 1], { x: 200, y: 0 });
  assert.ok(pts[1].y >= 0, `run stayed above the terminal lead, got ${JSON.stringify(pts)}`);
  ortho(pts);
});

test('collapseCollinear removes duplicates and collinear middles, preserving endpoints', () => {
  const pts = [{ x: 0, y: 0 }, { x: 0, y: 40 }, { x: 0, y: 80 }, { x: 100, y: 80 }, { x: 200, y: 80 }, { x: 200, y: 0 }];
  collapseCollinear(pts);
  // x=0 middle point and the y=80 middle point both removed, endpoints kept
  assert.deepEqual(pts, [{ x: 0, y: 0 }, { x: 0, y: 80 }, { x: 200, y: 80 }, { x: 200, y: 0 }]);
});

test('collapseCollinear preserves endpoints even when they coincide with an interior line', () => {
  const pts = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 200, y: 0 }];
  collapseCollinear(pts);
  assert.deepEqual(pts, [{ x: 0, y: 0 }, { x: 200, y: 0 }]);
});

test('normalizePath produces a minimal orthogonal grid path', () => {
  assert.deepEqual(normalizePath([{ x: 1, y: 1 }, { x: 40, y: 1 }, { x: 80, y: 1 }, { x: 80, y: 80 }]), [
    { x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 80 },
  ]);
});

test('normalizePath keeps a terminal out-and-back (route reversal is a real vertex)', () => {
  // A balanced 3-way junction route visits a terminal by running out and back:
  // (360,120) -> (120,120) -> (120,80) -> (120,120). The middle point is a
  // collinear REVERSAL that must be preserved, otherwise the terminal's wire
  // leg silently disappears from the loaded/render path.
  const path = [
    { x: 360, y: 160 }, { x: 360, y: 120 }, { x: 120, y: 120 }, { x: 120, y: 80 },
    { x: 120, y: 120 }, { x: 600, y: 120 }, { x: 600, y: 80 },
  ];
  assert.deepEqual(normalizePath(path), [
    { x: 360, y: 160 }, { x: 360, y: 120 }, { x: 120, y: 120 }, { x: 120, y: 80 },
    { x: 120, y: 120 }, { x: 600, y: 120 }, { x: 600, y: 80 },
  ]);
});

test('deleting a segment splits a branch without moving its remaining geometry', () => {
  const paths = [[{ x: 0, y: 0 }, { x: 0, y: 80 }, { x: 160, y: 80 }]];
  const next = deleteWireSegment(paths, 0, 1);
  assert.deepEqual(next, [
    [{ x: 0, y: 80 }, { x: 160, y: 80 }],
  ]);
  assert.ok(!next.flat().some((p, i, all) => i && p.x === all[i - 1].x && p.y === all[i - 1].y), 'no duplicate join segment');
});

test('reduceBranches keeps the cheapest of two parallel paths', () => {
  const straight = [{ x: 160, y: 0 }, { x: 400, y: 0 }]; // cost 240
  const detour = [{ x: 160, y: 0 }, { x: 160, y: -80 }, { x: 400, y: -80 }, { x: 400, y: 0 }]; // cost 400
  assert.deepEqual(reduceBranches([straight, detour], [{ x: 160, y: 0 }, { x: 400, y: 0 }]), [straight]);
  // order-independent: the detour never wins
  assert.deepEqual(reduceBranches([detour, straight], [{ x: 160, y: 0 }, { x: 400, y: 0 }]), [straight]);
});

test('reduceBranches breaks a closed loop into a tree', () => {
  const loop = [{ x: 0, y: 0 }, { x: 0, y: 80 }, { x: 160, y: 80 }, { x: 160, y: 0 }, { x: 0, y: 0 }];
  const reduced = reduceBranches([loop], [{ x: 0, y: 0 }, { x: 160, y: 0 }]);
  // a tree on 4 vertices: 3 edges (a path), no closed loop
  assert.equal(reduced.length, 1);
  const pts = reduced[0];
  assert.equal(pts.length, 4, `loop reduced to an open path, got ${JSON.stringify(pts)}`);
  assert.deepEqual(pts[0], { x: 0, y: 0 });
  assert.deepEqual(pts[pts.length - 1], { x: 160, y: 0 });
  for (let i = 1; i < pts.length; i++) {
    assert.ok(pts[i].x === pts[i - 1].x || pts[i].y === pts[i - 1].y, 'orthogonal');
  }
});

test('reduceBranches is deterministic on equal-cost ties (older branch wins)', () => {
  const top = [{ x: 160, y: 0 }, { x: 160, y: -80 }, { x: 400, y: -80 }, { x: 400, y: 0 }];
  const bottom = [{ x: 160, y: 0 }, { x: 160, y: 80 }, { x: 400, y: 80 }, { x: 400, y: 0 }];
  const terminals = [{ x: 160, y: 0 }, { x: 400, y: 0 }];
  assert.deepEqual(reduceBranches([top, bottom], terminals), [top], 'first-drawn equal path survives');
  assert.deepEqual(reduceBranches([bottom, top], terminals), [bottom]);
});

test('reduceBranches is idempotent and keeps a clean tree untouched', () => {
  const t = [
    [{ x: 160, y: 0 }, { x: 280, y: 0 }],
    [{ x: 280, y: 0 }, { x: 400, y: 0 }],
    [{ x: 280, y: 0 }, { x: 280, y: -120 }, { x: 440, y: -120 }, { x: 440, y: -200 }],
  ];
  const terminals = [{ x: 160, y: 0 }, { x: 400, y: 0 }, { x: 440, y: -200 }];
  const once = reduceBranches(t, terminals);
  assert.deepEqual(once, t, 'a tree is returned unchanged');
  assert.deepEqual(reduceBranches(once, terminals), once, 'reducing twice is a no-op');
});

test('reduceBranches merges a run dragged onto a same-net wire (no hidden overlap)', () => {
  // Main wire (0,0)-(400,0); an L-shaped branch was dragged so its horizontal
  // run lies ON the main wire over (80,0)-(320,0), with a stub going down at
  // x=80. The overlap must merge: one wire + the stub T, no double-drawn span.
  const main = [{ x: 0, y: 0 }, { x: 400, y: 0 }];
  const dragged = [{ x: 80, y: -80 }, { x: 80, y: 0 }, { x: 320, y: 0 }];
  const terminals = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 80, y: -80 }];
  const reduced = reduceBranches([main, dragged], terminals);
  const flat = reduced.flat();
  // No segment of any branch lies on top of another branch's segment.
  const segments = [];
  for (const b of reduced) for (let i = 1; i < b.length; i++) segments.push([b[i - 1], b[i]]);
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const [a, b] = segments[i];
      const [c, d] = segments[j];
      const shared = (x, y) => {
        if (a.x === b.x && c.x === d.x && a.x === c.x) {
          const lo = Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y));
          const hi = Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y));
          return hi > lo && x === a.x && y >= lo && y <= hi;
        }
        if (a.y === b.y && c.y === d.y && a.y === c.y) {
          const lo = Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x));
          const hi = Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x));
          return hi > lo && y === a.y && x >= lo && x <= hi;
        }
        return false;
      };
      assert.ok(!shared(0, 0), `no collinear overlap between branches ${i} and ${j}`);
    }
  }
  // The stub survives as a T at (80,0); the overlap span is drawn exactly once
  // (the junction point is shared by the bus and the stub branches).
  assert.ok(flat.some((p) => p.x === 80 && p.y === -80), 'stub end survives');
  assert.ok(flat.some((p) => p.x === 80 && p.y === 0), 'the T point exists');
  assert.ok(reduced.length >= 2, `main wire + stub, got ${JSON.stringify(reduced)}`);
});

test('reduceBranches merges contained and extending overlaps into the union wire', () => {
  // wire2 entirely inside wire1's span: the inner run is redundant.
  const r1 = reduceBranches(
    [[{ x: 0, y: 0 }, { x: 400, y: 0 }], [{ x: 40, y: 0 }, { x: 120, y: 0 }]],
    [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 40, y: 0 }, { x: 120, y: 0 }]
  );
  assert.deepEqual(r1, [
    [{ x: 0, y: 0 }, { x: 40, y: 0 }],
    [{ x: 40, y: 0 }, { x: 120, y: 0 }],
    [{ x: 120, y: 0 }, { x: 400, y: 0 }],
  ], 'inner wire merges into the outer one (single drawn path)');

  // wire2 overlaps the middle AND extends past the right end: the extension
  // survives, the overlap merges.
  const r2 = reduceBranches(
    [[{ x: 0, y: 0 }, { x: 400, y: 0 }], [{ x: 80, y: 0 }, { x: 480, y: 0 }]],
    [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 80, y: 0 }, { x: 480, y: 0 }]
  );
  assert.deepEqual(r2, [
    [{ x: 0, y: 0 }, { x: 80, y: 0 }],
    [{ x: 80, y: 0 }, { x: 400, y: 0 }],
    [{ x: 400, y: 0 }, { x: 480, y: 0 }],
  ], 'overlap merged, extension kept');
});

test('shift-selecting runs in two nets and dragging them together moves both (editor path)', () => {
  // Mirrors the multi-segment wire drag: two L-shaped wires (one per net),
  // select a horizontal run in each, drag both down by the same delta with
  // moveWireRun, then persist exactly like canvasMouseUp (rerouteNet +
  // _reduceNet). Both nets must stay connected and both runs must move.
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 0, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 240, y: 0 });
  c.addComponent('resistor', { refdes: 'R3', x: 0, y: 160 });
  c.addComponent('resistor', { refdes: 'R4', x: 240, y: 160 });
  const n1 = c.connect('R1.b', 'R2.a'); // (160,0)..(240,0) straight
  const n2 = c.connect('R3.b', 'R4.a'); // (160,160)..(240,160) straight
  // Force each net to an explicit L-shaped route so it has a draggable run.
  n1.branches = [[{ x: 160, y: 0 }, { x: 160, y: 80 }, { x: 240, y: 80 }]];
  n1.route = n1.branches[0].map((p) => ({ ...p }));
  n2.branches = [[{ x: 160, y: 160 }, { x: 160, y: 240 }, { x: 240, y: 240 }]];
  n2.route = n2.branches[0].map((p) => ({ ...p }));

  // The two horizontal runs live at y=80 and y=240; drag them both to y=120/280.
  const run1 = n1.branches[0].map((p) => ({ ...p }));
  const run2 = n2.branches[0].map((p) => ({ ...p }));
  assert.equal(moveWireRun(run1, 'h', 80, 120), 120);
  assert.equal(moveWireRun(run2, 'h', 240, 280), 280);
  n1.branches[0] = run1;
  n1.route = run1.map((p) => ({ ...p }));
  n2.branches[0] = run2;
  n2.route = run2.map((p) => ({ ...p }));
  for (const n of [n1, n2]) {
    c.rerouteNet(n);
    c._reduceNet(n);
  }
  // Both runs moved; both nets still connect their terminals.
  assert.ok(n1.branches[0].some((p) => p.x === 160 && p.y === 120), 'run1 moved to y=120');
  assert.ok(n2.branches[0].some((p) => p.x === 160 && p.y === 280), 'run2 moved to y=280');
  assert.ok(c.netOfTerminal('R1.b') === n1 && c.netOfTerminal('R2.a') === n1, 'n1 stays connected');
  assert.ok(c.netOfTerminal('R3.b') === n2 && c.netOfTerminal('R4.a') === n2, 'n2 stays connected');
  for (const n of [n1, n2]) {
    for (const b of n.branches) for (let i = 1; i < b.length; i++) {
      assert.ok(b[i].x === b[i - 1].x || b[i].y === b[i - 1].y, 'orthogonal');
    }
  }
});
