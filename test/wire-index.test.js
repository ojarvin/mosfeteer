import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWireHitIndex, queryWireHitIndex } from '../src/web/wire-index.js';

const net = (id, path) => ({ id, paths: () => [path] });

test('wire hit index filters by the nearer raw or snapped pointer', () => {
  const index = buildWireHitIndex([
    net('raw', [{ x: 0, y: 0 }, { x: 40, y: 0 }]),
    net('far', [{ x: 0, y: 80 }, { x: 40, y: 80 }]),
  ]);
  const hits = queryWireHitIndex(index, { x: 20, y: 15 }, { x: 20, y: 0 }, 12);
  assert.deepEqual(hits.map(hit => hit.net.id), ['raw']);
  assert.equal(hits[0].distance, 0);
});

test('wire hit index returns every segment near a shared pointer', () => {
  const index = buildWireHitIndex([
    net('horizontal', [{ x: 0, y: 0 }, { x: 80, y: 0 }]),
    net('vertical', [{ x: 40, y: -40 }, { x: 40, y: 40 }]),
  ]);
  const hits = queryWireHitIndex(index, { x: 40, y: 3 }, { x: 40, y: 0 }, 12);
  assert.deepEqual(hits.map(hit => hit.net.id), ['horizontal', 'vertical']);
});
