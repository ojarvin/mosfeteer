import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COLLAGE_CAPTION, COLLAGE_GAP, LARGE_PX, SMALL_PX, layoutCollage, neighbourTile, rectsIntersect, tileAt, tileDetail, viewFitting } from '../src/web/collage-layout.js';

const items = [
  { id: 'a', w: 1200, h: 1800 },
  { id: 'b', w: 900, h: 900 },
  { id: 'c', w: 4000, h: 6000 },
  { id: 'd', w: 1700, h: 2500 },
  { id: 'e', w: 2300, h: 1300 },
];
// A workspace's worth of ordinary designs.
const many = Array.from({ length: 12 }, (_, index) => ({ id: `d${index}`, w: 1200 + (index % 4) * 300, h: 1000 + (index % 3) * 500 }));

test('designs keep their real size, in order, without overlapping', () => {
  const { tiles, bounds } = layoutCollage(items);
  assert.deepEqual(tiles.map((tile) => tile.id), ['a', 'b', 'c', 'd', 'e']);
  for (const [index, tile] of tiles.entries()) {
    assert.equal(tile.w, items[index].w);
    assert.equal(tile.h, items[index].h);
    assert.ok(tile.x >= 0 && tile.x + tile.w <= bounds.w && tile.y >= 0 && tile.y + tile.h <= bounds.h);
  }
  for (const a of tiles) {
    for (const b of tiles) {
      if (a === b) continue;
      const room = { x: a.x, y: a.y, w: a.w + COLLAGE_GAP, h: a.h + COLLAGE_CAPTION };
      assert.ok(!rectsIntersect(room, b), `${a.id} crowds ${b.id}`);
    }
  }
});

test('a row shares one baseline for its captions and starts on the grid', () => {
  const { tiles } = layoutCollage(many);
  const rows = Map.groupBy(tiles, (tile) => tile.y + tile.h);
  assert.ok(rows.size > 1 && rows.size < tiles.length);
  for (const [, row] of rows) assert.equal(row[0].x, 0);
  for (const tile of tiles) assert.equal(tile.x % 40, 0);
});

test('the rows fill a screen-shaped area, even beside one tall design', () => {
  const tall = [...many, { id: 'symbols', w: 4200, h: 6200 }];
  const { bounds } = layoutCollage(tall, { aspect: 1.6 });
  const naive = layoutCollage(tall, { aspect: 0.2 }).bounds;
  const fill = (b) => Math.min(1.6 / b.w, 1 / b.h);
  assert.ok(fill(bounds) >= fill(naive));
  assert.ok(bounds.w / bounds.h > 0.8, `${bounds.w} x ${bounds.h}`);
});

test('the same designs always get the same layout', () => {
  assert.deepEqual(layoutCollage(items), layoutCollage(items.map((item) => ({ ...item }))));
  assert.deepEqual(layoutCollage([]).tiles, []);
});

test('detail grows with the pixels a tile covers', () => {
  assert.equal(tileDetail(10), 'sheet');
  assert.equal(tileDetail(SMALL_PX), 'small');
  assert.equal(tileDetail(LARGE_PX), 'large');
  assert.equal(tileDetail(LARGE_PX * 2), 'vector');
});

test('picking and arrow navigation find the right tile', () => {
  const { tiles } = layoutCollage(many);
  const [a, b] = tiles;
  assert.equal(tileAt(tiles, { x: a.x + 10, y: a.y + 10 }), a);
  assert.equal(tileAt(tiles, { x: a.x + 10, y: a.y + a.h + COLLAGE_CAPTION / 2 }), a, 'the caption belongs to its tile');
  assert.equal(tileAt(tiles, { x: -500, y: -500 }), null);
  assert.equal(neighbourTile(tiles, a, { x: 1, y: 0 }), b);
  assert.equal(neighbourTile(tiles, a, { x: -1, y: 0 }), null);
  const below = neighbourTile(tiles, a, { x: 0, y: 1 });
  assert.ok(below && below.y > a.y + a.h);
});

test('a fitted view contains the rectangle at the pane aspect', () => {
  const rect = { x: 100, y: 200, w: 3000, h: 1000 };
  const view = viewFitting(rect, 1600, 900);
  assert.ok(Math.abs(view.w / view.h - 1600 / 900) < 1e-9);
  assert.ok(view.x <= rect.x && view.y <= rect.y && view.x + view.w >= rect.x + rect.w && view.y + view.h >= rect.y + rect.h);
});
