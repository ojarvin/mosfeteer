/**
 * Where the collage puts each design, and how much detail a tile needs.
 *
 * Every design keeps its real size: one world unit is one drawing unit, so a
 * small cell sits beside a large system at their true proportions and a zoom
 * level means what it does in the editor. Tiles go in rows by name, left to
 * right, bottom-aligned like books on a shelf so their captions share a line.
 * The row width is fixed by the whole set, so the layout is the same on every
 * visit while the set of designs is.
 */

import { GRID } from '../core/grid.js';

/** Space between neighbouring tiles, and below a row for its captions. */
export const COLLAGE_GAP = 6 * GRID;
export const COLLAGE_CAPTION = 3 * GRID;

const snapUp = (value) => Math.ceil(value / GRID) * GRID;

/**
 * Lay out `items` ({ id, w, h } in drawing units, in display order). Tiles
 * keep their exact size; their slots are whole grid cells. Of the row widths
 * that could work, the one whose whole layout best fills an `aspect`-shaped
 * screen wins, so one tall design does not leave the rest in a narrow column.
 * Returns { tiles: [{ id, x, y, w, h }], bounds }.
 */
export function layoutCollage(items, { aspect = 1.6, gap = COLLAGE_GAP, caption = COLLAGE_CAPTION } = {}) {
  if (!items.length) return { tiles: [], bounds: { x: 0, y: 0, w: 0, h: 0 } };
  const widest = Math.max(...items.map((item) => snapUp(item.w)));
  const total = items.reduce((sum, item) => sum + snapUp(item.w) + gap, 0);
  let best = null;
  const steps = 32;
  for (let step = 0; step <= steps; step++) {
    const rowWidth = widest * (total / widest) ** (step / steps);
    const layout = rowsOf(items, rowWidth, gap, caption);
    const fill = Math.min(aspect / layout.bounds.w, 1 / (layout.bounds.h + caption));
    if (!best || fill > best.fill * (1 + 1e-9)) best = { fill, layout };
  }
  return best.layout;
}

function rowsOf(items, rowWidth, gap, caption) {
  const rows = [];
  let row = null;
  for (const item of items) {
    const slot = snapUp(item.w);
    if (!row || (row.items.length && row.width + gap + slot > rowWidth)) {
      row = { items: [], width: 0, height: 0 };
      rows.push(row);
    }
    row.width += (row.items.length ? gap : 0) + slot;
    row.height = Math.max(row.height, snapUp(item.h));
    row.items.push({ ...item, slot });
  }
  const tiles = [];
  let y = 0;
  let right = 0;
  for (const { items: rowItems, height, width } of rows) {
    let x = 0;
    for (const item of rowItems) {
      tiles.push({ id: item.id, x, y: y + height - item.h, w: item.w, h: item.h });
      x += item.slot + gap;
    }
    right = Math.max(right, width);
    y += height + caption + gap;
  }
  return { tiles, bounds: { x: 0, y: 0, w: right, h: y - gap - caption } };
}

/** Longest side, in device pixels, of the two baked renderings. */
export const SMALL_PX = 256;
export const LARGE_PX = 1280;

/**
 * How to draw a tile whose longest side covers `px` device pixels: a plain
 * sheet while it is a speck, then the small or large rendering, and live
 * vector drawing once even the large one would be blurred.
 */
export function tileDetail(px) {
  if (px < 24) return 'sheet';
  if (px <= SMALL_PX * 1.25) return 'small';
  if (px <= LARGE_PX * 1.25) return 'large';
  return 'vector';
}

export function rectsIntersect(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** The tile under a world point, if any (a caption counts as its tile). */
export function tileAt(tiles, point, caption = COLLAGE_CAPTION) {
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
