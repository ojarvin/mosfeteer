/**
 * A design's export SVG as the Atlas desk draws it on the GPU: its ink
 * (strokes and fills) as shapes the desk's shaders draw at any scale, and
 * its text (text, math, and pictures) as an SVG of its own, drawn to images.
 *
 * Pure: no DOM. The export SVG is the renderer's own regular output (no CSS,
 * no clipping, no gradients), so a small reader of its elements suffices.
 *
 * Each shape is INK_FLOATS floats, in the drawing's own units, in document
 * order (later shapes over earlier ones):
 *   segment   [x0, y0, x1, y1,  halfWidth, cap0, cap1, SEGMENT,  r, g, b, a,  tag, role, 0, 0]
 *   disc      [cx, cy, r, 0,    0, 0, 0, DISC,                    r, g, b, a,  tag, role, 0, 0]
 *   ring      [cx, cy, r, 0,    halfWidth, 0, 0, RING,            r, g, b, a,  tag, role, 0, 0]
 *   triangle  [x0, y0, x1, y1,  x2, y2, outerEdges, TRIANGLE,     r, g, b, a,  tag, role, 0, 0]
 * `tag`: what the shape belongs to, an index into the drawing's `tags`
 * (`part:R1`, `label:L3`, `net:N2`; 0 for nothing), so a search can light
 * it; `role`: INK, or WIRE (the drawing's wires, each run tagged with its
 * net, read from the net's own wire paths, which are not drawn).
 * Caps: BUTT, SQUARE, ROUND, or a corner: JOINT + the angle of the corner's
 * mean direction (the two runs' directions added), across which the two are
 * cut, so they meet in a miter, without a seam or an overlap at any width
 * (JOINT alone: cut square, where a line turns right back). A triangle's outerEdges has bit i set when its
 * edge from vertex i to the next lies on the shape's outline: only those are
 * smoothed, so the triangles of one fill meet without seams. Colors are
 * premultiplied, 0 to 1.
 */

export const INK_FLOATS = 16;
export const INK = 0;
export const WIRE = 1;
const NET_PATH = 2;

/** A drawing's tags: `list[i]` names tag i (0: none), `index(name)` gives one. */
export function createTags() {
  const list = [''];
  const map = new Map();
  return {
    list,
    index(name) {
      if (!name) return 0;
      let i = map.get(name);
      if (i === undefined) {
        i = list.length;
        list.push(name);
        map.set(name, i);
      }
      return i;
    },
    /** The tags of `names`, as a mask a byte a tag (255: one of them). */
    mask(names) {
      const out = new Uint8Array(list.length);
      for (const name of names) {
        const i = map.get(name);
        if (i !== undefined) out[i] = 255;
      }
      return out;
    },
  };
}
export const SEGMENT = 0;
export const DISC = 1;
export const RING = 2;
export const TRIANGLE = 3;
export const BUTT = 0;
export const SQUARE = 1;
export const ROUND = 2;
export const JOINT = 3;
/** How far a miter reaches, in half widths, before it is cut off. */
export const MITER_LIMIT = 4;

/** Elements drawn as ink, and those drawn with the text. */
const INK_ELEMENTS = new Set(['path', 'line', 'polyline', 'polygon', 'rect', 'circle', 'ellipse']);
const TEXT = new Set(['text', 'foreignObject', 'image']);
/** Elements whose content is not more drawing. */
const OPAQUE = new Set(['text', 'foreignObject', 'title', 'desc', 'style', 'script', 'metadata', 'defs']);

/** How finely curves are cut into straight pieces: at most this far off the
 *  curve, in the drawing's units (a grid cell is 40). */
const TOLERANCE = 0.08;

const NAMED = {
  black: [0, 0, 0], white: [1, 1, 1], red: [1, 0, 0], green: [0, 128 / 255, 0], blue: [0, 0, 1],
  gray: [128 / 255, 128 / 255, 128 / 255], grey: [128 / 255, 128 / 255, 128 / 255],
  orange: [1, 165 / 255, 0], yellow: [1, 1, 0], purple: [128 / 255, 0, 128 / 255],
};

/** A paint as straight [r, g, b, a], or null for none. */
export function parseColor(value) {
  if (value === undefined || value === null) return null;
  let text = String(value).trim();
  // A CSS variable takes its fallback: the export is drawn standalone.
  for (let guard = 0; guard < 4; guard++) {
    const variable = text.match(/^var\(\s*--[\w-]+\s*,\s*(.+)\)$/);
    if (!variable) break;
    text = variable[1].trim();
  }
  const lower = text.toLowerCase();
  if (!lower || lower === 'none' || lower === 'transparent') return null;
  if (lower[0] === '#') {
    const hex = lower.slice(1);
    const digits = hex.length === 3 || hex.length === 4 ? [...hex].map((c) => c + c) : hex.match(/../g);
    if (!digits || (hex.length !== 3 && hex.length !== 4 && hex.length !== 6 && hex.length !== 8)) return [0, 0, 0, 1];
    const [r, g, b, a = 'ff'] = digits;
    return [parseInt(r, 16) / 255, parseInt(g, 16) / 255, parseInt(b, 16) / 255, parseInt(a, 16) / 255];
  }
  const fn = lower.match(/^rgba?\(([^)]*)\)$/);
  if (fn) {
    const parts = fn[1].split(/[\s,/]+/).filter(Boolean);
    const channel = (part) => (part.endsWith('%') ? parseFloat(part) / 100 : parseFloat(part) / 255);
    const alpha = parts[3] === undefined ? 1 : parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
    return [channel(parts[0] || '0'), channel(parts[1] || '0'), channel(parts[2] || '0'), Number.isFinite(alpha) ? alpha : 1];
  }
  if (NAMED[lower]) return [...NAMED[lower], 1];
  return [0, 0, 0, 1];
}

const IDENTITY = [1, 0, 0, 1, 0, 0];

function multiply(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

/** An SVG transform list as a matrix [a, b, c, d, e, f]. */
export function parseTransform(text) {
  let m = IDENTITY;
  for (const [, name, args] of String(text || '').matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const v = args.split(/[\s,]+/).filter(Boolean).map(Number);
    let n = IDENTITY;
    if (name === 'matrix' && v.length === 6) n = v;
    else if (name === 'translate') n = [1, 0, 0, 1, v[0] || 0, v[1] || 0];
    else if (name === 'scale') n = [v[0] ?? 1, 0, 0, v[1] ?? v[0] ?? 1, 0, 0];
    else if (name === 'rotate') {
      const a = ((v[0] || 0) * Math.PI) / 180;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      n = [cos, sin, -sin, cos, 0, 0];
      if (v.length >= 3) n = multiply(multiply([1, 0, 0, 1, v[1], v[2]], n), [1, 0, 0, 1, -v[1], -v[2]]);
    } else if (name === 'skewX') n = [1, 0, Math.tan(((v[0] || 0) * Math.PI) / 180), 1, 0, 0];
    else if (name === 'skewY') n = [1, Math.tan(((v[0] || 0) * Math.PI) / 180), 0, 1, 0, 0];
    m = multiply(m, n);
  }
  return m;
}

const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** A path's `d` as subpaths of points, curves cut into straight pieces:
 *  [{ points: [[x, y], ...], closed }]. `tolerance` in the path's units. */
export function flattenPath(d, tolerance = TOLERANCE) {
  const tokens = String(d || '').match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) || [];
  const subpaths = [];
  let current = null;
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let command = '';
  let lastControl = null;
  let i = 0;
  const number = () => Number(tokens[i++]);
  const flag = () => {
    // Arc flags may be written without separators ("a5 5 0 105 5").
    const token = tokens[i];
    if (token.length > 1 && /^[01]/.test(token)) {
      tokens[i] = token.slice(1);
      return Number(token[0]);
    }
    i += 1;
    return Number(token);
  };
  const begin = (px, py) => {
    current = { points: [[px, py]], closed: false };
    subpaths.push(current);
  };
  const lineTo = (px, py) => {
    if (!current) begin(x, y);
    current.points.push([px, py]);
  };
  const steps = (length) => Math.max(1, Math.min(256, Math.ceil(Math.sqrt(length / (8 * tolerance)) * 2)));
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) command = tokens[i++];
    else if (!command) { i += 1; continue; }
    const relative = command === command.toLowerCase();
    const ox = relative ? x : 0;
    const oy = relative ? y : 0;
    const kind = command.toUpperCase();
    if (kind === 'Z') {
      if (current) {
        current.closed = true;
        x = startX;
        y = startY;
        current = null;
      }
      lastControl = null;
      continue;
    }
    if (i >= tokens.length || /[a-zA-Z]/.test(tokens[i])) continue;
    if (kind === 'M') {
      x = ox + number();
      y = oy + number();
      startX = x;
      startY = y;
      begin(x, y);
      // Coordinates after a moveto are linetos.
      command = relative ? 'l' : 'L';
      lastControl = null;
    } else if (kind === 'L') {
      x = ox + number();
      y = oy + number();
      lineTo(x, y);
      lastControl = null;
    } else if (kind === 'H') {
      x = ox + number();
      lineTo(x, y);
      lastControl = null;
    } else if (kind === 'V') {
      y = oy + number();
      lineTo(x, y);
      lastControl = null;
    } else if (kind === 'C' || kind === 'S') {
      let x1;
      let y1;
      if (kind === 'C') {
        x1 = ox + number();
        y1 = oy + number();
      } else {
        x1 = lastControl?.cubic ? 2 * x - lastControl.x : x;
        y1 = lastControl?.cubic ? 2 * y - lastControl.y : y;
      }
      const x2 = ox + number();
      const y2 = oy + number();
      const ex = ox + number();
      const ey = oy + number();
      const n = steps(Math.hypot(x1 - x, y1 - y) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(ex - x2, ey - y2));
      for (let s = 1; s <= n; s++) {
        const t = s / n;
        const u = 1 - t;
        lineTo(u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * ex, u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * ey);
      }
      lastControl = { x: x2, y: y2, cubic: true };
      x = ex;
      y = ey;
    } else if (kind === 'Q' || kind === 'T') {
      let x1;
      let y1;
      if (kind === 'Q') {
        x1 = ox + number();
        y1 = oy + number();
      } else {
        x1 = lastControl?.quadratic ? 2 * x - lastControl.x : x;
        y1 = lastControl?.quadratic ? 2 * y - lastControl.y : y;
      }
      const ex = ox + number();
      const ey = oy + number();
      const n = steps(Math.hypot(x1 - x, y1 - y) + Math.hypot(ex - x1, ey - y1));
      for (let s = 1; s <= n; s++) {
        const t = s / n;
        const u = 1 - t;
        lineTo(u * u * x + 2 * u * t * x1 + t * t * ex, u * u * y + 2 * u * t * y1 + t * t * ey);
      }
      lastControl = { x: x1, y: y1, quadratic: true };
      x = ex;
      y = ey;
    } else if (kind === 'A') {
      const rx = Math.abs(number());
      const ry = Math.abs(number());
      const rotation = number();
      const large = flag();
      const sweep = flag();
      const ex = ox + number();
      const ey = oy + number();
      for (const [px, py] of arcPoints(x, y, rx, ry, rotation, large, sweep, ex, ey, tolerance)) lineTo(px, py);
      x = ex;
      y = ey;
      lastControl = null;
    } else {
      i += 1;
    }
  }
  return subpaths.filter((subpath) => subpath.points.length > 1 || subpath.closed);
}

/** The points along an SVG arc after its start, ending at its end (SVG 1.1 F.6.5). */
function arcPoints(x1, y1, rx, ry, rotation, large, sweep, x2, y2, tolerance) {
  if (x1 === x2 && y1 === y2) return [];
  if (!rx || !ry) return [[x2, y2]];
  const phi = (rotation * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const xp = cos * dx + sin * dy;
  const yp = -sin * dx + cos * dy;
  const lambda = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp;
  const den = rx * rx * yp * yp + ry * ry * xp * xp;
  let coef = Math.sqrt(Math.max(0, num / den));
  if (large === sweep) coef = -coef;
  const cxp = (coef * rx * yp) / ry;
  const cyp = (-coef * ry * xp) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angle = (ux, uy, vx, vy) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const theta = angle(1, 0, (xp - cxp) / rx, (yp - cyp) / ry);
  let delta = angle((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  else if (sweep && delta < 0) delta += 2 * Math.PI;
  const r = Math.max(rx, ry);
  // The chord of a step stays within `tolerance` of the curve.
  const step = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - tolerance / r)));
  const n = Math.max(2, Math.min(256, Math.ceil(Math.abs(delta) / Math.max(step, 1e-3))));
  const out = [];
  for (let s = 1; s < n; s++) {
    const t = theta + (delta * s) / n;
    const ex = rx * Math.cos(t);
    const ey = ry * Math.sin(t);
    out.push([cos * ex - sin * ey + cx, sin * ex + cos * ey + cy]);
  }
  out.push([x2, y2]);
  return out;
}

/** Twice the signed area of a polygon. */
function area2(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [ax, ay] = points[i];
    const [bx, by] = points[(i + 1) % points.length];
    sum += ax * by - bx * ay;
  }
  return sum;
}

const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

function inTriangle(p, a, b, c) {
  const d1 = cross(a, b, p);
  const d2 = cross(b, c, p);
  const d3 = cross(c, a, p);
  return d1 >= 0 && d2 >= 0 && d3 >= 0;
}

/** A simple polygon as triangles [a, b, c, outerEdges] (ear clipping). */
export function triangulate(input) {
  // Repeated points (a closing point equal to the first) say nothing.
  const points = [];
  for (const point of input) {
    const previous = points[points.length - 1];
    if (!previous || previous[0] !== point[0] || previous[1] !== point[1]) points.push(point);
  }
  while (points.length > 1 && points[0][0] === points[points.length - 1][0] && points[0][1] === points[points.length - 1][1]) points.pop();
  if (points.length < 3) return [];
  // Counter-clockwise in a y-up sense (cross > 0 is a left turn).
  if (area2(points) < 0) points.reverse();
  const index = points.map((_, i) => i);
  // outer[i]: the edge from index[i] to the next is on the outline.
  const outer = index.map(() => true);
  const triangles = [];
  let guard = points.length * points.length;
  while (index.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let i = 0; i < index.length; i++) {
      const prev = (i + index.length - 1) % index.length;
      const next = (i + 1) % index.length;
      const a = points[index[prev]];
      const b = points[index[i]];
      const c = points[index[next]];
      const turn = cross(a, b, c);
      if (turn < 0) continue;
      if (turn === 0) {
        // A point on a straight run: drop it, keeping its outline.
        outer[prev] = outer[prev] && outer[i];
        index.splice(i, 1);
        outer.splice(i, 1);
        clipped = true;
        break;
      }
      let blocked = false;
      for (let j = 0; j < index.length && !blocked; j++) {
        if (j === prev || j === i || j === next) continue;
        const p = points[index[j]];
        if ((p[0] === a[0] && p[1] === a[1]) || (p[0] === c[0] && p[1] === c[1])) continue;
        blocked = inTriangle(p, a, b, c);
      }
      if (blocked) continue;
      triangles.push([a, b, c, (outer[prev] ? 1 : 0) | (outer[i] ? 2 : 0)]);
      outer[prev] = false;
      index.splice(i, 1);
      outer.splice(i, 1);
      clipped = true;
      break;
    }
    // A self-touching outline with no ear left: fan out what remains.
    if (!clipped) break;
  }
  if (index.length === 3) {
    const [a, b, c] = index.map((i) => points[i]);
    if (cross(a, b, c) !== 0) triangles.push([a, b, c, (outer[0] ? 1 : 0) | (outer[1] ? 2 : 0) | (outer[2] ? 4 : 0)]);
  } else if (index.length > 3) {
    for (let i = 1; i + 1 < index.length; i++) {
      triangles.push([points[index[0]], points[index[i]], points[index[i + 1]], (i === 1 && outer[0] ? 1 : 0) | (outer[i] ? 2 : 0) | (i + 2 === index.length && outer[i + 1] ? 4 : 0)]);
    }
  }
  return triangles;
}

/** Split a polyline into its dashes, the pattern running on across corners. */
function dashed(points, closed, pattern) {
  const sum = pattern.reduce((a, b) => a + b, 0);
  if (!(sum > 0) || pattern.some((v) => v < 0)) return [{ points, closed }];
  const list = pattern.length % 2 ? [...pattern, ...pattern] : pattern;
  const runs = [];
  const all = closed ? [...points, points[0]] : points;
  let at = 0;
  let left = list[0];
  let on = true;
  let run = on ? [all[0]] : null;
  for (let i = 1; i < all.length; i++) {
    let [ax, ay] = all[i - 1];
    const [bx, by] = all[i];
    let length = Math.hypot(bx - ax, by - ay);
    while (length > left) {
      const t = left / length;
      const px = ax + (bx - ax) * t;
      const py = ay + (by - ay) * t;
      if (on) {
        run.push([px, py]);
        runs.push({ points: run, closed: false });
        run = null;
      } else {
        run = [[px, py]];
      }
      on = !on;
      length -= left;
      ax = px;
      ay = py;
      at = (at + 1) % list.length;
      left = list[at];
    }
    left -= length;
    if (on) run.push([bx, by]);
  }
  if (on && run && run.length > 1) runs.push({ points: run, closed: false });
  return runs;
}

const CAPS = { butt: BUTT, square: SQUARE, round: ROUND };

/**
 * One path's straight runs that lie along one horizontal or vertical line
 * and touch or overlap (a wire and the pin lead it runs into, both with
 * square ends) as one run: a path's strokes cover a pixel once, as the
 * browser draws them, never twice where they overlap (which shows wherever
 * they are drawn faint, thinner than a pixel). A square end is that much
 * more length; a cut (JOINT) or round end stays as it is.
 * `segments`: [x0, y0, x1, y1, cap0, cap1].
 */
/** The line a horizontal or vertical run lies on (`h<y>`, `v<x>`), else null. */
function lineKey(x0, y0, x1, y1) {
  if (y0 === y1 && x0 !== x1) return `h${y0}`;
  if (x0 === x1 && y0 !== y1) return `v${x0}`;
  return null;
}

export function mergeRuns(segments, half) {
  const lines = new Map();
  const rest = [];
  for (const segment of segments) {
    const [x0, y0, x1, y1] = segment;
    const across = y0 === y1 && x0 !== x1 ? 'h' : x0 === x1 && y0 !== y1 ? 'v' : null;
    if (!across) {
      rest.push(segment);
      continue;
    }
    const key = across === 'h' ? `h${y0}` : `v${x0}`;
    if (!lines.has(key)) lines.set(key, []);
    lines.get(key).push(segment);
  }
  const out = [...rest];
  for (const [key, list] of lines) {
    if (list.length === 1) {
      out.push(list[0]);
      continue;
    }
    const horizontal = key[0] === 'h';
    const along = (x, y) => (horizontal ? x : y);
    // Each run's two ends, the low one first: where it reaches, and how it ends there.
    const runs = list.map(([x0, y0, x1, y1, cap0, cap1]) => {
      const a = along(x0, y0);
      const b = along(x1, y1);
      // `first`: the run's first end (a corner's cut is read from it, facing on).
      const end = (p, cap, out, first) => ({ p, cap, first, reach: cap === SQUARE || cap === ROUND ? p + out * half : p });
      return a <= b ? { lo: end(a, cap0, -1, true), hi: end(b, cap1, 1, false) } : { lo: end(b, cap1, -1, false), hi: end(a, cap0, 1, true) };
    }).sort((r, s) => r.lo.reach - s.lo.reach);
    const merged = [];
    for (const run of runs) {
      const last = merged[merged.length - 1];
      if (last && run.lo.reach <= last.hi.reach + 1e-6) {
        if (run.hi.reach > last.hi.reach) last.hi = run.hi;
      } else {
        merged.push({ ...run });
      }
    }
    const fixed = horizontal ? list[0][1] : list[0][0];
    for (const { lo, hi } of merged) {
      // A square end becomes a plain end where its square reaches.
      const a = lo.cap === SQUARE ? lo.reach : lo.p;
      const b = hi.cap === SQUARE ? hi.reach : hi.p;
      // A corner's end now on the other end of its run faces the other way.
      const turned = (cap) => JOINT + 7 + ((cap - JOINT - 7 + Math.PI) % (2 * Math.PI));
      const capA = lo.cap === SQUARE ? BUTT : lo.cap >= JOINT + 7 && !lo.first ? turned(lo.cap) : lo.cap;
      const capB = hi.cap === SQUARE ? BUTT : hi.cap >= JOINT + 7 && hi.first ? turned(hi.cap) : hi.cap;
      out.push(horizontal ? [a, fixed, b, fixed, capA, capB] : [fixed, a, fixed, b, capA, capB]);
    }
  }
  return out;
}

/** Read the export SVG. Returns { data: Float32Array, count, textSvg,
 *  picturesSvg, box, tags } (`tags` as createTags, or those given): `textSvg` the drawing less its ink, null when the
 *  design has no text, math, or pictures; `picturesSvg` that less its text
 *  too, null when it has no pictures. */
export function svgInk(svg, tags = createTags()) {
  const source = String(svg);
  const out = [];
  let count = 0;
  const push = (values, color, style) => {
    out.push(...values, color[0] * color[3], color[1] * color[3], color[2] * color[3], color[3], style.tag, style.role, 0, 0);
    count += 1;
  };
  const tag = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<!DOCTYPE[^>]*>|<(\/?)([a-zA-Z][\w:.-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/g;
  const root = {
    fill: [0, 0, 0, 1], stroke: null, strokeWidth: 1, cap: BUTT, join: JOINT,
    fillOpacity: 1, strokeOpacity: 1, opacity: 1, dash: null, matrix: IDENTITY, hidden: false,
    tag: 0, role: INK,
  };
  const stack = [{ name: '#root', style: root }];
  let box = null;
  // The text drawing: everything but the ink, as written.
  const kept = [];
  let keptFrom = 0;
  let removing = null; // { depth } while inside an ink element being left out
  let opaque = null; // { name, depth } while inside text-like content
  let hasText = false;
  /** The nets' own straight runs, by line (as mergeRuns keys them): [lo, hi, tag]. */
  const netRuns = new Map();

  const attributesOf = (text) => {
    const attrs = {};
    for (const [, name, , double, single, bare] of text.matchAll(/([^\s=>/]+)(\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      attrs[name] = double ?? single ?? bare ?? '';
    }
    if (attrs.style) {
      for (const declaration of attrs.style.split(';')) {
        const at = declaration.indexOf(':');
        if (at > 0) attrs[declaration.slice(0, at).trim()] = declaration.slice(at + 1).trim();
      }
    }
    return attrs;
  };

  const styleOf = (parent, attrs) => {
    const style = { ...parent };
    if (attrs.fill !== undefined) style.fill = parseColor(attrs.fill);
    if (attrs.stroke !== undefined) style.stroke = parseColor(attrs.stroke);
    if (attrs['stroke-width'] !== undefined) style.strokeWidth = parseFloat(attrs['stroke-width']) || 0;
    if (attrs['stroke-linecap'] !== undefined) style.cap = CAPS[attrs['stroke-linecap']] ?? BUTT;
    if (attrs['stroke-linejoin'] !== undefined) style.join = attrs['stroke-linejoin'] === 'round' ? ROUND : JOINT;
    if (attrs['fill-opacity'] !== undefined) style.fillOpacity = Math.max(0, Math.min(1, parseFloat(attrs['fill-opacity'])));
    if (attrs['stroke-opacity'] !== undefined) style.strokeOpacity = Math.max(0, Math.min(1, parseFloat(attrs['stroke-opacity'])));
    if (attrs.opacity !== undefined) style.opacity = parent.opacity * Math.max(0, Math.min(1, parseFloat(attrs.opacity)));
    if (attrs['stroke-dasharray'] !== undefined) {
      const pattern = attrs['stroke-dasharray'] === 'none' ? [] : attrs['stroke-dasharray'].split(/[\s,]+/).filter(Boolean).map(Number);
      style.dash = pattern.length && pattern.every(Number.isFinite) ? pattern : null;
    }
    if (attrs.display === 'none' || attrs.visibility === 'hidden') style.hidden = true;
    if (attrs.transform) style.matrix = multiply(parent.matrix, parseTransform(attrs.transform));
    if (attrs['data-ref']) style.tag = tags.index(`part:${attrs['data-ref']}`);
    if (attrs['data-label-id']) style.tag = tags.index(`label:${attrs['data-label-id']}`);
    if (attrs['data-net-id']) style.tag = tags.index(`net:${attrs['data-net-id']}`);
    const classes = ` ${attrs.class || ''} `;
    if (classes.includes(' wire-ink ')) style.role = WIRE;
    if (classes.includes(' wire-managed ')) style.role = NET_PATH;
    return style;
  };

  const paint = (color, opacity) => (color && color[3] * opacity > 0 ? [color[0], color[1], color[2], color[3] * opacity] : null);

  /** Fill and stroke one shape, given as subpaths in its own units. */
  const draw = (style, subpaths, { fill = true } = {}) => {
    const m = style.matrix;
    const scaleOf = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
    // A net's own wires only say which net the drawing's wires are.
    const netPath = style.role === NET_PATH;
    const fillColor = fill && !netPath ? paint(style.fill, style.fillOpacity * style.opacity) : null;
    if (fillColor) {
      for (const { points } of subpaths) {
        if (points.length < 3) continue;
        for (const [a, b, c, edges] of triangulate(points.map(([x, y]) => apply(m, x, y)))) {
          push([a[0], a[1], b[0], b[1], c[0], c[1], edges, TRIANGLE], fillColor, style);
        }
      }
    }
    const strokeColor = netPath ? [0, 0, 0, 0] : paint(style.stroke, style.strokeOpacity * style.opacity);
    const half = (style.strokeWidth * scaleOf) / 2;
    if (!strokeColor || !(half > 0)) return;
    const segments = [];
    for (const subpath of subpaths) {
      const runs = style.dash ? dashed(subpath.points, subpath.closed, style.dash) : [subpath];
      for (const { points, closed } of runs) {
        const world = points.map(([x, y]) => apply(m, x, y));
        if (world.length === 1 || (world.length === 2 && world[0][0] === world[1][0] && world[0][1] === world[1][1])) {
          // A dot: only a round or square cap shows it.
          if (style.cap !== BUTT) segments.push([world[0][0], world[0][1], world[0][0], world[0][1], style.cap, style.cap]);
          continue;
        }
        // Repeated points make no segment and no corner.
        const pts = world.filter((p, i) => i === 0 || p[0] !== world[i - 1][0] || p[1] !== world[i - 1][1]);
        if (closed && pts.length > 2 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
        const n = closed ? pts.length : pts.length - 1;
        // How each corner is cut: round, or across its mean direction.
        const corner = (i) => {
          if (style.join === ROUND) return ROUND;
          const [px, py] = pts[(i + pts.length - 1) % pts.length];
          const [cx, cy] = pts[i];
          const [nx, ny] = pts[(i + 1) % pts.length];
          const l0 = Math.hypot(cx - px, cy - py);
          const l1 = Math.hypot(nx - cx, ny - cy);
          const tx = (cx - px) / l0 + (nx - cx) / l1;
          const ty = (cy - py) / l0 + (ny - cy) / l1;
          if (Math.hypot(tx, ty) < 1e-6) return JOINT;
          return JOINT + 7 + ((Math.atan2(ty, tx) + 2 * Math.PI) % (2 * Math.PI));
        };
        for (let i = 0; i < n; i++) {
          const a = pts[i];
          const b = pts[(i + 1) % pts.length];
          const first = !closed && i === 0;
          const last = !closed && i === n - 1;
          segments.push([a[0], a[1], b[0], b[1], first ? style.cap : corner(i), last ? style.cap : corner((i + 1) % pts.length)]);
        }
      }
    }
    for (const [x0, y0, x1, y1, cap0, cap1] of mergeRuns(segments, half)) {
      if (netPath) {
        const key = lineKey(x0, y0, x1, y1);
        if (!key) continue;
        const run = key[0] === 'h' ? [Math.min(x0, x1), Math.max(x0, x1), style.tag] : [Math.min(y0, y1), Math.max(y0, y1), style.tag];
        if (!netRuns.has(key)) netRuns.set(key, []);
        netRuns.get(key).push(run);
        continue;
      }
      push([x0, y0, x1, y1, half, cap0, cap1, SEGMENT], strokeColor, style);
    }
  };

  /** Each straight wire run takes the tag of the net whose own run it lies along. */
  const tagWires = () => {
    for (let i = 0; i < count; i++) {
      const o = i * INK_FLOATS;
      if (out[o + 13] !== WIRE || out[o + 7] !== SEGMENT) continue;
      const key = lineKey(out[o], out[o + 1], out[o + 2], out[o + 3]);
      const runs = key && netRuns.get(key);
      if (!runs) continue;
      const along = key[0] === 'h' ? [out[o], out[o + 2]] : [out[o + 1], out[o + 3]];
      const lo = Math.min(...along);
      const hi = Math.max(...along);
      const run = runs.find(([a, b]) => a < hi && b > lo);
      if (run) out[o + 12] = run[2];
    }
  };

  const shape = (name, attrs, style) => {
    if (style.hidden) return;
    const num = (key, fallback = 0) => {
      const value = parseFloat(attrs[key]);
      return Number.isFinite(value) ? value : fallback;
    };
    if (name === 'path') {
      draw(style, flattenPath(attrs.d));
    } else if (name === 'line') {
      draw(style, [{ points: [[num('x1'), num('y1')], [num('x2'), num('y2')]], closed: false }], { fill: false });
    } else if (name === 'polyline' || name === 'polygon') {
      const values = String(attrs.points || '').split(/[\s,]+/).filter(Boolean).map(Number);
      const points = [];
      for (let i = 0; i + 1 < values.length; i += 2) points.push([values[i], values[i + 1]]);
      draw(style, [{ points, closed: name === 'polygon' }]);
    } else if (name === 'rect') {
      const x = num('x');
      const y = num('y');
      const w = num('width');
      const h = num('height');
      if (!(w > 0 && h > 0)) return;
      let rx = attrs.rx !== undefined ? num('rx') : attrs.ry !== undefined ? num('ry') : 0;
      let ry = attrs.ry !== undefined ? num('ry') : rx;
      rx = Math.min(Math.max(0, rx), w / 2);
      ry = Math.min(Math.max(0, ry), h / 2);
      const points = rx > 0 && ry > 0
        ? flattenPath(`M ${x + rx} ${y} H ${x + w - rx} A ${rx} ${ry} 0 0 1 ${x + w} ${y + ry} V ${y + h - ry} A ${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h} H ${x + rx} A ${rx} ${ry} 0 0 1 ${x} ${y + h - ry} V ${y + ry} A ${rx} ${ry} 0 0 1 ${x + rx} ${y} Z`)[0].points
        : [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
      draw(style, [{ points, closed: true }]);
    } else if (name === 'circle' || name === 'ellipse') {
      const cx = num('cx');
      const cy = num('cy');
      const rx = name === 'circle' ? num('r') : num('rx');
      const ry = name === 'circle' ? rx : num('ry');
      if (!(rx > 0 && ry > 0)) return;
      const m = style.matrix;
      // Kept round (a mirror or turn of a circle) it is drawn as one: exact at any scale.
      const uniform = Math.abs(m[0] - m[3]) < 1e-9 && Math.abs(m[1] + m[2]) < 1e-9;
      const mirrored = Math.abs(m[0] + m[3]) < 1e-9 && Math.abs(m[1] - m[2]) < 1e-9;
      if (rx === ry && (uniform || mirrored) && !style.dash) {
        const scaleOf = Math.hypot(m[0], m[1]);
        const [x, y] = apply(m, cx, cy);
        const r = rx * scaleOf;
        const fillColor = paint(style.fill, style.fillOpacity * style.opacity);
        if (fillColor) push([x, y, r, 0, 0, 0, 0, DISC], fillColor, style);
        const strokeColor = paint(style.stroke, style.strokeOpacity * style.opacity);
        const half = (style.strokeWidth * scaleOf) / 2;
        if (strokeColor && half > 0) push([x, y, r, 0, half, 0, 0, RING], strokeColor, style);
        return;
      }
      draw(style, flattenPath(`M ${cx + rx} ${cy} A ${rx} ${ry} 0 0 1 ${cx - rx} ${cy} A ${rx} ${ry} 0 0 1 ${cx + rx} ${cy} Z`));
    }
  };

  let match;
  while ((match = tag.exec(source))) {
    const [whole, closing, rawName, attrText, selfClosing] = match;
    if (!rawName) continue;
    const name = rawName;
    if (opaque) {
      if (name === opaque.name) {
        if (closing) {
          opaque.depth -= 1;
          if (!opaque.depth) opaque = null;
        } else if (!selfClosing) {
          opaque.depth += 1;
        }
      }
      continue;
    }
    if (closing) {
      // Close up to the matching element.
      while (stack.length > 1) {
        const top = stack.pop();
        if (removing && removing.depth === stack.length) {
          // The ink element and its contents (a title) are left out of the text drawing.
          kept.push(source.slice(keptFrom, removing.from));
          keptFrom = match.index + whole.length;
          removing = null;
        }
        if (top.name === name) break;
      }
      continue;
    }
    const attrs = attributesOf(attrText);
    const parent = stack[stack.length - 1];
    if (name === 'svg') {
      const style = { ...parent.style };
      const viewBox = String(attrs.viewBox || '').split(/[\s,]+/).filter(Boolean).map(Number);
      if (!box && viewBox.length === 4 && viewBox.every(Number.isFinite)) {
        box = { x: viewBox[0], y: viewBox[1], w: viewBox[2], h: viewBox[3] };
      } else if (stack.length > 1) {
        // A nested drawing: placed at x, y, its view box fitted into its size.
        const x = parseFloat(attrs.x) || 0;
        const y = parseFloat(attrs.y) || 0;
        let local = [1, 0, 0, 1, x, y];
        if (viewBox.length === 4 && viewBox[2] > 0 && viewBox[3] > 0) {
          const w = parseFloat(attrs.width) || viewBox[2];
          const h = parseFloat(attrs.height) || viewBox[3];
          const k = Math.min(w / viewBox[2], h / viewBox[3]);
          local = multiply(local, [k, 0, 0, k, (w - viewBox[2] * k) / 2 - viewBox[0] * k, (h - viewBox[3] * k) / 2 - viewBox[1] * k]);
        }
        style.matrix = multiply(parent.style.matrix, local);
      }
      if (!selfClosing) stack.push({ name, style: styleOf(style, { ...attrs, transform: undefined }) });
      continue;
    }
    if (TEXT.has(name)) hasText = hasText || !parent.style.hidden;
    if (OPAQUE.has(name)) {
      if (!selfClosing) opaque = { name, depth: 1 };
      continue;
    }
    const style = styleOf(parent.style, attrs);
    if (INK_ELEMENTS.has(name) && !removing) {
      shape(name, attrs, style);
      if (selfClosing) {
        kept.push(source.slice(keptFrom, match.index));
        keptFrom = match.index + whole.length;
        continue;
      }
      removing = { from: match.index, depth: stack.length };
    }
    if (!selfClosing) stack.push({ name, style });
  }
  tagWires();
  kept.push(source.slice(keptFrom));
  const textSvg = hasText ? kept.join('').replace(/\n{2,}/g, '\n') : null;
  const picturesSvg = textSvg && /<image\b/.test(textSvg)
    ? textSvg.replace(/<text\b[\s\S]*?<\/text>/g, '').replace(/<foreignObject\b[\s\S]*?<\/foreignObject>/g, '')
    : null;
  return { data: new Float32Array(out), count, textSvg, picturesSvg, box, tags };
}
