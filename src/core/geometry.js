import { GRID } from './grid.js';

/**
 * Component/wire transforming. A transform is:
 *   translate(x, y) . rotate(rotation deg, multiples of 90) . scale(mirrorX, mirrorY)
 *
 * Order of application to a local point (matches SVG group transform string):
 *   1. mirror  (flip x if mirrorX, flip y if mirrorY)
 *   2. rotate  (about origin; +deg rotates +x toward +y = visually clockwise,
 *               y pointing down — matches SVG rotate())
 *   3. translate by (x, y)
 */

export function applyTransform(t, x, y) {
  let px = t.mirrorX ? -x : x;
  let py = t.mirrorY ? -y : y;
  const r = ((t.rotation % 360) + 360) % 360;
  if (r === 90) {
    [px, py] = [-py, px];
  } else if (r === 180) {
    [px, py] = [-px, -py];
  } else if (r === 270) {
    [px, py] = [py, -px];
  }
  return { x: t.x + px, y: t.y + py };
}

/** SVG transform attribute for a group wrapping symbol-local geometry. */
export function transformToSvg(t) {
  const s = `${t.mirrorX ? -1 : 1} ${t.mirrorY ? -1 : 1}`;
  const r = ((t.rotation % 360) + 360) % 360;
  return `translate(${t.x} ${t.y}) rotate(${r}) scale(${s})`;
}

/** Transform a local rect {x,y,w,h} into an axis-aligned world rect. */
export function transformRect(t, r) {
  const pts = [
    [r.x, r.y],
    [r.x + r.w, r.y],
    [r.x, r.y + r.h],
    [r.x + r.w, r.y + r.h],
  ].map(([x, y]) => applyTransform(t, x, y));
  return rectFromPoints(pts);
}

/** Bounding rect of a list of {x,y} points. */
export function rectFromPoints(pts) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Union of several {x,y,w,h} rects. */
export function rectUnion(rects) {
  const pts = [];
  for (const r of rects) {
    pts.push({ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x, y: r.y + r.h }, { x: r.x + r.w, y: r.y + r.h });
  }
  return rectFromPoints(pts);
}

/** True if two rects share strictly-positive area (touching edges are NOT an overlap). */
export function rectsOverlap(a, b) {
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
}

/**
 * True if the axis-aligned segment a->b passes through the STRICT INTERIOR of
 * rect r (crossing a boundary line or ending on the boundary does not count).
 * Used to detect wires that visually run through a component's footprint.
 */
export function segmentCrossesRect(a, b, r) {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  if (a.x === b.x) {
    return x0 > r.x && x0 < r.x + r.w && y0 < r.y + r.h && y1 > r.y;
  }
  if (a.y === b.y) {
    return y0 > r.y && y0 < r.y + r.h && x0 < r.x + r.w && x1 > r.x;
  }
  return false; // route is always orthogonal
}

export function rectOffset(r, dx, dy) {
  return { x: r.x + dx, y: r.y + dy, w: r.w, h: r.h };
}

/** Point-free helper: format a point for SVG. */
export function pt(p) {
  return `${p.x} ${p.y}`;
}

/**
 * Midpoint of two grid points snapped to grid, useful for wire bends.
 * (Two grid multiples average to a multiple of GRID/2; snap pulls it back
 * onto the full grid.)
 */
export function midSnap(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}