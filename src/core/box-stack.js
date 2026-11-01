/**
 * A stacked box: a box annotation drawn with offset copies of its outline
 * behind it, for a block repeated in parallel (an "8x Sub-ADC"). The copies
 * are ink only -- they place, route, connect, and analyze nothing -- and each
 * draws only the part of its outline the copies in front of it leave
 * uncovered, so the stack needs no fill.
 *
 * A wire between two stacks of the same step and copy count is drawn
 * repeated too, once per copy, shifted by the step and cut where a nearer
 * copy covers it; so is a wire from a stack to a free wire end. A wire into
 * a stack may fan (`Net#fans`, the stacked boxes it fans into), on any
 * side: a diagonal along the step a cell clear of the stack, and from it one
 * short wire into each copy, up to where a nearer copy covers that one.
 */

import { GRID } from './grid.js';

/** A new stack: three copies half a cell up and right. */
export const STACK_DEFAULT = Object.freeze({ copies: 3, dx: GRID / 2, dy: -GRID / 2 });
export const STACK_MAX_COPIES = 8;
/** The largest step between copies, either way, in drawing units. */
export const STACK_MAX_STEP = 2 * GRID;

const EPS = 1e-6;

/** Why `stack` ({ copies, dx, dy }) is not a stack, or null when it is. */
export function stackError(stack) {
  if (!stack || typeof stack !== 'object') return 'a stack is { copies, dx, dy }';
  const { copies, dx, dy } = stack;
  if (!Number.isInteger(copies) || copies < 1 || copies > STACK_MAX_COPIES) return `a stack has 1 to ${STACK_MAX_COPIES} copies`;
  if (![dx, dy].every((d) => Number.isInteger(d) && Math.abs(d) <= STACK_MAX_STEP)) return `a stack's step is whole units, at most ${STACK_MAX_STEP} either way`;
  if (dx === 0 && dy === 0) return 'a stack\'s step is not zero';
  return null;
}

/** `value` as a stack, or null when it is none or not one. */
export function normalizeStack(value) {
  if (!value || typeof value !== 'object') return null;
  const stack = { copies: Number(value.copies), dx: Number(value.dx), dy: Number(value.dy) };
  return stackError(stack) ? null : stack;
}

/** The box's own rectangle and its copies', front first:
 *  [front, copy 1, ..., copy n]. */
export function stackRects(rect, stack) {
  const rects = [rect];
  for (let k = 1; k <= (stack?.copies || 0); k++) rects.push({ x: rect.x + k * stack.dx, y: rect.y + k * stack.dy, w: rect.w, h: rect.h });
  return rects;
}

/** The parameter interval of segment a-b inside the open rectangle `r`, or
 *  null (Liang-Barsky); a segment along an edge is not inside. */
function insideInterval(a, b, r) {
  const dx = b.x - a.x; const dy = b.y - a.y;
  let t0 = 0; let t1 = 1;
  for (const [p, q] of [[-dx, a.x - r.x], [dx, r.x + r.w - a.x], [-dy, a.y - r.y], [dy, r.y + r.h - a.y]]) {
    if (Math.abs(p) < EPS) {
      if (q <= EPS) return null;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
  }
  return t1 - t0 > EPS ? [t0, t1] : null;
}

/** Whether segment a-b runs through the inside of rectangle `r`. */
export const segmentEnters = (a, b, r) => !!insideInterval(a, b, r);

/** The parameter intervals of segment a-b outside every open rectangle in
 *  `rects`, in order. */
function outsideIntervals(a, b, rects) {
  let kept = [[0, 1]];
  for (const r of rects) {
    const cut = insideInterval(a, b, r);
    if (!cut) continue;
    kept = kept.flatMap(([s, e]) => [[s, Math.min(e, cut[0])], [Math.max(s, cut[1]), e]].filter(([u, v]) => v - u > EPS));
  }
  return kept;
}

const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const samePoint = (a, b) => Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS;

/** The polyline `points` with what lies inside `rects` cut out: the
 *  polylines left, each { points, first, last } where `first`/`last` say
 *  whether that end is the polyline's own. */
export function polylineOutside(points, rects) {
  const pieces = [];
  let open = null;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]; const b = points[i];
    for (const [s, e] of outsideIntervals(a, b, rects)) {
      const from = lerp(a, b, s); const to = lerp(a, b, e);
      if (open && s < EPS && samePoint(open.points.at(-1), from)) open.points.push(to);
      else {
        if (open) pieces.push(open);
        open = { points: [from, to], first: i === 1 && s < EPS, last: false };
      }
      open.last = i === points.length - 1 && e > 1 - EPS;
    }
    // A cut ends the piece.
    if (open && !samePoint(open.points.at(-1), b)) {
      pieces.push(open);
      open = null;
    }
  }
  if (open) pieces.push(open);
  return pieces;
}

/** The visible outline of a stacked box's copies: segments [{ a, b }], each
 *  copy's edges less what the copies in front of it cover. */
export function stackOutline(rect, stack) {
  const rects = stackRects(rect, stack);
  const segments = [];
  for (let k = 1; k < rects.length; k++) {
    const { x, y, w, h } = rects[k];
    const corners = [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
    for (let i = 0; i < 4; i++) {
      const a = corners[i]; const b = corners[(i + 1) % 4];
      for (const [s, e] of outsideIntervals(a, b, rects.slice(0, k))) segments.push({ a: lerp(a, b, s), b: lerp(a, b, e) });
    }
  }
  return segments;
}

/** `segments` chained end to end into polylines, so a corner is one joined
 *  stroke rather than two capped ones. */
export function joinSegments(segments) {
  const left = segments.map((s) => [s.a, s.b]);
  const lines = [];
  while (left.length) {
    const line = left.pop();
    for (let grown = true; grown;) {
      grown = false;
      for (let i = 0; i < left.length; i++) {
        const [a, b] = left[i];
        if (samePoint(line.at(-1), a)) line.push(b);
        else if (samePoint(line.at(-1), b)) line.push(a);
        else if (samePoint(line[0], b)) line.unshift(a);
        else if (samePoint(line[0], a)) line.unshift(b);
        else continue;
        left.splice(i, 1);
        grown = true;
        break;
      }
    }
    lines.push(line);
  }
  return lines;
}

/** A box annotation's rectangle. */
const boxRect = (box) => ({
  x: Math.min(box.anchor.x, box.end.x),
  y: Math.min(box.anchor.y, box.end.y),
  w: Math.abs(box.end.x - box.anchor.x),
  h: Math.abs(box.end.y - box.anchor.y),
});

/** Every stacked box of `circuit`: [{ box, rect, stack, rects }]. */
export function stackedBoxes(circuit) {
  const out = [];
  for (const label of circuit.labels.values()) {
    if (label.kind !== 'box' || !label.stack) continue;
    const rect = boxRect(label);
    out.push({ box: label, rect, stack: label.stack, rects: stackRects(rect, label.stack) });
  }
  return out;
}

const onEdge = (p, r) => {
  const inX = p.x > r.x - EPS && p.x < r.x + r.w + EPS;
  const inY = p.y > r.y - EPS && p.y < r.y + r.h + EPS;
  return inX && inY && (Math.abs(p.x - r.x) < EPS || Math.abs(p.x - r.x - r.w) < EPS || Math.abs(p.y - r.y) < EPS || Math.abs(p.y - r.y - r.h) < EPS);
};

const sameStep = (s, t) => s.copies === t.copies && s.dx === t.dx && s.dy === t.dy;

/** How far past the last copy a fan's diagonal is. */
export const FAN_CLEAR = GRID;

/** Where a wire piece meets a stack: the end `at` on its front edge, `out`,
 *  the unit direction the wire leaves it in, and `reach`, how far out the
 *  fan's diagonal starts. */
function crossing(points, atStart, side) {
  const at = atStart ? points[0] : points.at(-1);
  const next = atStart ? points.find((p) => !samePoint(p, at)) : [...points].reverse().find((p) => !samePoint(p, at));
  if (!next) return null;
  const len = Math.hypot(next.x - at.x, next.y - at.y);
  const out = { x: (next.x - at.x) / len, y: (next.y - at.y) / len };
  // The diagonal a cell clear of the stack at both ends: on a side the
  // copies stand out on, past the last; on a side they hide behind the box,
  // its far end a cell from the box. As far as the wire runs straight.
  const along = Math.abs(out.x * side.stack.dx + out.y * side.stack.dy);
  return { at, out, reach: Math.min(side.stack.copies * along + FAN_CLEAR, len) };
}

/** A fan at `c` (crossing) into stack `side`: the diagonal along the step a
 *  reach out, and one short wire from it into each copy, cut where a nearer
 *  copy covers it. */
function fanLines(c, side) {
  const { copies, dx, dy } = side.stack;
  const from = { x: c.at.x + c.out.x * c.reach, y: c.at.y + c.out.y * c.reach };
  const far = { x: from.x + copies * dx, y: from.y + copies * dy };
  const lines = [];
  let last = null;
  for (let k = 1; k <= copies; k++) {
    const drop = [{ x: from.x + k * dx, y: from.y + k * dy }, { x: c.at.x + k * dx, y: c.at.y + k * dy }];
    for (const part of polylineOutside(drop, side.rects.slice(0, k))) {
      if (k === copies && part.first) last = part.points;
      else lines.push(part.points);
    }
  }
  // The last copy's wire and the diagonal turn one corner, so it does not
  // poke out; the others end on the diagonal.
  lines.push(last ? [...[...last].reverse().slice(0, -1), far, from] : [far, from]);
  return lines;
}

/** The pieces of `paths` outside the stacked boxes, each with the stacks
 *  its ends are on: [{ branch, piece, from, to }]. */
function stackPieces(paths, stacks) {
  const fronts = stacks.map((s) => s.rect);
  const at = (p) => stacks.find((s) => onEdge(p, s.rect)) || null;
  const out = [];
  paths.forEach((path, branch) => {
    if (!path || path.length < 2) return;
    for (const piece of polylineOutside(path, fronts)) out.push({ branch, piece, from: at(piece.points[0]), to: at(piece.points.at(-1)) });
  });
  return out;
}

/** The stacked boxes a net's `paths` can fan into: those a piece of it
 *  enters, on any side, unless it runs on to a stack it is repeated to. */
export function fanStacks(circuit, paths, stacks = stackedBoxes(circuit)) {
  const found = new Set();
  for (const { piece, from, to } of stackPieces(paths, stacks)) {
    if (from && to && from !== to && sameStep(from.stack, to.stack)) continue;
    if (from && crossing(piece.points, true, from)) found.add(from.box);
    if (to && to !== from && crossing(piece.points, false, to)) found.add(to.box);
  }
  return [...found];
}

/**
 * The repeated wires of one net's drawn `paths` (net.paths()): its pieces
 * outside every stacked box that run from a stack to a stack of the same
 * step and copy count, or from a stack to a free wire end, each shifted once
 * per copy and cut where a nearer copy of either end's stack covers it; and
 * the fans into the stacks named in `fans` (box ids, `Net#fans`). Returns
 * [{ branch, points, start, end, fan }], `start`/`end` true where the echo
 * keeps the path's own end (and so its arrowhead), `fan` on a fan's lines,
 * whose ends meet other lines and are drawn flush.
 */
export function wireEchoes(circuit, paths, stacks = stackedBoxes(circuit), fans = []) {
  if (!stacks.length) return [];
  let pins = null;
  const isPin = (p) => {
    if (!pins) {
      pins = new Set();
      for (const c of circuit.components.values()) for (const t of c.worldTerminals()) pins.add(`${t.x},${t.y}`);
    }
    return pins.has(`${p.x},${p.y}`);
  };
  // A path end met by no other path of the net and no pin is free.
  const ends = new Map();
  for (const path of paths) for (const p of [path[0], path.at(-1)]) if (p) ends.set(`${p.x},${p.y}`, (ends.get(`${p.x},${p.y}`) || 0) + 1);
  const touches = (p) => paths.some((path) => path.some((q, i) => i > 0 && i < path.length - 1 && samePoint(p, q)));
  const isFree = (p) => ends.get(`${p.x},${p.y}`) === 1 && !touches(p) && !isPin(p);
  const fanned = (side) => side && fans.includes(side.box.id);
  const echoes = [];
  for (const { branch, piece, from, to } of stackPieces(paths, stacks)) {
    const head = piece.points[0]; const tail = piece.points.at(-1);
    let sides = null;
    if (from && to) {
      if (from !== to && sameStep(from.stack, to.stack)) sides = [from, to];
    } else if ((from && !fanned(from)) || (to && !fanned(to))) {
      const loose = from ? (piece.last && tail) : (piece.first && head);
      if (loose && isFree(loose)) sides = [from || to];
    }
    if (sides) {
      const { copies, dx, dy } = sides[0].stack;
      for (let k = 1; k <= copies; k++) {
        const shifted = piece.points.map((p) => ({ x: p.x + k * dx, y: p.y + k * dy }));
        const covers = sides.flatMap((s) => s.rects.slice(0, k));
        for (const part of polylineOutside(shifted, covers)) {
          echoes.push({
            branch,
            points: part.points,
            start: part.first && piece.first && !from,
            end: part.last && piece.last && !to,
          });
        }
      }
      continue;
    }
    for (const [side, atStart] of [[from, true], [to, false]]) {
      if (!fanned(side) || (!atStart && side === from)) continue;
      const c = crossing(piece.points, atStart, side);
      if (c) for (const points of fanLines(c, side)) echoes.push({ branch, points, start: false, end: false, fan: true });
    }
  }
  return echoes;
}
