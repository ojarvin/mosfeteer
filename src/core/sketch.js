/**
 * The sketch: marker strokes drawn over a design while it is discussed. Its
 * own layer in world coordinates, above the drawing; nothing reads it but
 * the renderer -- no connectivity, checks, analyses, or arrange. It is
 * saved with the design (`sketch` in the file) but is no drawing edit: it
 * never makes the design unsaved and survives undo (web/sketch-ui.js).
 *
 * A stroke is `{ color, width, points: [{x, y}, ...] }`; in the file its
 * points are one flat list, `[x0, y0, x1, y1, ...]`, to tenths of a unit.
 */

import { resolveColor } from './style.js';

/** The marker's colors, as the Sketch tool offers them; red first. */
export const SKETCH_COLORS = Object.freeze(['red', 'blue', 'green', 'orange', 'purple']);
/** A marker stroke's width, in world units (a grid cell is 40). */
export const SKETCH_WIDTH = 10;
/** How see-through the marker is. */
export const SKETCH_OPACITY = 0.8;
/** At most this many strokes, and points in a stroke, are kept. */
const MAX_STROKES = 2000;
const MAX_POINTS = 4000;

const round = (n) => Math.round(n * 10) / 10;

/** A stroke read from anything, or null when it is none. */
function normalizeStroke(value) {
  if (!value || typeof value !== 'object') return null;
  const flat = Array.isArray(value.points) ? value.points : [];
  const points = [];
  for (let i = 0; i + 1 < flat.length && points.length < MAX_POINTS; i += 2) {
    const [x, y] = [Number(flat[i]), Number(flat[i + 1])];
    if (Number.isFinite(x) && Number.isFinite(y)) points.push({ x: round(x), y: round(y) });
  }
  if (!points.length) return null;
  const color = typeof value.color === 'string' && value.color ? value.color.slice(0, 40) : SKETCH_COLORS[0];
  const width = Number.isFinite(Number(value.width)) && Number(value.width) > 0 ? Math.min(200, Number(value.width)) : SKETCH_WIDTH;
  return { color, width, points };
}

/** A sketch read from a document; anything malformed is left out. */
export function normalizeSketch(value) {
  const strokes = Array.isArray(value?.strokes) ? value.strokes : [];
  return { strokes: strokes.map(normalizeStroke).filter(Boolean).slice(0, MAX_STROKES) };
}

/** The sketch as saved: left out when it has no strokes. */
export function sketchJSON(sketch) {
  const strokes = sketch?.strokes || [];
  if (!strokes.length) return {};
  return {
    sketch: {
      strokes: strokes.map((stroke) => ({
        color: stroke.color,
        width: stroke.width,
        points: stroke.points.flatMap((p) => [round(p.x), round(p.y)]),
      })),
    },
  };
}

/** Distance from `p` to the segment `a`-`b`. */
function segmentDistance(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** A drawn stroke's points with the jitter taken out: those within
 *  `tolerance` of the line through their neighbours go (Ramer-Douglas-Peucker). */
export function simplifyStroke(points, tolerance = 1.5) {
  if (points.length < 3) return points.map((p) => ({ x: round(p.x), y: round(p.y) }));
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let worst = -1;
    let index = -1;
    for (let i = first + 1; i < last; i += 1) {
      const d = segmentDistance(points[i], points[first], points[last]);
      if (d > worst) { worst = d; index = i; }
    }
    if (worst > tolerance) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i]).map((p) => ({ x: round(p.x), y: round(p.y) }));
}

const fmt = (n) => String(round(n));

/** A stroke's path: smooth curves through the midpoints between its points,
 *  so a hand-drawn line reads as one marker stroke. One point is a dot. */
export function strokePath(points) {
  if (!points.length) return '';
  if (points.length === 1) return `M ${fmt(points[0].x)} ${fmt(points[0].y)} l 0 0`;
  if (points.length === 2) return `M ${fmt(points[0].x)} ${fmt(points[0].y)} L ${fmt(points[1].x)} ${fmt(points[1].y)}`;
  const parts = [`M ${fmt(points[0].x)} ${fmt(points[0].y)}`];
  for (let i = 1; i < points.length - 1; i += 1) {
    const mid = { x: (points[i].x + points[i + 1].x) / 2, y: (points[i].y + points[i + 1].y) / 2 };
    parts.push(`Q ${fmt(points[i].x)} ${fmt(points[i].y)} ${fmt(mid.x)} ${fmt(mid.y)}`);
  }
  const last = points[points.length - 1];
  parts.push(`L ${fmt(last.x)} ${fmt(last.y)}`);
  return parts.join(' ');
}

/** One stroke as SVG markup. */
export function strokeSvg(stroke) {
  return `<path d="${strokePath(stroke.points)}" fill="none" stroke="${resolveColor(stroke.color)}" stroke-width="${fmt(stroke.width)}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

/** The sketch as a layer of SVG markup ('' when it has no strokes). The
 *  layer is see-through as a whole, so a stroke crossing itself does not
 *  darken where it overlaps. */
export function sketchSvg(sketch) {
  const strokes = sketch?.strokes || [];
  if (!strokes.length) return '';
  return `<g class="sketch-layer" opacity="${SKETCH_OPACITY}" pointer-events="none">${strokes.map(strokeSvg).join('')}</g>`;
}

/** The sketch's extent, or null when it has none. */
export function sketchBounds(sketch) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const stroke of sketch?.strokes || []) {
    const r = stroke.width / 2;
    for (const p of stroke.points) {
      x0 = Math.min(x0, p.x - r);
      y0 = Math.min(y0, p.y - r);
      x1 = Math.max(x1, p.x + r);
      y1 = Math.max(y1, p.y + r);
    }
  }
  return Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/** Whether `stroke` passes within `radius` of the segment `a`-`b`. */
function strokeNear(stroke, a, b, radius) {
  const reach = radius + stroke.width / 2;
  const pts = stroke.points;
  if (pts.length === 1) return segmentDistance(pts[0], a, b) <= reach;
  for (let i = 1; i < pts.length; i += 1) {
    // Close enough when either segment comes near the other's ends, or they cross.
    if (segmentDistance(pts[i - 1], a, b) <= reach || segmentDistance(pts[i], a, b) <= reach ||
        segmentDistance(a, pts[i - 1], pts[i]) <= reach || segmentDistance(b, pts[i - 1], pts[i]) <= reach ||
        segmentsCross(a, b, pts[i - 1], pts[i])) return true;
  }
  return false;
}

function segmentsCross(a, b, c, d) {
  const side = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
}

/** Remove the strokes the eraser's path `a`-`b` (`radius` wide) touches.
 *  Returns how many went. */
export function eraseStrokes(sketch, a, b, radius) {
  const before = sketch.strokes.length;
  sketch.strokes = sketch.strokes.filter((stroke) => !strokeNear(stroke, a, b, radius));
  return before - sketch.strokes.length;
}
