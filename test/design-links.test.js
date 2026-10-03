import test from 'node:test';
import assert from 'node:assert/strict';
import { linkArrow, linkGraph } from '../src/core/design-links.js';

test('linkGraph joins designs by the names their parts link to', () => {
  const { edges, children, parents } = linkGraph([
    { id: 'a.json', name: 'system', links: ['ota', 'bias', 'ota', 'gone'] },
    { id: 'b.json', name: 'ota', links: ['bias', 'ota'] },
    { id: 'c.json', name: 'bias', links: [] },
    { id: 'd.json', name: 'adc', links: ['ota'] },
  ]);
  // Each pair once; a link to itself or to a missing design joins nothing.
  assert.deepEqual(edges, [
    { from: 'a.json', to: 'b.json' },
    { from: 'a.json', to: 'c.json' },
    { from: 'b.json', to: 'c.json' },
    { from: 'd.json', to: 'b.json' },
  ]);
  assert.deepEqual(children.get('a.json'), ['b.json', 'c.json']);
  assert.deepEqual(parents.get('b.json'), ['a.json', 'd.json']);
  assert.deepEqual(parents.get('a.json'), []);
});

test('a name two designs share resolves to the first, as a link does', () => {
  const { edges } = linkGraph([
    { id: 'x/ota.json', name: 'ota', links: [] },
    { id: 'y/ota.json', name: 'ota', links: [] },
    { id: 'top.json', name: 'top', links: ['ota'] },
  ]);
  assert.deepEqual(edges, [{ from: 'top.json', to: 'x/ota.json' }]);
});

test('linkArrow runs between tile edges along the centre line, a gap outside each', () => {
  const left = { x: 0, y: 0, w: 100, h: 100 };
  const right = { x: 300, y: 0, w: 100, h: 100 };
  assert.deepEqual(linkArrow(left, right, 10), { x1: 110, y1: 50, x2: 290, y2: 50 });
  const below = { x: 0, y: 300, w: 100, h: 50 };
  assert.deepEqual(linkArrow(left, below, 0), { x1: 50, y1: 100, x2: 50, y2: 300 });
  // Diagonal: leaves through the nearer edge.
  const corner = linkArrow(left, { x: 300, y: 300, w: 100, h: 100 });
  assert.deepEqual([corner.x1, corner.y1, corner.x2, corner.y2], [100, 100, 300, 300]);
  // Close neighbours still get a short arrow, its gaps shrunk to fit.
  assert.deepEqual(linkArrow(left, { x: 108, y: 0, w: 100, h: 100 }, 10), { x1: 102, y1: 50, x2: 106, y2: 50 });
  // Overlapping or touching tiles have no room for an arrow.
  assert.equal(linkArrow(left, { x: 50, y: 0, w: 100, h: 100 }, 0), null);
  assert.equal(linkArrow(left, { x: 100, y: 0, w: 100, h: 100 }, 10), null);
});
