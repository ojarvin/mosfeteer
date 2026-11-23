import test from 'node:test';
import assert from 'node:assert/strict';
import { arrowheadEnds, bentArrowheads, bentCurve, curvedArrowGeometry, defaultArrowhead, normalizeArrowhead, polylineArrowheadStyles, polylineArrowheadValue, polylineArrowheadValues, polylineArrowheads } from '../src/core/line-style.js';

test('the shared arrowhead choice has one shape and four endpoint placements', () => {
  assert.deepEqual(arrowheadEnds('none'), { start: false, end: false });
  assert.deepEqual(arrowheadEnds('start'), { start: true, end: false });
  assert.deepEqual(arrowheadEnds('end'), { start: false, end: true });
  assert.deepEqual(arrowheadEnds('both'), { start: true, end: true });
  assert.equal(normalizeArrowhead('triangle'), 'none');
  assert.equal(normalizeArrowhead('triangle', 'end'), 'end');
  assert.equal(defaultArrowhead('arrow'), 'end');
  assert.equal(defaultArrowhead('line'), 'none');
});

test('polyline arrowheads shorten only the decorated endpoints', () => {
  const route = [{ x: 0, y: 0 }, { x: 0, y: 160 }, { x: 240, y: 160 }];
  const none = polylineArrowheads(route, 'none');
  assert.deepEqual(none.shaftPoints, route);
  assert.deepEqual(none.heads, []);

  const start = polylineArrowheads(route, 'start');
  assert.deepEqual(start.shaftPoints, [{ x: 0, y: 32 }, { x: 0, y: 160 }, { x: 240, y: 160 }]);
  assert.equal(start.heads.length, 1);
  assert.deepEqual(start.heads[0].tip, { x: 0, y: 0 });

  const both = polylineArrowheads(route, 'both');
  assert.deepEqual(both.shaftPoints, [{ x: 0, y: 32 }, { x: 0, y: 160 }, { x: 208, y: 160 }]);
  assert.equal(both.heads.length, 2);
  assert.deepEqual(both.heads.map((head) => head.tip), [{ x: 0, y: 0 }, { x: 240, y: 160 }]);
});

test('a shared arrowhead choice skips polyline corner points', () => {
  const route = [{ x: 0, y: 0 }, { x: 160, y: 0 }, { x: 160, y: 160 }];
  assert.deepEqual(polylineArrowheadValues(route, 'start'), ['start', 'none']);
  assert.deepEqual(polylineArrowheadValues(route, 'end'), ['none', 'end']);
  assert.deepEqual(polylineArrowheadValues(route, 'both'), ['start', 'end']);
  assert.deepEqual(polylineArrowheadValues([{ x: 0, y: 0 }, { x: 160, y: 0 }], 'both'), ['both']);
  assert.deepEqual(polylineArrowheadStyles({ '0:1': { color: '#d00' } }, 0, route, 'end'), {
    '0:1': { color: '#d00', arrowhead: 'none' },
    '0:2': { arrowhead: 'end' },
  });
  assert.equal(polylineArrowheadValue({ '0:1': { arrowhead: 'end' } }, 0, route), 'end');
});

test('arrowhead tip insets pull the filled point back from a stroked target', () => {
  const geometry = polylineArrowheads([{ x: 0, y: -240 }, { x: 0, y: -80 }], 'end', { endInset: 4.8 });
  assert.deepEqual(geometry.heads[0].tip, { x: 0, y: -84.8 });
  assert.deepEqual(geometry.heads[0].shaft, { x: 0, y: -116.8 });
});

test('a curved arrow always leaves heading right and arrives from the left, its head level', () => {
  for (const end of [{ x: 400, y: 240 }, { x: 0, y: 240 }, { x: -80, y: 120 }, { x: 40, y: 120 }]) {
    const curve = curvedArrowGeometry({ x: 0, y: 0 }, end);
    assert.equal(curve.c1.y, 0, 'leaves level');
    assert.ok(curve.c1.x > 0, 'to the right');
    assert.equal(curve.shaft.c2.y, end.y, 'arrives level');
    assert.ok(curve.shaft.c2.x < curve.shaft.end.x, 'from the left');
    // The head ends on the point, level, the shaft stopping where it begins.
    assert.deepEqual(curve.head.tip, end);
    assert.deepEqual(curve.shaft.end, { x: end.x - 26, y: end.y });
    assert.equal(curve.head.left.y - end.y, -(curve.head.right.y - end.y));
  }
  // Turning back takes it further out.
  assert.ok(curvedArrowGeometry({ x: 0, y: 0 }, { x: 0, y: 120 }).c1.x > curvedArrowGeometry({ x: 0, y: 0 }, { x: 80, y: 120 }).c1.x);
  assert.equal(curvedArrowGeometry({ x: 1, y: 1 }, { x: 1, y: 1 }), null);
});

test('a bent curve runs from end to end through its middle point', () => {
  const curve = bentCurve({ x: 0, y: 0 }, { x: 80, y: 40 }, { x: 0, y: 160 });
  assert.deepEqual(curve.at(0), { x: 0, y: 0 });
  assert.deepEqual(curve.at(0.5), { x: 80, y: 40 });
  assert.deepEqual(curve.at(1), { x: 0, y: 160 });
  assert.deepEqual(curve.c, { x: 160, y: 0 });
});

test("a bent arrow's heads lie on the curve a head's length from each tip, its shaft cut back to them", () => {
  const points = [{ x: 0, y: 0 }, { x: 80, y: 80 }, { x: 0, y: 160 }];
  const curve = bentCurve(...points);
  const both = bentArrowheads(points, 'both', { length: 32 });
  assert.deepEqual(both.heads.map((head) => head.placement), ['start', 'end']);
  for (const head of both.heads) {
    assert.ok(Math.abs(Math.hypot(head.tip.x - head.shaft.x, head.tip.y - head.shaft.y) - 32) < 1e-6);
  }
  assert.deepEqual(both.heads[1].tip, { x: 0, y: 160 });
  // The shaft is a piece of the same curve: its middle lies on it.
  const { start, c, end } = both.shaft;
  const middle = { x: (start.x + 2 * c.x + end.x) / 4, y: (start.y + 2 * c.y + end.y) / 4 };
  const near = Array.from({ length: 1001 }, (_, i) => curve.at(i / 1000)).some((p) => Math.hypot(p.x - middle.x, p.y - middle.y) < 0.5);
  assert.ok(near);
  assert.ok(Math.hypot(both.shaft.end.x - both.heads[1].shaft.x, both.shaft.end.y - both.heads[1].shaft.y) < 1e-6);
  // No heads: the whole curve.
  const none = bentArrowheads(points, 'none');
  assert.deepEqual([none.heads, none.shaft.start, none.shaft.end], [[], points[0], points[2]]);
  assert.deepEqual(none.shaft.c, curve.c);
});
