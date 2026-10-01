import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ATLAS_CAPTION, ATLAS_GAP, DESK_KEY, LARGE_PX, SMALL_PX, carryDeskPlace, layoutAtlas, neighbourTile, rectsIntersect, tileAt, tileDetail, viewFitting, viewShowing } from '../src/web/atlas-layout.js';
import { GRID } from '../src/core/grid.js';

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

test('a desk packed before keeps its designs where they were', () => {
  const items = Array.from({ length: 12 }, (_, i) => ({ id: `d${i}`, w: GRID * (4 + (i * 7) % 9), h: GRID * (3 + (i * 5) % 7) }));
  const first = layoutAtlas(items);
  // One design grows, as an edit in the editor might make it.
  const grown = items.map((item) => (item.id === 'd5' ? { ...item, w: item.w + 2 * GRID, h: item.h + GRID } : item));
  const fresh = layoutAtlas(grown);
  const kept = layoutAtlas(grown, { previous: first.slots });
  const moved = (layout) => layout.tiles.filter((tile) => {
    const was = first.slots.get(tile.id);
    return was.x !== layout.slots.get(tile.id).x || was.y !== layout.slots.get(tile.id).y;
  }).length;
  // The grown design moves, and its neighbours close the gap it left; the
  // rest stay put.
  assert.ok(moved(kept) <= 3, `only the grown design and the gap's neighbours move (${moved(kept)})`);
  assert.ok(moved(kept) < moved(fresh));
  // Unchanged, the desk does not move at all.
  assert.equal(moved(layoutAtlas(items, { previous: first.slots })), 0);
  // Nothing overlaps.
  for (const a of kept.tiles) for (const b of kept.tiles) {
    if (a === b) continue;
    assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h + ATLAS_CAPTION <= b.y || b.y + b.h + ATLAS_CAPTION <= a.y);
  }
  // A new design joins without moving the rest.
  const added = layoutAtlas([...items, { id: 'new', w: 4 * GRID, h: 3 * GRID }], { previous: first.slots });
  for (const item of items) assert.deepEqual(added.slots.get(item.id), first.slots.get(item.id));
});

test('designs that share a tag pack near each other', () => {
  const items = Array.from({ length: 10 }, (_, i) => ({ id: `d${i}`, w: 6 * GRID, h: 4 * GRID, tags: i % 2 ? ['adc'] : ['pll'] }));
  const { tiles } = layoutAtlas(items);
  const centre = (tile) => ({ x: tile.x + tile.w / 2, y: tile.y + tile.h / 2 });
  const spread = (tag) => {
    const group = tiles.filter((tile) => items.find((item) => item.id === tile.id).tags[0] === tag).map(centre);
    const mean = { x: group.reduce((sum, p) => sum + p.x, 0) / group.length, y: group.reduce((sum, p) => sum + p.y, 0) / group.length };
    return { mean, radius: Math.max(...group.map((p) => Math.hypot(p.x - mean.x, p.y - mean.y))) };
  };
  const adc = spread('adc');
  const pll = spread('pll');
  // The two groups sit apart: their centres further apart than either is wide.
  assert.ok(Math.hypot(adc.mean.x - pll.mean.x, adc.mean.y - pll.mean.y) > Math.min(adc.radius, pll.radius) / 2);
});

test('a renamed design keeps its remembered place on the desk', () => {
  const data = new Map([[`${DESK_KEY}/ws`, JSON.stringify({ '/ws/amp.json': { x: 40, y: 80, w: 400, h: 320 } })], ['other', 'x']]);
  const storage = {
    get length() { return data.size; },
    key: (i) => [...data.keys()][i],
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
  };
  carryDeskPlace('/ws/amp.json', '/ws/ota.json', storage);
  assert.deepEqual(JSON.parse(data.get(`${DESK_KEY}/ws`)), { '/ws/ota.json': { x: 40, y: 80, w: 400, h: 320 } });
});

test('the desk closes the gap a design leaves', () => {
  const items = Array.from({ length: 9 }, (_, i) => ({ id: `d${i}`, w: 6 * GRID, h: 4 * GRID }));
  const first = layoutAtlas(items);
  // The middle design goes (deleted, or renamed away): a neighbour slides
  // into its spot, so the hole moves out to the edge of the desk.
  const middle = first.tiles.find((tile) => tile.x <= 0 && tile.x + tile.w >= 0 && tile.y <= 0 && tile.y + tile.h >= 0);
  const after = layoutAtlas(items.filter((item) => item.id !== middle.id), { previous: first.slots });
  assert.ok(after.tiles.some((tile) => tile.x <= 0 && tile.x + tile.w >= 0 && tile.y <= 0 && tile.y + tile.h >= 0), 'the middle is filled');
  for (const a of after.tiles) for (const b of after.tiles) {
    if (a === b) continue;
    assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h + ATLAS_CAPTION <= b.y || b.y + b.h + ATLAS_CAPTION <= a.y);
  }
});

