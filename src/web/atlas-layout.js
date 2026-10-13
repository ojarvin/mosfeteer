/**
 * Where the Atlas view puts each design, and how much detail a tile needs.
 *
 * Every design keeps its real size: one world unit is one drawing unit, so a
 * small cell sits beside a large system at their true proportions and a zoom
 * level means what it does in the editor. The designs are packed into one
 * loose ball -- the largest in the middle, each next one in the free spot
 * nearest the centre -- so the desk reads as one crowded sheet rather than a
 * grid of cards. Slots are whole grid cells, so every design's own grid lines
 * continue the desk's. The same designs always pack the same way, and a desk
 * packed before keeps its designs where they were (`previous`).
 */

import { GRID } from '../core/grid.js';

/** Space between neighbouring designs, and below each for its caption. */
export const ATLAS_GAP = 2 * GRID;
export const ATLAS_CAPTION = 2 * GRID;

const snap = (value) => Math.round(value / GRID) * GRID;

/**
 * Remembered places (Map id -> { x, y, w, h }) stretched to `aspect` when
 * the desk they make is clearly another shape than the window (more than
 * 1.25 times off): each design's centre is scaled about the desk's centre,
 * wider and shorter or narrower and taller, so neighbours stay neighbours
 * and the desk fills the window. layoutAtlas keeps those that still fit
 * and packs the rest beside their new spots. Places already of the
 * window's shape come back as they are. Stretched places are only where
 * each design would like to be (`reshaped: true`): layoutAtlas packs every
 * one again as near its new spot as it fits (`keep: false`), or the
 * designs that kept their widths would keep the old shape too.
 */
export function reshapedPlaces(previous, aspect) {
  if (!previous?.size || !(aspect > 0)) return previous;
  const slots = [...previous.values()].filter((slot) => slot.w !== undefined);
  if (!slots.length) return previous;
  const x0 = Math.min(...slots.map((slot) => slot.x));
  const y0 = Math.min(...slots.map((slot) => slot.y));
  const x1 = Math.max(...slots.map((slot) => slot.x + slot.w));
  const y1 = Math.max(...slots.map((slot) => slot.y + slot.h));
  const now = (x1 - x0) / Math.max(1, y1 - y0);
  const ratio = aspect / now;
  if (ratio < 1.25 && ratio > 1 / 1.25) return previous;
  const sx = Math.sqrt(ratio);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const out = new Map();
  for (const [id, slot] of previous) {
    if (slot.w === undefined) { out.set(id, slot); continue; }
    const mx = cx + (slot.x + slot.w / 2 - cx) * sx;
    const my = cy + (slot.y + slot.h / 2 - cy) / sx;
    out.set(id, { ...slot, x: snap(mx - slot.w / 2), y: snap(my - slot.h / 2) });
  }
  out.reshaped = true;
  return out;
}

/**
 * Pack `items` ({ id, w, h, tags } in drawing units, whole grid cells) around
 * the origin. `aspect` stretches the ball to a screen's shape. Each slot also
 * holds a caption band below its design.
 *
 * `previous` (id -> { x, y, w, h }, a slot from an earlier packing) keeps
 * the desk steady: a design stays where it was while its slot there is still
 * free. A design that changed size yields to those that did not: it keeps its
 * top-left, else its centre, else moves to the free spot nearest its old one.
 * Only new designs and those are placed again.
 *
 * `related(a, b)` (0..1, core/design-related.js; by default a shared tag)
 * groups designs into neighbourhoods: related designs are placed one after
 * another, each drawn toward those already down in proportion.
 *
 * Returns { tiles: [{ id, x, y, w, h }] (the designs' rectangles, captions
 * excluded), slots: Map id -> { x, y, w, h }, bounds }.
 */
export function layoutAtlas(items, { aspect = 1.6, gap = ATLAS_GAP, caption = ATLAS_CAPTION, previous = null, keep = true, related = null } = {}) {
  if (!items.length) return { tiles: [], slots: new Map(), bounds: { x: 0, y: 0, w: 0, h: 0 } };
  const tagsOf = new Map(items.map((item) => [item.id, new Set(item.tags || [])]));
  const affinity = related || ((a, b) => ([...tagsOf.get(a)].some((tag) => tagsOf.get(b).has(tag)) ? 1 : 0));
  const order = neighbourhoodOrder(items, affinity);
  const stretch = Math.sqrt(aspect);
  const placed = []; // slots: design plus caption band
  const distance2 = (x, y, w, h, to) => ((x + w / 2 - to.x) / stretch) ** 2 + ((y + h / 2 - to.y) * stretch) ** 2;
  const centre = (slot) => ({ x: slot.x + slot.w / 2, y: slot.y + slot.h / 2 });
  const free = (x, y, w, h) => placed.every((p) =>
    x >= p.x + p.w + gap || p.x >= x + w + gap || y >= p.y + p.h + gap || p.y >= y + h + gap);
  const slotOf = (item) => ({ w: item.w, h: item.h + caption });
  // Where a design wants to be: its old spot, else the middle.
  const home = (item, w, h) => {
    const was = previous?.get(item.id);
    return was ? { x: was.x + (was.w ?? w) / 2, y: was.y + (was.h ?? h) / 2 } : { x: 0, y: 0 };
  };

  // Designs still fitting where they were stay put, those of the same size
  // first; a resized one tries its old corner, then its old centre.
  const pending = [];
  const resized = [];
  for (const item of order) {
    const { w, h } = slotOf(item);
    const was = previous?.get(item.id);
    if (!was || !keep) pending.push(item);
    else if (was.w !== undefined && (was.w !== w || was.h !== h)) resized.push(item);
    else if (free(was.x, was.y, w, h)) placed.push({ id: item.id, x: was.x, y: was.y, w, h });
    else pending.push(item);
  }
  for (const item of resized) {
    const { w, h } = slotOf(item);
    const was = previous.get(item.id);
    const spots = [[was.x, was.y], [snap(was.x + was.w / 2 - w / 2), snap(was.y + was.h / 2 - h / 2)]];
    const spot = spots.find(([x, y]) => free(x, y, w, h));
    if (spot) placed.push({ id: item.id, x: spot[0], y: spot[1], w, h });
    else pending.unshift(item);
  }

  for (const item of pending) {
    const { w, h } = slotOf(item);
    if (!placed.length) {
      const at = home(item, w, h);
      placed.push({ id: item.id, x: snap(at.x - w / 2), y: snap(at.y - h / 2), w, h });
      continue;
    }
    const target = home(item, w, h);
    const mates = placed.map((slot) => [slot, affinity(item.id, slot.id)]).filter(([, a]) => a >= RELATED);
    const pull = mates.reduce((sum, [, a]) => sum + a, 0);
    const strongest = Math.max(0, ...mates.map(([, a]) => a));
    // Near its old spot (or the middle), and nearer still to the designs it
    // is related to, the closer the kin the harder the pull.
    const cost = (x, y) => distance2(x, y, w, h, target)
      + (pull ? 4 * strongest * mates.reduce((sum, [slot, a]) => sum + a * distance2(x, y, w, h, centre(slot)), 0) / pull : 0);
    // Spots touching a placed slot on one side, lined up with an edge of a
    // slot nearby (or centred on the one it touches).
    const candidates = [];
    for (const p of placed) {
      const near = placed.filter((q) => q.x < p.x + p.w + 2 * gap + w && p.x < q.x + q.w + 2 * gap + w &&
        q.y < p.y + p.h + 2 * gap + h && p.y < q.y + q.h + 2 * gap + h);
      const ys = new Set([snap(p.y + p.h / 2 - h / 2)]);
      const xs = new Set([snap(p.x + p.w / 2 - w / 2)]);
      for (const q of near) {
        for (const y of [q.y, q.y + q.h - h, q.y + q.h + gap, q.y - gap - h]) ys.add(y);
        for (const x of [q.x, q.x + q.w - w, q.x + q.w + gap, q.x - gap - w]) xs.add(x);
      }
      for (const y of ys) {
        if (y + h + gap < p.y || y > p.y + p.h + gap) continue;
        for (const x of [p.x + p.w + gap, p.x - gap - w]) candidates.push([cost(x, y), x, y]);
      }
      for (const x of xs) {
        if (x + w + gap < p.x || x > p.x + p.w + gap) continue;
        for (const y of [p.y + p.h + gap, p.y - gap - h]) candidates.push([cost(x, y), x, y]);
      }
    }
    candidates.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    const spot = candidates.find(([, x, y]) => free(x, y, w, h));
    placed.push({ id: item.id, x: spot[1], y: spot[2], w, h });
  }
  // Each design, nearest the middle first, slides toward the middle while it
  // can, so the gaps a design that shrank, moved, or went leaves behind close
  // up. A settled desk does not move: only a gap moves anything.
  settle(placed, gap);
  const byId = new Map(placed.map((slot) => [slot.id, slot]));
  const tiles = items.map(({ id, h }) => {
    const slot = byId.get(id);
    return { id, x: slot.x, y: slot.y, w: slot.w, h };
  });
  const x0 = Math.min(...placed.map((slot) => slot.x));
  const y0 = Math.min(...placed.map((slot) => slot.y));
  const x1 = Math.max(...placed.map((slot) => slot.x + slot.w));
  const y1 = Math.max(...placed.map((slot) => slot.y + slot.h));
  const slots = new Map(placed.map((slot) => [slot.id, { x: slot.x, y: slot.y, w: slot.w, h: slot.h }]));
  return { tiles, slots, bounds: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } };
}

/** Slide slots toward the middle of the desk (the origin, where packing
 *  starts), a grid cell at a time along each axis, while the way is free. */
function settle(placed, gap) {
  if (placed.length < 2) return;
  const middle = { x: 0, y: 0 };
  const free = (slot, x, y) => placed.every((p) => p === slot ||
    x >= p.x + p.w + gap || p.x >= x + slot.w + gap || y >= p.y + p.h + gap || p.y >= y + slot.h + gap);
  const away = (slot) => Math.hypot(slot.x + slot.w / 2 - middle.x, slot.y + slot.h / 2 - middle.y);
  for (let pass = 0; pass < 4; pass += 1) {
    let moved = false;
    for (const slot of [...placed].sort((a, b) => away(a) - away(b) || a.id.localeCompare(b.id))) {
      for (const axis of ['x', 'y']) {
        const size = axis === 'x' ? slot.w : slot.h;
        const toward = Math.sign(middle[axis] - (slot[axis] + size / 2));
        // Only while the step brings it nearer, never past the middle.
        while (toward && Math.abs(middle[axis] - (slot[axis] + toward * GRID + size / 2)) < Math.abs(middle[axis] - (slot[axis] + size / 2))
          && free(slot, axis === 'x' ? slot.x + toward * GRID : slot.x, axis === 'y' ? slot.y + toward * GRID : slot.y)) {
          slot[axis] += toward * GRID;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
}

/** Relatedness below this is no kinship at all. */
const RELATED = 0.3;

/**
 * Designs in packing order: neighbourhoods (designs joined by relatedness of
 * at least RELATED), the largest neighbourhood first; inside one, the largest
 * design first, then whichever is most related to those already placed.
 */
function neighbourhoodOrder(items, affinity) {
  const bySize = [...items].sort((a, b) => b.w * b.h - a.w * a.h || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const parent = new Map(bySize.map((item) => [item.id, item.id]));
  const find = (id) => { while (parent.get(id) !== id) id = parent.get(id); return id; };
  for (let i = 0; i < bySize.length; i++) {
    for (let j = i + 1; j < bySize.length; j++) {
      if (affinity(bySize[i].id, bySize[j].id) >= RELATED) parent.set(find(bySize[j].id), find(bySize[i].id));
    }
  }
  const groups = new Map();
  for (const item of bySize) {
    const root = find(item.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(item);
  }
  const area = (group) => group.reduce((sum, item) => sum + item.w * item.h, 0);
  const order = [];
  for (const group of [...groups.values()].sort((a, b) => area(b) - area(a))) {
    const rest = [...group];
    const done = [rest.shift()];
    while (rest.length) {
      let best = 0;
      let bestScore = -1;
      rest.forEach((item, index) => {
        const score = Math.max(...done.map((other) => affinity(item.id, other.id)));
        if (score > bestScore + 1e-9) { best = index; bestScore = score; }
      });
      done.push(...rest.splice(best, 1));
    }
    order.push(...done);
  }
  return order;
}

/** Longest side, in device pixels, of the two baked renderings. */
export const SMALL_PX = 256;
export const LARGE_PX = 1280;

/**
 * How to draw a tile whose longest side covers `px` device pixels: the
 * small or large rendering, and live vector drawing once even the large one
 * would be blurred.
 */
export function tileDetail(px) {
  if (px <= SMALL_PX * 1.25) return 'small';
  if (px <= LARGE_PX * 1.25) return 'large';
  return 'vector';
}

export function rectsIntersect(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * How far each floating card moves so that no two cards overlap: `cards`
 * ({ id, x, y, w, h, fixed }) are the lifted cards in world units, `gap`
 * the space kept between them. Fixed cards (the picked designs) stay put;
 * the others, nearest first, each step out along the shorter way clear of
 * every card already placed, never doubling back on an axis. Returns id ->
 * { dx, dy } for each card that floats.
 */
export function floatClear(cards, gap) {
  const centre = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
  const placed = cards.filter((card) => card.fixed);
  const anchors = placed.map(centre);
  const reach = (card) => Math.min(...anchors.map((a) => Math.hypot(centre(card).x - a.x, centre(card).y - a.y)));
  const floating = cards.filter((card) => !card.fixed).sort((a, b) => reach(a) - reach(b) || String(a.id).localeCompare(String(b.id)));
  const offsets = new Map();
  for (const card of floating) {
    let dx = 0;
    let dy = 0;
    for (let i = 0; i < 4 * cards.length; i++) {
      const r = { x: card.x + dx, y: card.y + dy, w: card.w, h: card.h };
      const hit = placed.find((o) => rectsIntersect({ x: r.x - gap, y: r.y - gap, w: r.w + 2 * gap, h: r.h + 2 * gap }, o));
      if (!hit) break;
      const c = centre(r);
      const o = centre(hit);
      // Each way out of the card hit, and the shortest that keeps going the way it went.
      const ways = [
        { dx: hit.x + hit.w + gap - r.x, dy: 0 }, { dx: hit.x - gap - (r.x + r.w), dy: 0 },
        { dx: 0, dy: hit.y + hit.h + gap - r.y }, { dx: 0, dy: hit.y - gap - (r.y + r.h) },
      ].filter((way) => way.dx * dx >= 0 && way.dy * dy >= 0);
      const away = ways.filter((way) => (way.dx || way.dy) * ((way.dx ? c.x - o.x : c.y - o.y) || 1) > 0);
      const way = (away.length ? away : ways).sort((a, b) => Math.abs(a.dx + a.dy) - Math.abs(b.dx + b.dy))[0];
      if (!way) break;
      dx += way.dx;
      dy += way.dy;
    }
    offsets.set(card.id, { dx, dy });
    placed.push({ x: card.x + dx, y: card.y + dy, w: card.w, h: card.h });
  }
  return offsets;
}

/** The tile under a world point, if any (a caption counts as its tile). */
export function tileAt(tiles, point, caption = ATLAS_CAPTION) {
  return tiles.find((tile) => point.x >= tile.x && point.x <= tile.x + tile.w &&
    point.y >= tile.y && point.y <= tile.y + tile.h + caption) || null;
}

/**
 * The next tile from `from` in an arrow direction ({ x, y } unit vector):
 * the nearest one ahead, favouring tiles straight in line over diagonal ones.
 */
export function neighbourTile(tiles, from, direction) {
  const centre = (tile) => ({ x: tile.x + tile.w / 2, y: tile.y + tile.h });
  const start = centre(from);
  let best = null;
  let bestScore = Infinity;
  for (const tile of tiles) {
    if (tile === from) continue;
    const c = centre(tile);
    const along = (c.x - start.x) * direction.x + (c.y - start.y) * direction.y;
    if (along <= 0) continue;
    const across = Math.abs((c.x - start.x) * direction.y - (c.y - start.y) * direction.x);
    const score = along + 2 * across;
    if (score < bestScore) {
      bestScore = score;
      best = tile;
    }
  }
  return best;
}

/** A view ({ x, y, w, h }) of aspect `paneW`:`paneH` that shows `rect` with a
 *  margin of `margin` of the pane on every side. */
export function viewFitting(rect, paneW, paneH, margin = 0.08) {
  const scale = Math.max(rect.w / (paneW * (1 - 2 * margin)), rect.h / (paneH * (1 - 2 * margin)), 1e-6);
  const w = paneW * scale;
  const h = paneH * scale;
  return { x: rect.x + rect.w / 2 - w / 2, y: rect.y + rect.h / 2 - h / 2, w, h };
}

/**
 * A view of the whole pane (`paneW` x `paneH` pixels) that shows `rect` with
 * a margin of `margin` inside `area` ({ top, bottom }: the pixels the top
 * bar and the hint bar take), so nothing fitted lies under them. Without an
 * area it is viewFitting's.
 */
export function viewFittingIn(rect, paneW, paneH, { top = 0, bottom = 0 } = {}, margin = 0.05) {
  const areaH = Math.max(1, paneH - top - bottom);
  const inner = viewFitting(rect, paneW, areaH, margin);
  const k = inner.w / paneW; // drawing units per pixel
  return { x: inner.x, y: inner.y - top * k, w: inner.w, h: paneH * k };
}

/**
 * Pack `items` as layoutAtlas does, holding the shape of the area it will be
 * shown in (`aspect`): relatedness pulls designs together and can leave the
 * desk taller or wider than its window. When the first packing misses the
 * shape by more than a little, a few nearby shapes are tried (the direction
 * of the miss first) and the one that will show largest when fitted is kept.
 * How many depends only on how many designs there are (a packing's cost
 * grows with their square), never on time: the same desk packs the same
 * way every time, so packing afresh with nothing changed changes nothing.
 */
export function extraShapeTries(count) {
  return count <= 80 ? 3 : count <= 160 ? 1 : 0;
}

export function layoutAtlasShaped(items, options = {}) {
  const aspect = options.aspect ?? 1.6;
  const first = layoutAtlas(items, options);
  const shape = (layout) => layout.bounds.w / Math.max(1, layout.bounds.h);
  if (items.length < 3 || Math.abs(Math.log(shape(first) / aspect)) < 0.08) return first;
  // How big the whole desk is, fitted to the area: smaller shows larger.
  const span = (layout) => Math.max(layout.bounds.w / aspect, layout.bounds.h);
  const factors = (shape(first) > aspect ? [0.85, 0.7, 1.15] : [1.18, 1.4, 0.87]).slice(0, extraShapeTries(items.length));
  let best = first;
  for (const factor of factors) {
    const next = layoutAtlas(items, { ...options, aspect: aspect * factor });
    if (span(next) < span(best)) best = next;
  }
  return best;
}

/**
 * A rect on its way between the desk and the screen, seen in perspective:
 * the screen is depth 1, the desk lies behind it at depth 0, and something
 * `ratio` times larger at the screen than on the desk is that much nearer
 * the eye there. In between, `desk` and `screen` (screen rects) are blended
 * as a straight path in space projects: its size changes slowly while it
 * is far and quickly as it comes near. Depths a little past either end
 * carry on along the same path.
 */
export function throughDepth(desk, screen, depth, ratio) {
  const near = depth;
  const far = (1 - depth) * Math.max(ratio, 1e-3);
  const sum = near + far;
  const blend = (key) => (far * desk[key] + near * screen[key]) / sum;
  return { x: blend('x'), y: blend('y'), w: blend('w'), h: blend('h') };
}

/**
 * The view, moved as little as it takes to show `rect` whole with `margin`
 * (a share of the view) to spare, at the same zoom. A rect already in full
 * view leaves it as it is, so picking a design near the edge of a fitted
 * desk does not pan; one larger than the view is centred on that axis.
 */
export function viewShowing(view, rect, margin = 0.05) {
  const axis = (start, size, lo, len) => {
    const pad = size * margin;
    if (lo >= start && lo + len <= start + size) return start; // already whole in view
    if (len > size - 2 * pad) return lo + len / 2 - size / 2;
    if (lo < start + pad) return lo - pad;
    if (lo + len > start + size - pad) return lo + len - size + pad;
    return start;
  };
  const x = axis(view.x, view.w, rect.x, rect.w);
  const y = axis(view.y, view.h, rect.y, rect.h);
  return x === view.x && y === view.y ? view : { ...view, x, y };
}

// Where each design of a workspace sat on the desk, per workspace folder,
// kept in this browser (atlas.js).
export const DESK_KEY = 'mosfeteer.atlas.desk:';

/** A renamed design keeps its place on every remembered desk. */
export function carryDeskPlace(from, to, storage = globalThis.localStorage) {
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key?.startsWith(DESK_KEY)) continue;
      const slots = JSON.parse(storage.getItem(key) || '{}');
      if (!slots[from]) continue;
      slots[to] = slots[from];
      delete slots[from];
      storage.setItem(key, JSON.stringify(slots));
    }
  } catch { /* the design is simply placed again */ }
}
