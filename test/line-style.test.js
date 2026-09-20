import test from 'node:test';
import assert from 'node:assert/strict';
import { arrowheadEnds, defaultArrowhead, normalizeArrowhead, polylineArrowheads } from '../src/core/line-style.js';

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
