import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ATLAS_CAPTION, ATLAS_GAP, LARGE_PX, SMALL_PX, layoutAtlas, neighbourTile, rectsIntersect, tileAt, tileDetail, viewFitting, viewShowing } from '../src/web/atlas-layout.js';

const items = [
  { id: 'a', w: 1200, h: 1800 },
  { id: 'b', w: 900, h: 900 },
  { id: 'c', w: 4000, h: 6000 },
  { id: 'd', w: 1700, h: 2500 },
  { id: 'e', w: 2300, h: 1300 },
];
// A workspace's worth of ordinary designs.
const many = Array.from({ length: 12 }, (_, index) => ({ id: `d${index}`, w: 1200 + (index % 4) * 320, h: 1000 + (index % 3) * 480 }));

test('designs keep their real size and never crowd each other', () => {
  const { tiles, bounds } = layoutAtlas(many);
  assert.deepEqual(tiles.map((tile) => tile.id), many.map((item) => item.id), 'tiles come back in input order');
  for (const [index, tile] of tiles.entries()) {
    assert.equal(tile.w, many[index].w);
    assert.equal(tile.h, many[index].h);
    assert.ok(tile.x >= bounds.x && tile.x + tile.w <= bounds.x + bounds.w);
    assert.ok(tile.y >= bounds.y && tile.y + tile.h + ATLAS_CAPTION <= bounds.y + bounds.h);
  }
  for (const a of tiles) {
    for (const b of tiles) {
      if (a === b) continue;
      // The design plus its caption band, and the gap around it.
      const room = { x: a.x - ATLAS_GAP + 1, y: a.y - ATLAS_GAP + 1, w: a.w + 2 * ATLAS_GAP - 2, h: a.h + ATLAS_CAPTION + 2 * ATLAS_GAP - 2 };
      assert.ok(!rectsIntersect(room, { ...b, h: b.h + ATLAS_CAPTION }), `${a.id} crowds ${b.id}`);
    }
  }
});

test('the designs pack into a tight, screen-shaped ball on the grid', () => {
  const tall = [...many, { id: 'symbols', w: 4200, h: 6240 }];
  const { tiles, bounds } = layoutAtlas(tall, { aspect: 1.6 });
  const used = tiles.reduce((sum, tile) => sum + tile.w * (tile.h + ATLAS_CAPTION), 0);
  assert.ok(used / (bounds.w * bounds.h) > 0.5, `fill ${used / (bounds.w * bounds.h)}`);
  assert.ok(bounds.w / bounds.h > 1 && bounds.w / bounds.h < 2.6, `${bounds.w} x ${bounds.h}`);
  for (const tile of tiles) assert.ok(tile.x % 40 === 0 && tile.y % 40 === 0, `${tile.id} is off the grid`);
  // The largest design sits in the middle.
  const big = tiles.find((tile) => tile.id === 'symbols');
  const middle = { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };
  assert.ok(Math.abs(big.x + big.w / 2 - middle.x) < bounds.w / 4 && Math.abs(big.y + big.h / 2 - middle.y) < bounds.h / 4);
});

test('the same designs always get the same layout', () => {
  assert.deepEqual(layoutAtlas(many), layoutAtlas(many.map((item) => ({ ...item }))));
  assert.deepEqual(layoutAtlas([]).tiles, []);
});

test('detail grows with the pixels a tile covers', () => {
  assert.equal(tileDetail(10), 'small');
  assert.equal(tileDetail(SMALL_PX), 'small');
  assert.equal(tileDetail(LARGE_PX), 'large');
  assert.equal(tileDetail(LARGE_PX * 2), 'vector');
});

test('picking and arrow navigation find the right tile', () => {
  const a = { id: 'a', x: 0, y: 0, w: 400, h: 400 };
  const b = { id: 'b', x: 600, y: 40, w: 400, h: 300 };
  const c = { id: 'c', x: 0, y: 700, w: 400, h: 400 };
  const d = { id: 'd', x: 700, y: 900, w: 200, h: 200 };
  const tiles = [a, b, c, d];
  assert.equal(tileAt(tiles, { x: 10, y: 10 }), a);
  assert.equal(tileAt(tiles, { x: 10, y: 400 + ATLAS_CAPTION / 2 }), a, 'the caption belongs to its tile');
  assert.equal(tileAt(tiles, { x: -500, y: -500 }), null);
  assert.equal(neighbourTile(tiles, a, { x: 1, y: 0 }), b);
  assert.equal(neighbourTile(tiles, a, { x: -1, y: 0 }), null);
  assert.equal(neighbourTile(tiles, a, { x: 0, y: 1 }), c, 'straight in line beats diagonal');
  assert.equal(neighbourTile(tiles, c, { x: 1, y: 0 }), d);
});

test('a fitted view contains the rectangle at the pane aspect', () => {
  const rect = { x: 100, y: 200, w: 3000, h: 1000 };
  const view = viewFitting(rect, 1600, 900);
  assert.ok(Math.abs(view.w / view.h - 1600 / 900) < 1e-9);
  assert.ok(view.x <= rect.x && view.y <= rect.y && view.x + view.w >= rect.x + rect.w && view.y + view.h >= rect.y + rect.h);
});

test('keeping a pick in sight moves the view only as far as it must', () => {
  const view = { x: 0, y: 0, w: 1000, h: 600 };
  // Whole in view, even hard against the edge of a fitted desk: no pan.
  assert.equal(viewShowing(view, { x: 0, y: 0, w: 200, h: 100 }), view);
  assert.equal(viewShowing(view, { x: 800, y: 500, w: 200, h: 100 }), view);
  // Partly off to the right and below: just far enough in, with the margin.
  assert.deepEqual(viewShowing(view, { x: 900, y: 560, w: 200, h: 100 }), { x: 150, y: 90, w: 1000, h: 600 });
  // Off to the left: the same, the other way; the other axis stays.
  assert.deepEqual(viewShowing(view, { x: -300, y: 100, w: 200, h: 100 }), { x: -350, y: 0, w: 1000, h: 600 });
  // Larger than the view: centred on that axis.
  assert.deepEqual(viewShowing(view, { x: 2000, y: 100, w: 1500, h: 100 }), { x: 2250, y: 0, w: 1000, h: 600 });
});
