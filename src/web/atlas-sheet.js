/**
 * The Atlas as one exported sheet: every design shown on the desk, at its
 * real size and place, each under its name, on one page of vector drawing.
 * A PDF of it zooms like the Atlas itself.
 *
 * Each design's own export SVG is nested whole at its tile, so what it draws
 * is exactly what its own export draws. The renderer gives its drawings no
 * ids, so nesting any number of them cannot tangle references. Pure: string
 * in, string out.
 */

import { GRID } from '../core/grid.js';
import { escapeSvg } from '../core/style.js';
import { ATLAS_CAPTION, ATLAS_GAP } from './atlas-layout.js';
import { nestedSvg } from '../core/link-bubble.js';

/** PDF viewers stop at 200 inches a side (14400 pt); one unit prints as
 *  0.75 pt, so a larger sheet is shrunk to fit. */
export const MAX_SHEET_PX = 19200;

const CAPTION_SIZE = ATLAS_CAPTION * 0.45;
// Average advance of the caption face, as a share of its size.
const CAPTION_ADVANCE = 0.56;

const fmt = (value) => String(Math.round(value * 100) / 100);

/** `text` cut with an ellipsis to fit about `width` units of caption. */
function fitCaption(text, width) {
  const room = Math.max(1, Math.floor(width / (CAPTION_SIZE * CAPTION_ADVANCE)));
  return text.length <= room ? text : `${text.slice(0, Math.max(0, room - 1))}…`;
}

/**
 * The sheet for `items` ({ x, y, w, h, svg, box, caption }: the tile on the
 * desk, the design's export SVG and its viewBox, and the caption text or
 * '' for none). `grid` draws the editor's grid under the designs and frames
 * the sheet on whole cells. Returns { svg, scale }: `scale` < 1 when the
 * sheet had to shrink to fit a PDF page.
 */
export function atlasSheetSvg(items, { grid = false } = {}) {
  if (!items.length) throw new Error('there are no designs to export');
  const pad = ATLAS_GAP;
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const item of items) {
    x0 = Math.min(x0, item.x);
    y0 = Math.min(y0, item.y);
    x1 = Math.max(x1, item.x + item.w);
    y1 = Math.max(y1, item.y + item.h + (item.caption ? ATLAS_CAPTION : 0));
  }
  x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
  if (grid) {
    x0 = Math.floor(x0 / GRID) * GRID;
    y0 = Math.floor(y0 / GRID) * GRID;
    x1 = Math.ceil(x1 / GRID) * GRID;
    y1 = Math.ceil(y1 / GRID) * GRID;
  }
  const w = x1 - x0;
  const h = y1 - y0;
  const scale = Math.min(1, MAX_SHEET_PX / Math.max(w, h));
  const parts = [`<rect x="${fmt(x0)}" y="${fmt(y0)}" width="${fmt(w)}" height="${fmt(h)}" fill="#fff"/>`];
  if (grid) {
    const lines = [];
    for (let x = x0; x <= x1; x += GRID) lines.push(`M ${x} ${y0} V ${y1}`);
    for (let y = y0; y <= y1; y += GRID) lines.push(`M ${x0} ${y} H ${x1}`);
    parts.push(`<path class="grid-line" d="${lines.join(' ')}" fill="none" stroke="#e9e9e9" stroke-width="1"/>`);
  }
  for (const item of items) {
    parts.push(nestedSvg(item.svg, item, item.box));
    if (item.caption) {
      const text = fitCaption(item.caption, item.w + ATLAS_GAP * 0.8);
      parts.push(`<text x="${fmt(item.x)}" y="${fmt(item.y + item.h + CAPTION_SIZE * 0.6)}" dominant-baseline="hanging" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" font-size="${fmt(CAPTION_SIZE)}" font-weight="500" fill="var(--text, #111)" fill-opacity="0.6">${escapeSvg(text)}</text>`);
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(w * scale)}" height="${fmt(h * scale)}" viewBox="${fmt(x0)} ${fmt(y0)} ${fmt(w)} ${fmt(h)}">\n${parts.join('\n')}\n</svg>`;
  return { svg, scale };
}

/** A design's caption on the sheet: its name, then its tags. */
export function sheetCaption(name, tags = []) {
  return `${name}${tags.length ? `   ${tags.map((tag) => `#${tag}`).join(' ')}` : ''}`;
}
