import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitArea, fitPlacement, paneCentre } from '../src/web/fit-area.js';

// A 1200×900 pane with the tool rail as a column at its top left.
const rail = { x0: 8, y0: 8, x1: 52, y1: 470 };

test('with nothing over the pane, the drawing fits the whole pane', () => {
  assert.deepEqual(fitArea(1200, 900, [], 400, 300, 16), { x0: 0, y0: 0, x1: 1200, y1: 900 });
});

test('a tall drawing fits beside the tool rail, over the full height', () => {
  assert.deepEqual(fitArea(1200, 900, [rail], 300, 900, 16), { x0: 52, y0: 0, x1: 1200, y1: 900 });
});

test('a wide drawing that fits under the tool rail goes there, over the full width', () => {
  assert.deepEqual(fitArea(1200, 900, [rail], 2400, 400, 16), { x0: 0, y0: 470, x1: 1200, y1: 900 });
});

test('an equally large fit takes the bigger area', () => {
  // Height-bound either way: beside the rail and the whole pane under a
  // short rail fit it the same, and the bigger rectangle wins.
  const shortRail = { x0: 8, y0: 8, x1: 52, y1: 60 };
  assert.deepEqual(fitArea(1200, 900, [shortRail], 100, 2000, 16), { x0: 52, y0: 0, x1: 1200, y1: 900 });
});

test('an open window on the right leaves the drawing the room beside it', () => {
  const window = { x0: 760, y0: 50, x1: 1190, y1: 880 };
  assert.deepEqual(fitArea(1200, 900, [rail, window], 1600, 700, 16), { x0: 0, y0: 470, x1: 760, y1: 900 });
  assert.deepEqual(fitArea(1200, 900, [rail, window], 700, 700, 16), { x0: 52, y0: 0, x1: 760, y1: 900 });
});

test('with no free room left, the drawing fits the whole pane', () => {
  assert.deepEqual(fitArea(1200, 900, [{ x0: 0, y0: 0, x1: 1200, y1: 900 }], 400, 300, 16), { x0: 0, y0: 0, x1: 1200, y1: 900 });
});

test('down the pane, a drawing under the rail stays on the pane middle while that clears the rail', () => {
  // Free from 470 to 900: a 200 px drawing at the middle (450) would reach
  // up to 350, level with the rail, so it moves down just enough: 470 + 16 + 100.
  assert.equal(paneCentre(900, 470, 900, 200, 16), 586);
  // On a taller pane the middle is already clear of the rail: it stays there.
  assert.equal(paneCentre(1400, 470, 1400, 200, 16), 700);
  // A drawing filling the whole stretch sits in its middle.
  assert.equal(paneCentre(900, 470, 900, 500, 16), 685);
});

// An L-shaped drawing: a row along the bottom, a block up the right, and its
// top-left corner empty.
const bounds = { x: 0, y: 0, w: 1600, h: 1000 };
const ell = [{ x: 0, y: 700, w: 1600, h: 300 }, { x: 1000, y: 0, w: 600, h: 700 }];
const onScreen = (r, at) => ({ x0: at.cx + (r.x - 800) * at.scale, y0: at.cy + (r.y - 500) * at.scale, x1: at.cx + (r.x + r.w - 800) * at.scale, y1: at.cy + (r.y + r.h - 500) * at.scale });
const apart = (a, b) => a.x1 <= b.x0 || a.x0 >= b.x1 || a.y1 <= b.y0 || a.y0 >= b.y1;

test('the rail may float over an empty corner of the drawing: it fits the whole pane, centred', () => {
  const at = fitPlacement(1200, 900, [rail], bounds, ell, 16);
  assert.equal(at.scale, Math.min(1168 / 1600, 868 / 1000));
  assert.deepEqual([at.cx, at.cy], [600, 450]);
});

test('ink where the rail is: the drawing moves or shrinks only as far as it takes to clear it', () => {
  const solid = [bounds];
  const at = fitPlacement(1200, 900, [rail], bounds, solid, 16);
  const full = Math.min(1168 / 1600, 868 / 1000);
  assert.ok(at.scale < full && at.scale > full * 0.9, JSON.stringify(at));
  assert.ok(apart(onScreen(bounds, at), { x0: rail.x0 - 16, y0: rail.y0 - 16, x1: rail.x1 + 16, y1: rail.y1 + 16 }), JSON.stringify(at));
});

test('beside an open window the ink stays clear of it, and the drawing is never smaller than its free area allows', () => {
  const window = { x0: 700, y0: 40, x1: 1190, y1: 880 };
  const at = fitPlacement(1200, 900, [rail, window], bounds, ell, 16);
  for (const r of ell) assert.ok(apart(onScreen(r, at), window), JSON.stringify(at));
  const area = fitArea(1200, 900, [rail, window], 1600, 1000, 16);
  assert.ok(at.scale >= Math.min((area.x1 - area.x0 - 32) / 1600, (area.y1 - area.y0 - 32) / 1000), JSON.stringify(at));
});

test('with no window open, a wide drawing stays on the middle line beside the rail rather than larger under it', () => {
  const wide = { x: 0, y: 0, w: 4800, h: 200 };
  const under = fitPlacement(1200, 900, [rail], wide, [wide], 16);
  const at = fitPlacement(1200, 900, [rail], wide, [wide], 16, { centred: true });
  assert.equal(at.cy, 450);
  assert.ok(at.scale < under.scale, JSON.stringify({ at, under }));
  assert.ok(at.cx - 2400 * at.scale >= rail.x1 + 16 - 0.5 && at.cx + 2400 * at.scale <= 1184 + 0.5, JSON.stringify(at));
});

test('with no window open, a drawing whose ink clears the rail on the middle line reaches under it', () => {
  // A row along the bottom: centred, it starts left of the rail's right edge, below the rail.
  const low = { x: 0, y: 0, w: 1600, h: 1000 };
  const row = [{ x: 0, y: 900, w: 1600, h: 100 }, { x: 1500, y: 0, w: 100, h: 900 }];
  const at = fitPlacement(1200, 900, [rail], low, row, 16, { centred: true });
  assert.equal(at.cy, 450);
  assert.equal(at.scale, Math.min(1168 / 1600, 868 / 1000));
  assert.equal(at.cx - 800 * at.scale < rail.x1, true, JSON.stringify(at));
});

test('with no window open, ink on the rail moves the drawing sideways only', () => {
  const at = fitPlacement(1200, 900, [rail], bounds, [bounds], 16, { centred: true });
  assert.equal(at.cy, 450);
  assert.ok(apart(onScreen(bounds, at), { x0: rail.x0 - 16, y0: rail.y0 - 16, x1: rail.x1 + 16, y1: rail.y1 + 16 }), JSON.stringify(at));
});

test('with a window open, centring changes nothing: the drawing may move down under the rail', () => {
  const window = { x0: 900, y0: 40, x1: 1190, y1: 300 };
  const wide = { x: 0, y: 0, w: 4800, h: 200 };
  const at = fitPlacement(1200, 900, [rail, window], wide, [wide], 16);
  assert.ok(at.cy > 450, JSON.stringify(at));
  assert.ok(at.cx - 2400 * at.scale < rail.x1, JSON.stringify(at));
});

test('a rail across the top leaves no full-height room: the drawing moves down below it', () => {
  const strip = { x0: 8, y0: 8, x1: 1192, y1: 52 };
  const at = fitPlacement(1200, 900, [strip], bounds, [bounds], 16, { centred: true });
  assert.ok(onScreen(bounds, at).y0 >= strip.y1 + 16 - 0.5, JSON.stringify(at));
});
