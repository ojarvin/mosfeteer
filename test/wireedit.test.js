import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wireRunAt, collapseCollinear, moveWireRun } from '../src/core/wireedit.js';
import { onGrid } from '../src/core/grid.js';

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
