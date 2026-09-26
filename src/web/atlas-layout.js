/**
 * Where the Atlas view puts each design, and how much detail a tile needs.
 *
 * Every design keeps its real size: one world unit is one drawing unit, so a
 * small cell sits beside a large system at their true proportions and a zoom
 * level means what it does in the editor. The designs are packed into one
 * loose ball -- the largest in the middle, each next one in the free spot
 * nearest the centre -- so the desk reads as one crowded sheet rather than a
 * grid of cards. Slots are whole grid cells, so every design's own grid lines
 * continue the desk's. The same designs always pack the same way.
 */

import { GRID } from '../core/grid.js';

/** Space between neighbouring designs, and below each for its caption. */
export const ATLAS_GAP = 2 * GRID;
export const ATLAS_CAPTION = 2 * GRID;

const snap = (value) => Math.round(value / GRID) * GRID;

/**
 * Pack `items` ({ id, w, h } in drawing units, whole grid cells) around the
 * origin. `aspect` stretches the ball to a screen's shape. Each slot also
 * holds a caption band below its design. Returns { tiles: [{ id, x, y, w, h }]
 * (the designs' rectangles, captions excluded), bounds }.
 */
export function layoutAtlas(items, { aspect = 1.6, gap = ATLAS_GAP, caption = ATLAS_CAPTION } = {}) {
  if (!items.length) return { tiles: [], bounds: { x: 0, y: 0, w: 0, h: 0 } };
  const order = [...items].sort((a, b) => b.w * b.h - a.w * a.h || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const stretch = Math.sqrt(aspect);
  const placed = []; // slots: design plus caption band
  const cost = (x, y, w, h) => ((x + w / 2) / stretch) ** 2 + ((y + h / 2) * stretch) ** 2;
  const free = (x, y, w, h) => placed.every((p) =>
    x >= p.x + p.w + gap || p.x >= x + w + gap || y >= p.y + p.h + gap || p.y >= y + h + gap);
  for (const item of order) {
    const w = item.w;
    const h = item.h + caption;
    if (!placed.length) {
      placed.push({ id: item.id, x: snap(-w / 2), y: snap(-h / 2), w, h });
      continue;
    }
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
        for (const x of [p.x + p.w + gap, p.x - gap - w]) candidates.push([cost(x, y, w, h), x, y]);
      }
      for (const x of xs) {
        if (x + w + gap < p.x || x > p.x + p.w + gap) continue;
        for (const y of [p.y + p.h + gap, p.y - gap - h]) candidates.push([cost(x, y, w, h), x, y]);
      }
    }
    candidates.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    const spot = candidates.find(([, x, y]) => free(x, y, w, h));
    placed.push({ id: item.id, x: spot[1], y: spot[2], w, h });
  }
  const byId = new Map(placed.map((slot) => [slot.id, slot]));
  const tiles = items.map(({ id, h }) => {
    const slot = byId.get(id);
    return { id, x: slot.x, y: slot.y, w: slot.w, h };
  });
  const x0 = Math.min(...placed.map((slot) => slot.x));
  const y0 = Math.min(...placed.map((slot) => slot.y));
  const x1 = Math.max(...placed.map((slot) => slot.x + slot.w));
  const y1 = Math.max(...placed.map((slot) => slot.y + slot.h));
  return { tiles, bounds: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } };
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
