import test from 'node:test';
import assert from 'node:assert/strict';
import { PLACE, clearOfOthers, floatingWindowPosition } from '../src/web/floating-window.js';

test('a floating window goes where it was put, or its default place, and stays in the pane', () => {
  const pane = { w: 1000, h: 600 };
  const size = { w: 300, h: 200 };
  assert.deepEqual(floatingWindowPosition(pane, size, null, PLACE.bottomCenter), { x: 350, y: 388 });
  assert.deepEqual(floatingWindowPosition(pane, size, { x: 120, y: 40 }, PLACE.bottomCenter), { x: 120, y: 40 });
  // Dragged (or left, by a pane that shrank) past an edge, it is pulled back in.
  assert.deepEqual(floatingWindowPosition(pane, size, { x: 900, y: -50 }, PLACE.topRight), { x: 692, y: 8 });
  // A window bigger than the pane keeps its title bar in reach.
  assert.deepEqual(floatingWindowPosition({ w: 200, h: 100 }, size, { x: 50, y: 50 }, PLACE.topRight), { x: 8, y: 8 });
  // Never over the tool rail: beside it when level with it, free below it.
  const rail = { x: 8, y: 8, w: 44, h: 300 };
  assert.deepEqual(floatingWindowPosition(pane, size, { x: 10, y: 40 }, PLACE.topRight, rail), { x: 60, y: 40 });
  assert.deepEqual(floatingWindowPosition(pane, size, { x: 10, y: 380 }, PLACE.topRight, rail), { x: 10, y: 380 });
  // With no room beside it, the window goes under it instead.
  assert.deepEqual(floatingWindowPosition({ w: 320, h: 600 }, size, { x: 10, y: 40 }, PLACE.topRight, rail), { x: 10, y: 316 });
});

test('a window opening where another is goes beside it, else a step down and left; clear, it stays', () => {
  const pane = { w: 1200, h: 800 };
  const size = { w: 400, h: 500 };
  const at = { x: 748, y: 8 };
  assert.deepEqual(clearOfOthers(pane, size, at, []), at);
  // The analysis window where the plots would open: the plots go left of it.
  const analysis = { x: 748, y: 8, w: 440, h: 700 };
  assert.deepEqual(clearOfOthers(pane, size, at, [analysis]), { x: 340, y: 8 });
  // No room beside it: cascaded, the least covered place in the pane.
  const wide = { x: 100, y: 8, w: 1092, h: 700 };
  const cascaded = clearOfOthers(pane, size, at, [wide]);
  assert.ok(cascaded.x < at.x && cascaded.y > at.y, JSON.stringify(cascaded));
  assert.ok(cascaded.y + size.h <= pane.h - 8);
});
