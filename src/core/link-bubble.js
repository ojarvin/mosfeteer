/**
 * Where a linked design's peek bubble goes beside the drawing: outside the
 * drawing's extent, on the side nearest its part, lined up with the part,
 * framed by a box with the design's name, and joined to the part by a
 * connector. Pure geometry in drawing units; the editor draws it
 * (web/hierarchy.js). Bubbles never enter the document or an export.
 */

import { GRID } from './grid.js';

export const BUBBLE_GAP = 3 * GRID;
export const BUBBLE_PAD = GRID;
export const BUBBLE_CAPTION = GRID;

const snap = (value) => Math.round(value / GRID) * GRID;
const ceilCell = (value) => Math.ceil(value / GRID - 1e-9) * GRID;
const overlaps = (a, b, gap) => a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

/** The side of `drawing` nearest the centre of `part` (both rects). */
export function nearestSide(drawing, part) {
  const cx = part.x + part.w / 2;
  const cy = part.y + part.h / 2;
  const distances = {
    left: cx - drawing.x,
    right: drawing.x + drawing.w - cx,
    top: cy - drawing.y,
    bottom: drawing.y + drawing.h - cy,
  };
  return Object.entries(distances).reduce((best, entry) => (entry[1] < best[1] ? entry : best))[0];
}

/**
 * Lay out bubbles: `requests` [{ id, part: rect, size: { w, h } }] (the
 * child drawing's size). Returns [{ id, side, frame, image, connector:
 * [from, to] }]: `frame` is the box around the child with room for its
 * caption, `image` where the child is drawn. Bubbles on one side slide along
 * it rather than overlap.
 */
export function layoutBubbles(drawing, requests, { gap = BUBBLE_GAP, pad = BUBBLE_PAD, caption = BUBBLE_CAPTION } = {}) {
  const placed = [];
  const out = [];
  const sorted = [...requests].sort((a, b) => (a.part.y - b.part.y) || (a.part.x - b.part.x));
  for (const { id, part, size } of sorted) {
    const side = nearestSide(drawing, part);
    const w = ceilCell(size.w + 2 * pad);
    const h = ceilCell(size.h + 2 * pad + caption);
    const cx = part.x + part.w / 2;
    const cy = part.y + part.h / 2;
    const horizontal = side === 'left' || side === 'right';
    let frame = horizontal
      ? { x: side === 'right' ? snap(drawing.x + drawing.w + gap) : snap(drawing.x - gap - w), y: snap(cy - h / 2), w, h }
      : { x: snap(cx - w / 2), y: side === 'bottom' ? snap(drawing.y + drawing.h + gap) : snap(drawing.y - gap - h), w, h };
    // Slide along the side, alternating away from the part, until free.
    const start = { ...frame };
    for (let step = 1; placed.some((other) => overlaps(frame, other, GRID)) && step < 200; step++) {
      const offset = Math.ceil(step / 2) * GRID * (step % 2 ? 1 : -1);
      frame = horizontal ? { ...start, y: start.y + offset } : { ...start, x: start.x + offset };
    }
    placed.push(frame);
    const image = { x: frame.x + (w - size.w) / 2, y: frame.y + caption + pad + (h - caption - 2 * pad - size.h) / 2, w: size.w, h: size.h };
    // From the part's face toward the bubble, to the nearest point of the
    // frame's facing edge.
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const from = side === 'right' ? { x: part.x + part.w, y: cy }
      : side === 'left' ? { x: part.x, y: cy }
        : side === 'bottom' ? { x: cx, y: part.y + part.h } : { x: cx, y: part.y };
    const to = side === 'right' ? { x: frame.x, y: clamp(cy, frame.y, frame.y + h) }
      : side === 'left' ? { x: frame.x + w, y: clamp(cy, frame.y, frame.y + h) }
        : side === 'bottom' ? { x: clamp(cx, frame.x, frame.x + w), y: frame.y } : { x: clamp(cx, frame.x, frame.x + w), y: frame.y + h };
    out.push({ id, side, frame, image, connector: [from, to] });
  }
  return out;
}

/** The bubble whose frame holds `point`, if any. */
export function bubbleAt(bubbles, point) {
  return bubbles.find(({ frame }) => point.x >= frame.x && point.x <= frame.x + frame.w && point.y >= frame.y && point.y <= frame.y + frame.h) || null;
}
