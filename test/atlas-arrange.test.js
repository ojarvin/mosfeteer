import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ATLAS_GAP } from '../src/web/atlas-layout.js';
import { DESK_ASPECT, arrangeAtlas } from '../src/web/atlas-arrange.js';
import { GRID } from '../src/core/grid.js';

// A workspace: designs in four tagged groups and some with no tag, every
// pair a little alike besides, as names and parts make them.
function workspace(count = 37, seed = 5) {
  let s = seed;
  const random = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const tags = ['amp', 'adc', 'pll', 'ref', ''];
  const items = Array.from({ length: count }, (_, i) => ({
    id: `d${String(i).padStart(2, '0')}`, w: GRID * Math.round(6 + random() * 20), h: GRID * Math.round(5 + random() * 14), tag: tags[Math.floor(random() * 5)],
  }));
  const likeness = new Map();
  const relatedIn = (list) => {
    const tagOf = new Map(list.map((item) => [item.id, item.tag]));
    return (a, b) => {
      const key = a < b ? `${a}/${b}` : `${b}/${a}`;
      if (!likeness.has(key)) likeness.set(key, random() * 0.25);
      return (tagOf.get(a) && tagOf.get(a) === tagOf.get(b) ? 0.8 : 0) + likeness.get(key);
    };
  };
  return { items, relatedIn, random };
}

const gapBetween = (a, b) => Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), b.y - (a.y + a.h), a.y - (b.y + b.h));

// Pieces a tag's designs lie in: designs within a few grid cells touch.
function pieces(slots, items) {
  let count = 0;
  for (const tag of new Set(items.map((item) => item.tag).filter(Boolean))) {
    const left = items.filter((item) => item.tag === tag).map((item) => slots.get(item.id));
    while (left.length) {
      count += 1;
      const piece = [left.pop()];
      for (let k = 0; k < piece.length; k++) {
        for (let j = left.length - 1; j >= 0; j--) if (gapBetween(piece[k], left[j]) <= 3 * GRID) piece.push(...left.splice(j, 1));
      }
    }
  }
  return count;
}

// Of each pair of designs, how often one stays left of, and above, the other.
function sides(a, b, ids) {
  let same = 0;
  let pairs = 0;
  const center = (slot) => [slot.x + slot.w / 2, slot.y + slot.h / 2];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const [p, q, r, t] = [center(a.get(ids[i])), center(a.get(ids[j])), center(b.get(ids[i])), center(b.get(ids[j]))];
      pairs += 2;
      if (Math.sign(p[0] - q[0]) === Math.sign(r[0] - t[0])) same += 1;
      if (Math.sign(p[1] - q[1]) === Math.sign(r[1] - t[1])) same += 1;
    }
  }
  return same / pairs;
}

test('the same designs arrange the same way, and arranging that desk again moves nothing', () => {
  const { items, relatedIn } = workspace();
  const related = relatedIn(items);
  const first = arrangeAtlas(items, { related });
  assert.deepEqual(arrangeAtlas([...items].reverse(), { related }).slots, first.slots, 'in any order');
  assert.deepEqual(arrangeAtlas(items, { related, previous: first.slots }).slots, first.slots, 'again');
});

test('an arranged desk lies clear, on the grid, in the desk shape, with no design on its own and each group in one piece', () => {
  const { items, relatedIn } = workspace();
  const desk = arrangeAtlas(items, { related: relatedIn(items) });
  const slots = [...desk.slots.values()];
  for (const a of slots) {
    assert.ok(a.x % GRID === 0 && a.y % GRID === 0);
    for (const b of slots) if (a !== b) assert.ok(gapBetween(a, b) >= ATLAS_GAP, 'clear of each other');
    assert.ok(slots.some((b) => b !== a && gapBetween(a, b) <= 3 * GRID), 'none on its own');
  }
  assert.equal(pieces(desk.slots, items), 4);
  const shape = desk.bounds.w / desk.bounds.h;
  assert.ok(shape > DESK_ASPECT / 1.4 && shape < DESK_ASPECT * 1.4, `${desk.bounds.w} x ${desk.bounds.h}`);
  const used = slots.reduce((sum, slot) => sum + slot.w * slot.h, 0);
  assert.ok(used / (desk.bounds.w * desk.bounds.h) > 0.38, 'no big holes');
});

test('a design added or a few retagged move the rest little, and lie with their kin', () => {
  const { items, relatedIn } = workspace();
  const first = arrangeAtlas(items, { related: relatedIn(items) });
  const ids = items.map((item) => item.id);
  const added = [...items, { id: 'new', w: 12 * GRID, h: 8 * GRID, tag: 'adc' }];
  const withNew = arrangeAtlas(added, { related: relatedIn(added), previous: first.slots });
  assert.ok(sides(first.slots, withNew.slots, ids) > 0.8, `kept ${sides(first.slots, withNew.slots, ids)}`);
  assert.equal(pieces(withNew.slots, added), 4);
  const retagged = items.map((item, i) => (i % 9 === 4 ? { ...item, tag: 'pll' } : item));
  const after = arrangeAtlas(retagged, { related: relatedIn(retagged), previous: first.slots });
  const others = retagged.filter((item, i) => i % 9 !== 4).map((item) => item.id);
  assert.ok(sides(first.slots, after.slots, others) > 0.65, `kept ${sides(first.slots, after.slots, others)}`);
  assert.ok(pieces(after.slots, retagged) <= 5);
});

test('the previous desk only decides which way round the arrangement lies', () => {
  const { items, relatedIn } = workspace();
  const related = relatedIn(items);
  const first = arrangeAtlas(items, { related });
  // The same desk mirrored left to right comes back mirrored.
  const mirrored = new Map([...first.slots].map(([id, slot]) => [id, { ...slot, x: -slot.x - slot.w }]));
  const again = arrangeAtlas(items, { related, previous: mirrored });
  const ids = items.map((item) => item.id);
  assert.ok(sides(mirrored, again.slots, ids) > 0.9, `kept ${sides(mirrored, again.slots, ids)}`);
});
