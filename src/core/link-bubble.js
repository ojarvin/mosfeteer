/**
 * Where a linked design's peek bubble goes beside the drawing: on a ring
 * outside the drawing's extent, at the angle whose connector to its part
 * reads best, framed by a box with the design's name. Pure geometry in drawing units; the editor draws it
 * (web/hierarchy.js). Bubbles never enter the document or an export.
 */

import { GRID } from './grid.js';
import { segThroughInterior } from './router.js';

export const BUBBLE_GAP = 3 * GRID;
export const BUBBLE_PAD = GRID;
export const BUBBLE_CAPTION = 1.5 * GRID;

const snap = (value) => Math.round(value / GRID) * GRID;
const ceilCell = (value) => Math.ceil(value / GRID - 1e-9) * GRID;
const overlaps = (a, b, gap) => a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

/**
 * Lay out bubbles: `requests` [{ id, part: rect, size: { w, h }, offset? }]
 * (the child drawing's size; `offset` pins the frame's top-left corner at
 * that displacement from the part's centre, where the user dragged it). Returns [{ id, angle, frame, image, connector:
 * [from, to] }]: `frame` is the box around the child with room for its
 * caption, `image` where the child is drawn.
 *
 * Bubbles sit on a ring around the drawing, never over it. Each tries angles
 * all round the ring and takes the spot whose connector reads best: running
 * diagonally, so it stands apart from the orthogonal wiring; short; and
 * crossing as little of the drawing as it can (`obstacles`: parts' and
 * labels' `rects`, wire `segments`; running along a wire is worst). It never
 * overlaps another bubble, and `previous` (id -> angle) keeps a bubble where
 * it was while that spot is about as good.
 */
export function layoutBubbles(drawing, requests, {
  gap = BUBBLE_GAP, pad = BUBBLE_PAD, caption = BUBBLE_CAPTION,
  obstacles = {}, previous = null,
} = {}) {
  const rects = obstacles.rects || [];
  const segments = obstacles.segments || [];
  const placed = [];
  const connectors = [];
  const out = [];
  const centre = { x: drawing.x + drawing.w / 2, y: drawing.y + drawing.h / 2 };
  // Pinned bubbles go first, where they were put; the rest keep clear of them.
  const sorted = [...requests].sort((a, b) => (!!b.offset - !!a.offset) || (a.part.y - b.part.y) || (a.part.x - b.part.x));
  for (const { id, part, size, offset } of sorted) {
    const w = ceilCell(size.w + 2 * pad);
    const h = ceilCell(size.h + 2 * pad + caption);
    const pc = { x: part.x + part.w / 2, y: part.y + part.h / 2 };
    const others = rects.filter((r) => !sameRect(r, part) && !contains(part, r));
    let best = null;
    if (offset) {
      const frame = { x: snap(pc.x + offset.dx), y: snap(pc.y + offset.dy), w, h };
      const to = { x: clamp(pc.x, frame.x, frame.x + w), y: clamp(pc.y, frame.y, frame.y + h) };
      best = { angle: previous?.get(id) ?? 0, frame, from: exitPoint(part, pc, to), to };
    }
    for (let step = 0; !offset && step < RING_STEPS; step++) {
      const angle = (360 / RING_STEPS) * step;
      const u = { x: Math.cos((angle * Math.PI) / 180), y: Math.sin((angle * Math.PI) / 180) };
      // The nearest spot along this ray whose frame clears the drawing.
      const tx = Math.abs(u.x) > 1e-9 ? (drawing.w / 2 + gap + w / 2) / Math.abs(u.x) : Infinity;
      const ty = Math.abs(u.y) > 1e-9 ? (drawing.h / 2 + gap + h / 2) / Math.abs(u.y) : Infinity;
      let t = Math.min(tx, ty);
      let frame = null;
      for (let push = 0; push < 60; push++, t += GRID) {
        const candidate = { x: snap(centre.x + u.x * t - w / 2), y: snap(centre.y + u.y * t - h / 2), w, h };
        if (!overlaps(candidate, drawing, gap - GRID) && !placed.some((other) => overlaps(candidate, other, GRID))) {
          frame = candidate;
          break;
        }
      }
      if (!frame) continue;
      const to = { x: clamp(pc.x, frame.x, frame.x + w), y: clamp(pc.y, frame.y, frame.y + h) };
      const from = exitPoint(part, pc, to);
      const cost = connectorCost(from, to, others, segments, connectors, placed)
        + connectors.filter(([a, b]) => segThroughInterior(a, b, frame)).length * 60
        - (previous?.get(id) === angle ? STAY_BONUS : 0);
      if (!best || cost < best.cost) best = { cost, angle, frame, from, to };
    }
    if (!best) continue;
    const { frame, angle, from, to } = best;
    placed.push(frame);
    connectors.push([from, to]);
    const image = { x: frame.x + (w - size.w) / 2, y: frame.y + caption + pad + (h - caption - 2 * pad - size.h) / 2, w: size.w, h: size.h };
    out.push({ id, angle, frame, image, connector: [from, to] });
  }
  return out;
}

const RING_STEPS = 36;
const STAY_BONUS = 6;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const sameRect = (a, b) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
const contains = (outer, inner) => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

/** Where the line from the part's centre toward `to` leaves the part. */
function exitPoint(part, pc, to) {
  const dx = to.x - pc.x;
  const dy = to.y - pc.y;
  const sx = dx ? (part.w / 2) / Math.abs(dx) : Infinity;
  const sy = dy ? (part.h / 2) / Math.abs(dy) : Infinity;
  const s = Math.min(1, sx, sy);
  return { x: pc.x + dx * s, y: pc.y + dy * s };
}

const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Whether segments a-b and c-d cross (touching ends do not count). */
function segmentsCross(a, b, c, d) {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Whether segments a-b and c-d lie on one line and share a stretch. */
function segmentsRunTogether(a, b, c, d) {
  if (Math.abs(cross(a, b, c)) > 1e-6 || Math.abs(cross(a, b, d)) > 1e-6) return false;
  const along = (p) => (Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? p.x : p.y);
  const [lo, hi] = [Math.min(along(a), along(b)), Math.max(along(a), along(b))];
  return Math.max(lo, Math.min(along(c), along(d))) < Math.min(hi, Math.max(along(c), along(d)));
}

/** How poorly a connector reads: lower is better. */
function connectorCost(from, to, rects, segments, connectors, frames) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  // 1 at 45 degrees, 0 along an axis.
  const diagonal = length ? Math.abs(Math.sin(2 * Math.atan2(dy, dx))) : 0;
  let cost = length / GRID + 40 * (1 - diagonal);
  for (const r of rects) if (segThroughInterior(from, to, r)) cost += 25;
  for (const [a, b] of segments) {
    if (segmentsRunTogether(from, to, a, b)) cost += 200;
    else if (segmentsCross(from, to, a, b)) cost += 8;
  }
  for (const [a, b] of connectors) if (segmentsCross(from, to, a, b)) cost += 30;
  for (const frame of frames) if (segThroughInterior(from, to, frame)) cost += 60;
  return cost;
}

/** The `offset` that pins a laid-out bubble's `frame` at `at` (its new
 *  top-left corner) beside a part: grid-aligned, as the layout keeps it. */
export function bubbleOffset(part, at) {
  return { dx: snap(at.x) - (part.x + part.w / 2), dy: snap(at.y) - (part.y + part.h / 2) };
}

/** The bubble whose frame holds `point`, if any. */
export function bubbleAt(bubbles, point) {
  return bubbles.find(({ frame }) => point.x >= frame.x && point.x <= frame.x + frame.w && point.y >= frame.y && point.y <= frame.y + frame.h) || null;
}

// Bubbles are drawn in drawing units, like a dashed box annotation, so
// they scale with the drawing on the canvas and in an export alike.
export const BUBBLE_COLOR = '#1a56db';
export const BUBBLE_STROKE = 6;
export const BUBBLE_DASH = '12 12';
export const BUBBLE_RADIUS = GRID;
export const BUBBLE_DOT = 6;
export const BUBBLE_CAPTION_SIZE = 36;

/** Where a bubble's name sits: its baseline, inset a cell from the rounded
 *  top-left corner. */
export function captionAnchor(frame) {
  return { x: frame.x + GRID, y: frame.y + 1.25 * GRID };
}

const fmt = (value) => String(Math.round(value * 100) / 100);
const escapeText = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A drawing's own SVG, nested whole at `rect` and drawn from its `box`:
 *  vector, exactly as its own export draws it. */
export function nestedSvg(svg, rect, box) {
  const open = svg.match(/<svg\b[^>]*>/i);
  if (!open) return '';
  const body = svg.slice(open.index + open[0].length).replace(/<\/svg>\s*$/i, '');
  return `<svg x="${fmt(rect.x)}" y="${fmt(rect.y)}" width="${fmt(rect.w)}" height="${fmt(rect.h)}" viewBox="${fmt(box.x)} ${fmt(box.y)} ${fmt(box.w)} ${fmt(box.h)}" overflow="visible">${body}</svg>`;
}

/**
 * Laid-out bubbles ({ frame, image, connector }) with their designs ({ name,
 * svg, box }: the design's export SVG and viewBox) as an export's extras
 * (render.js `extras`): the frames widen the export, and each bubble is its
 * connector, frame, name, and the design nested as vector drawing.
 */
export function bubbleExtras(bubbles) {
  const parts = [];
  for (const { frame, image, connector: [from, to], name, svg, box } of bubbles) {
    const stroke = `stroke="${BUBBLE_COLOR}" stroke-width="${BUBBLE_STROKE}" stroke-dasharray="${BUBBLE_DASH}" stroke-linecap="round" fill="none"`;
    parts.push(`<g class="link-bubble">`
      + `<path d="M ${fmt(from.x)} ${fmt(from.y)} L ${fmt(to.x)} ${fmt(to.y)}" ${stroke}/>`
      + `<rect x="${fmt(frame.x)}" y="${fmt(frame.y)}" width="${fmt(frame.w)}" height="${fmt(frame.h)}" rx="${BUBBLE_RADIUS}" ${stroke}/>`
      + `<circle cx="${fmt(from.x)}" cy="${fmt(from.y)}" r="${BUBBLE_DOT}" fill="${BUBBLE_COLOR}"/>`
      + `<text x="${fmt(captionAnchor(frame).x)}" y="${fmt(captionAnchor(frame).y)}" font-family="system-ui, sans-serif" font-size="${BUBBLE_CAPTION_SIZE}" font-weight="600" fill="${BUBBLE_COLOR}">${escapeText(name)}</text>`
      + nestedSvg(svg, image, box)
      + `</g>`);
  }
  return { bounds: bubbles.map((bubble) => bubble.frame), svg: parts.join('\n') };
}
