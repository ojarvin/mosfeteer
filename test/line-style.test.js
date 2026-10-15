import test from 'node:test';
import assert from 'node:assert/strict';
import { arrowheadEnds, curvedArrowGeometry, defaultArrowhead, normalizeArrowhead, polylineArrowheadStyles, polylineArrowheadValue, polylineArrowheadValues, polylineArrowheads } from '../src/core/line-style.js';

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

test('a curved arrow leaves heading right: an S with room ahead, else a bow back', () => {
  const ahead = curvedArrowGeometry({ x: 0, y: 0 }, { x: 400, y: 240 });
  assert.equal(ahead.c1.y, 0, 'leaves level');
  assert.equal(ahead.c2.y, 240, 'arrives level');
  assert.ok(ahead.c2.x < 400, 'from the left');
  const below = curvedArrowGeometry({ x: 0, y: 0 }, { x: 0, y: 240 });
  assert.ok(below.c1.x > 0 && below.c2.x > 0, 'bows out to the right and comes back');
  // The head ends on the point; the shaft stops where it begins.
  assert.deepEqual(below.head.tip, { x: 0, y: 240 });
  assert.ok(Math.abs(Math.hypot(below.shaft.end.x, below.shaft.end.y - 240) - 26) < 2);
  assert.equal(curvedArrowGeometry({ x: 1, y: 1 }, { x: 1, y: 1 }), null);
});
