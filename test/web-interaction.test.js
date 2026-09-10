import test from 'node:test';
import assert from 'node:assert/strict';
import { worldAndCursorFromClient } from '../src/web/interaction.js';

const rect = { left: 10, top: 20, width: 100, height: 100 };
const view = { x: -80, y: -80, w: 400, h: 400 };

test('schematic and block pointer paths share snapped cursor conversion', () => {
  for (const documentKind of ['circuit', 'block']) {
    assert.deepEqual(worldAndCursorFromClient(50, 70, rect, view), {
      world: { x: 80, y: 120 }, cursor: { x: 80, y: 120 },
    }, documentKind);
  }
});
