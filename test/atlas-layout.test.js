import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ATLAS_CAPTION, ATLAS_GAP, DESK_KEY, LARGE_PX, SMALL_PX, carryDeskPlace, floatClear, layoutAtlas, neighborTile, rectsIntersect, reshapedPlaces, throughDepth, tileAt, tileDetail, viewFitting, viewFittingIn, viewShowing, layoutAtlasShaped, extraShapeTries } from '../src/web/atlas-layout.js';
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

test('a narrow window packs the ball tall, a wide one wide', () => {
  const tall = layoutAtlas(many, { aspect: 0.7 }).bounds;
  const wide = layoutAtlas(many, { aspect: 2 }).bounds;
  assert.ok(tall.h > tall.w, `tall: ${tall.w} x ${tall.h}`);
  assert.ok(wide.w > 1.3 * wide.h, `wide: ${wide.w} x ${wide.h}`);
});

test('a desk remembered at another shape fills the window, its neighbors kept', () => {
  const wide = layoutAtlas(many, { aspect: 2 });
  const places = reshapedPlaces(wide.slots, 0.6);
  assert.equal(places.reshaped, true);
  const reshaped = layoutAtlas(many, { aspect: 0.6, previous: places, keep: false });
  assert.ok(reshaped.bounds.h > reshaped.bounds.w, `${reshaped.bounds.w} x ${reshaped.bounds.h}`);
  // Left of and above stay so for most pairs: far more of the arrangement
  // is kept than a fresh pack at the new shape keeps.
  const ids = many.map((item) => item.id);
  const kept = (before, after) => {
    const center = (slots) => ids.map((id) => slots.get(id)).map((slot) => [slot.x + slot.w / 2, slot.y + slot.h / 2]);
    const a = center(before);
    const b = center(after);
    let same = 0;
    let pairs = 0;
    for (let i = 0; i < a.length; i++) {
      for (let j = i + 1; j < a.length; j++) {
        pairs += 2;
        if (Math.sign(a[i][0] - a[j][0]) === Math.sign(b[i][0] - b[j][0])) same += 1;
        if (Math.sign(a[i][1] - a[j][1]) === Math.sign(b[i][1] - b[j][1])) same += 1;
      }
    }
    return same / pairs;
  };
  const fresh = layoutAtlas(many, { aspect: 0.6 });
  assert.ok(kept(wide.slots, reshaped.slots) >= 0.7, `kept ${kept(wide.slots, reshaped.slots)}`);
  assert.ok(kept(wide.slots, reshaped.slots) > kept(wide.slots, fresh.slots) + 0.2, `fresh keeps ${kept(wide.slots, fresh.slots)}`);
  // Of the window's shape already, places come back untouched.
  assert.equal(reshapedPlaces(wide.slots, 2.1), wide.slots);
  for (const tile of reshaped.tiles) assert.ok(tile.x % 40 === 0 && tile.y % 40 === 0);
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
  assert.equal(neighborTile(tiles, a, { x: 1, y: 0 }), b);
  assert.equal(neighborTile(tiles, a, { x: -1, y: 0 }), null);
  assert.equal(neighborTile(tiles, a, { x: 0, y: 1 }), c, 'straight in line beats diagonal');
  assert.equal(neighborTile(tiles, c, { x: 1, y: 0 }), d);
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
  // Larger than the view: centered on that axis.
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
  // The grown design moves, and its neighbors close the gap it left; the
  // rest stay put.
  assert.ok(moved(kept) <= 3, `only the grown design and the gap's neighbors move (${moved(kept)})`);
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
  const center = (tile) => ({ x: tile.x + tile.w / 2, y: tile.y + tile.h / 2 });
  const spread = (tag) => {
    const group = tiles.filter((tile) => items.find((item) => item.id === tile.id).tags[0] === tag).map(center);
    const mean = { x: group.reduce((sum, p) => sum + p.x, 0) / group.length, y: group.reduce((sum, p) => sum + p.y, 0) / group.length };
    return { mean, radius: Math.max(...group.map((p) => Math.hypot(p.x - mean.x, p.y - mean.y))) };
  };
  const adc = spread('adc');
  const pll = spread('pll');
  // The two groups sit apart: their centers further apart than either is wide.
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
  // The middle design goes (deleted, or renamed away): a neighbor slides
  // into its spot, so the hole moves out to the edge of the desk.
  const middle = first.tiles.find((tile) => tile.x <= 0 && tile.x + tile.w >= 0 && tile.y <= 0 && tile.y + tile.h >= 0);
  const after = layoutAtlas(items.filter((item) => item.id !== middle.id), { previous: first.slots });
  assert.ok(after.tiles.some((tile) => tile.x <= 0 && tile.x + tile.w >= 0 && tile.y <= 0 && tile.y + tile.h >= 0), 'the middle is filled');
  for (const a of after.tiles) for (const b of after.tiles) {
    if (a === b) continue;
    assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h + ATLAS_CAPTION <= b.y || b.y + b.h + ATLAS_CAPTION <= a.y);
  }
});


test('cards floating around a picked one step clear of it and of each other, the short way out', () => {
  const gap = 20;
  const shifted = (card, offsets) => ({ ...card, x: card.x + offsets.get(card.id).dx, y: card.y + offsets.get(card.id).dy });
  const picked = { id: 'p', x: 1000, y: 0, w: 1000, h: 600, fixed: true };
  // One overlapping its left edge a little, one under it, two stacked on its right
  // that would run into each other once pushed.
  const cards = [
    picked,
    { id: 'left', x: 0, y: 100, w: 1040, h: 400 },
    { id: 'below', x: 1200, y: 560, w: 400, h: 300 },
    { id: 'r1', x: 1900, y: 0, w: 500, h: 300 },
    { id: 'r2', x: 1900, y: 290, w: 500, h: 300 },
  ];
  const offsets = floatClear(cards, gap);
  assert.equal(offsets.has('p'), false, 'the picked card stays put');
  assert.deepEqual(offsets.get('left'), { dx: -60, dy: 0 }, 'just clear, to the left');
  assert.deepEqual(offsets.get('below'), { dx: 0, dy: 60 }, 'just clear, downward');
  const moved = cards.map((card) => (card.fixed ? card : shifted(card, offsets)));
  for (const [i, a] of moved.entries()) {
    for (const b of moved.slice(i + 1)) {
      assert.equal(rectsIntersect({ x: a.x - gap / 2, y: a.y - gap / 2, w: a.w + gap, h: a.h + gap }, { x: b.x - gap / 2, y: b.y - gap / 2, w: b.w + gap, h: b.h + gap }), false, `${a.id} and ${b.id} apart`);
    }
  }
  // Already clear: nothing moves.
  assert.deepEqual(floatClear([picked, { id: 'far', x: 3000, y: 0, w: 100, h: 100 }], gap).get('far'), { dx: 0, dy: 0 });
});

test('cards lower in the hierarchy step clear after those above them, however near', () => {
  const gap = 20;
  const picked = { id: 'p', x: 0, y: 0, w: 400, h: 400, fixed: true };
  // The grandchild is nearer the pick, but the child places first and keeps
  // the shorter way out; the grandchild then steps clear of both.
  const child = { id: 'child', x: 380, y: 300, w: 300, h: 300, rank: 1 };
  const grandchild = { id: 'grand', x: 390, y: 0, w: 200, h: 200, rank: 2 };
  const offsets = floatClear([picked, grandchild, child], gap);
  assert.deepEqual(offsets.get('child'), { dx: 40, dy: 0 });
  const g = offsets.get('grand');
  const at = { x: grandchild.x + g.dx, y: grandchild.y + g.dy, w: 200, h: 200 };
  for (const other of [picked, { ...child, x: child.x + 40 }]) assert.equal(rectsIntersect(at, other), false);
});

test('a design flies between the desk and the screen in perspective', () => {
  const desk = { x: 100, y: 100, w: 50, h: 40 };
  const screen = { x: 0, y: 0, w: 400, h: 320 };
  const ratio = screen.w / desk.w;
  assert.deepEqual(throughDepth(desk, screen, 0, ratio), desk);
  assert.deepEqual(throughDepth(desk, screen, 1, ratio), screen);
  // Its size goes as one over its distance from the eye: halfway there it
  // is not yet halfway grown, and it grows fastest at the end.
  const sizes = [0, 0.25, 0.5, 0.75, 1].map((depth) => throughDepth(desk, screen, depth, ratio).w);
  for (const [i, w] of sizes.entries()) {
    const depth = i / 4;
    assert.ok(Math.abs(1 / w - ((1 - depth) / desk.w + depth / screen.w)) < 1e-12, `w at ${depth}: ${w}`);
  }
  assert.ok(sizes[2] < (desk.w + screen.w) / 2);
  assert.ok(sizes[4] - sizes[3] > sizes[1] - sizes[0]);
  // Every edge moves along one projected straight path: the shape keeps
  // its proportions on the way.
  const mid = throughDepth(desk, screen, 0.5, ratio);
  assert.ok(Math.abs(mid.w / mid.h - desk.w / desk.h) < 1e-12);
  // A little past the desk it carries on, smaller still.
  assert.ok(throughDepth(desk, screen, -0.05, ratio).w < desk.w);
});

test('fitting keeps clear of the top bar and the hint bar', () => {
  const rect = { x: 0, y: 0, w: 1000, h: 1000 };
  const view = viewFittingIn(rect, 1200, 1300, { top: 80, bottom: 60 }, 0.05);
  const k = view.w / 1200; // units per pixel
  assert.ok(Math.abs(view.h / view.w - 1300 / 1200) < 1e-12, 'the whole pane, its shape');
  // The rect lands between the bars, centered there, with the margin.
  const topPx = (rect.y - view.y) / k;
  const bottomPx = (rect.y + rect.h - view.y) / k;
  assert.ok(Math.abs((topPx - 80) - (1300 - 60 - bottomPx)) < 1e-6, `centered: ${topPx} ${bottomPx}`);
  assert.ok(topPx >= 80 && bottomPx <= 1300 - 60);
  assert.ok(Math.abs((bottomPx - topPx) - (1300 - 140) * 0.9) < 1e-6, 'the margin a share of the free area');
  // Without bars it is viewFitting's.
  assert.deepEqual(viewFittingIn(rect, 1200, 1300), viewFitting(rect, 1200, 1300, 0.05));
});

test('a fresh packing holds the shape it is shown in, kinship notwithstanding', () => {
  // Relatedness that pulls a neighborhood into a column: unshaped, the
  // desk comes out far wider than the square it is shown in.
  let seed = 19;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const cell = (v) => Math.round(v / GRID) * GRID;
  const items = Array.from({ length: 34 }, (_, i) => ({ id: `d${i}`, w: cell(600 + rnd() * 2400), h: cell(400 + rnd() * 1800) }));
  const group = new Map(items.map((item) => [item.id, Math.floor(rnd() * 6)]));
  const strength = new Map();
  const related = (a, b) => {
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (!strength.has(key)) strength.set(key, group.get(a) === group.get(b) ? 0.3 + 0.7 * rnd() : rnd() * 0.35);
    return strength.get(key);
  };
  const span = ({ bounds }) => Math.max(bounds.w, bounds.h);
  const plain = layoutAtlas(items, { aspect: 1, related });
  const shaped = layoutAtlasShaped(items, { aspect: 1, related });
  assert.ok(span(shaped) <= span(plain), 'never shown smaller than the first packing');
  assert.ok(Math.abs(Math.log(shaped.bounds.w / shaped.bounds.h)) < Math.abs(Math.log(plain.bounds.w / plain.bounds.h)), `${plain.bounds.w / plain.bounds.h} -> ${shaped.bounds.w / shaped.bounds.h}`);
  // Every design still in it, none overlapping.
  assert.deepEqual(shaped.tiles.map((tile) => tile.id), items.map((item) => item.id));
  // A packing already in shape is the first one, untouched; the budget
  // bounds the extra tries.
  const square = items.slice(0, 12);
  const first = layoutAtlas(square, { aspect: 1 });
  if (Math.abs(Math.log(first.bounds.w / first.bounds.h)) < 0.08) assert.deepEqual(layoutAtlasShaped(square, { aspect: 1 }), first);
  // The same desk always packs the same way (nothing depends on time), and
  // a large workspace tries fewer shapes.
  assert.deepEqual(layoutAtlasShaped(items, { aspect: 1, related }), shaped);
  assert.deepEqual([40, 80, 120, 200].map(extraShapeTries), [3, 3, 1, 0]);
});
