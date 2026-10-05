/**
 * Pure geometry and decision helpers for pointer gestures.
 *
 * The editor owns the pointer state machine; these functions answer the
 * questions it asks (is this press a pin grab? which quick-add placement joins
 * the wire? which radial sector is the pointer in? which wire segments did a
 * knife stroke cross?) without touching the DOM or the model.
 */

import { applyTransform } from '../core/geometry.js';
import { pointOnPath } from '../core/wiring.js';

/** A press on a terminal of a multi-terminal part starts a wire when dragged.
 * Single-terminal parts (ground, supply, ports, markers) are mostly terminal,
 * so a drag on them keeps moving the part. */
export function isPinDragCandidate(def) {
  return (def?.terminals?.length || 0) >= 2;
}

/** Unit direction of the last non-degenerate segment of a polyline, or null. */
export function arrivalDirection(path) {
  if (!Array.isArray(path)) return null;
  for (let i = path.length - 1; i > 0; i--) {
    const dx = path[i].x - path[i - 1].x;
    const dy = path[i].y - path[i - 1].y;
    const length = Math.hypot(dx, dy);
    if (length > 0) return { x: dx / length, y: dy / length };
  }
  return null;
}

/** Choose the transform and terminal that land a new part on `point` with its
 * body continuing in the wire's arrival `direction`. The chosen terminal's
 * world position is exactly `point`; the origin follows from it.
 *
 * Multi-terminal parts score each rotation, mirror, and terminal by how well
 * the body continues the wire. Ties keep the `source` part's pose: its
 * rotation first, then its mirror deviation from its own symbol default, so a
 * part added from a mirrored transistor inherits that mirror while a gate still
 * lands gate-to-gate. Interface ports turn so their body lies beyond the drop
 * point, preferring a mirror over a rotation. Other single-terminal markers
 * (ground, supply, VCM) turn the same way, so their pin faces back along the
 * wire, preferring a rotation over a mirror; without a wire they stay upright. */
export function quickAddPlacement(def, point, direction = null, source = null) {
  const terminals = def?.terminals || [];
  const defaults = { mirrorX: !!def?.defaultMirrorX, mirrorY: !!def?.defaultMirrorY };
  const result = (transform, terminal, offset) => ({
    x: point.x - offset.x, y: point.y - offset.y,
    rotation: transform.rotation, mirrorX: transform.mirrorX, mirrorY: transform.mirrorY,
    terminal,
  });
  if (!terminals.length) return result({ rotation: 0, ...defaults }, null, { x: 0, y: 0 });
  const port = terminals.length === 1 && terminals[0].direction === 'port';
  const marker = terminals.length === 1 && !port;
  if (!direction) {
    const transform = { rotation: 0, ...defaults };
    return result(transform, terminals[0].name, applyTransform({ x: 0, y: 0, ...transform }, terminals[0].x, terminals[0].y));
  }
  // The pose the new part should echo when the wire leaves room for a choice.
  const preferred = {
    rotation: ((source?.rotation || 0) % 360 + 360) % 360,
    mirrorX: defaults.mirrorX !== (!!source?.mirrorX !== !!source?.defaultMirrorX),
    mirrorY: defaults.mirrorY !== (!!source?.mirrorY !== !!source?.defaultMirrorY),
  };
  const bbox = def.bbox || { x: 0, y: 0, w: 0, h: 0 };
  const body = { x: bbox.x + bbox.w / 2, y: bbox.y + bbox.h / 2 };
  const rotations = port ? [0, 180, 90, 270] : [0, 90, 180, 270];
  let best = null;
  for (const rotation of rotations) {
    for (const mirrorX of [defaults.mirrorX, !defaults.mirrorX]) {
      for (const mirrorY of [defaults.mirrorY, !defaults.mirrorY]) {
        const transform = { rotation, mirrorX, mirrorY };
        for (const terminal of terminals) {
          const offset = applyTransform({ x: 0, y: 0, ...transform }, terminal.x, terminal.y);
          let score;
          if (port || marker) {
            // A port's or marker's body lies beyond its pin, along the wire.
            const reach = applyTransform({ x: 0, y: 0, ...transform }, body.x - terminal.x, body.y - terminal.y);
            const length = Math.hypot(reach.x, reach.y);
            score = length ? (reach.x * direction.x + reach.y * direction.y) / length : -1;
          } else {
            const length = Math.hypot(offset.x, offset.y);
            // A terminal at the origin has no body direction to align.
            score = length ? (-offset.x * direction.x - offset.y * direction.y) / length : -1;
          }
          const turn = Math.min(Math.abs(rotation - preferred.rotation), 360 - Math.abs(rotation - preferred.rotation));
          const keep = port
            ? [rotation === 0 ? 0 : 1, mirrorY === defaults.mirrorY ? 0 : 1]
            : marker
            ? [(mirrorX === defaults.mirrorX ? 0 : 1) + (mirrorY === defaults.mirrorY ? 0 : 1), rotation === 0 ? 0 : 1]
            : [turn, (mirrorX === preferred.mirrorX ? 0 : 1) + (mirrorY === preferred.mirrorY ? 0 : 1)];
          const candidate = { score, keep, transform, terminal: terminal.name, offset };
          if (!best || betterQuickAdd(candidate, best)) best = candidate;
        }
      }
    }
  }
  return result(best.transform, best.terminal, best.offset);
}

function betterQuickAdd(a, b) {
  if (a.score > b.score + 1e-9) return true;
  if (a.score < b.score - 1e-9) return false;
  for (let i = 0; i < a.keep.length; i++) {
    if (a.keep[i] !== b.keep[i]) return a.keep[i] < b.keep[i];
  }
  return false;
}

/** Ring radius that leaves `gap` pixels between neighbouring round tiles of
 * diameter `tile` when `count` of them sit at equal angles. */
export function radialRingRadius(count, tile, gap) {
  if (count < 2) return 0;
  return Math.ceil((tile + gap) / (2 * Math.sin(Math.PI / count)));
}

/** Radial (marking) menu sector for a pointer offset. Sector 0 is straight up
 * and indices run clockwise. Inside the dead zone nothing is chosen (-1). */
export function radialSector(dx, dy, count, deadZone = 18) {
  if (!count || Math.hypot(dx, dy) < deadZone) return -1;
  const angle = Math.atan2(dx, -dy); // 0 = up, clockwise positive (screen y is down)
  const step = (Math.PI * 2) / count;
  return ((Math.round(angle / step) % count) + count) % count;
}

/** Segment intersection including touching endpoints; collinear overlap
 * counts as a crossing. */
export function segmentsIntersect(a, b, c, d) {
  const orient = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  const onSegment = (p, q, r) => Math.min(p.x, r.x) <= q.x && q.x <= Math.max(p.x, r.x)
    && Math.min(p.y, r.y) <= q.y && q.y <= Math.max(p.y, r.y);
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  return (o1 === 0 && onSegment(a, c, b)) || (o2 === 0 && onSegment(a, d, b))
    || (o3 === 0 && onSegment(c, a, d)) || (o4 === 0 && onSegment(c, b, d));
}

/** Wire segments crossed by a knife stroke. `paths` is
 * [{ netId, branch, pts }]; results are "netId:branch:segment" keys, the same
 * shape the editor uses for wire selection. */
export function knifeCrossings(stroke, paths) {
  const keys = new Set();
  if (!Array.isArray(stroke) || stroke.length < 2) return [];
  for (const { netId, branch, pts } of paths) {
    for (let segment = 1; segment < (pts?.length || 0); segment++) {
      const a = pts[segment - 1];
      const b = pts[segment];
      for (let i = 1; i < stroke.length; i++) {
        if (segmentsIntersect(stroke[i - 1], stroke[i], a, b)) {
          keys.add(`${netId}:${branch}:${segment}`);
          break;
        }
      }
    }
  }
  return [...keys];
}

/** Does a knife stroke touch a polyline? */
export function strokeCrossesPolyline(stroke, pts) {
  if (!Array.isArray(stroke) || stroke.length < 2 || !Array.isArray(pts)) return false;
  for (let i = 1; i < stroke.length; i++) {
    for (let j = 1; j < pts.length; j++) {
      if (segmentsIntersect(stroke[i - 1], stroke[i], pts[j - 1], pts[j])) return true;
    }
  }
  return false;
}

/** Does a knife stroke enter a rectangle { x, y, w, h }? A stroke point
 * inside it counts, as does a segment crossing its edge. */
export function strokeCrossesRect(stroke, rect) {
  if (!Array.isArray(stroke) || !stroke.length || !rect || rect.w <= 0 || rect.h <= 0) return false;
  const inside = (p) => p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h;
  if (stroke.some(inside)) return true;
  const { x, y, w, h } = rect;
  return strokeCrossesPolyline(stroke, [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }, { x, y }]);
}

/** A two-terminal part dropped with both terminals on one straight wire
 * segment can be spliced into it. Returns the segment, or null. */
export function spliceCandidate(terminalPoints, paths) {
  if (terminalPoints?.length !== 2) return null;
  const [p, q] = terminalPoints;
  if (p.x !== q.x && p.y !== q.y) return null;
  const within = (point, a, b) => (a.x === b.x
    ? point.x === a.x && point.y >= Math.min(a.y, b.y) && point.y <= Math.max(a.y, b.y)
    : a.y === b.y && point.y === a.y && point.x >= Math.min(a.x, b.x) && point.x <= Math.max(a.x, b.x));
  for (const { netId, branch, pts } of paths) {
    for (let segment = 1; segment < (pts?.length || 0); segment++) {
      const a = pts[segment - 1];
      const b = pts[segment];
      if (within(p, a, b) && within(q, a, b)) return { netId, branch, segment, a: { ...a }, b: { ...b } };
    }
  }
  return null;
}

/**
 * Which end of a spliced segment the signal comes from: 'a' or 'b' (the
 * segment's `a` and `b` as spliceCandidate returns them), or null. `paths`
 * are the net's branches, `drivers` the points of what drives it (a
 * signal-flow output pin or an input port). With the segment cut, the end
 * still joined to a driver is upstream.
 */
export function upstreamEnd(target, paths, drivers) {
  if (!target || !drivers?.length) return null;
  const key = (p) => `${p.x},${p.y}`;
  const edges = new Map();
  const link = (p, q) => {
    for (const [from, to] of [[p, q], [q, p]]) {
      if (!edges.has(key(from))) edges.set(key(from), []);
      edges.get(key(from)).push(to);
    }
  };
  paths.forEach((pts, branch) => {
    for (let i = 1; i < pts.length; i++) {
      if (branch === target.branch && i === target.segment) continue;
      // Whole-cell steps, so a pin or junction mid-way along a segment joins it.
      const a = pts[i - 1];
      const b = pts[i];
      const n = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) / 40;
      if (!Number.isInteger(n) || n < 1) { link(a, b); continue; }
      for (let k = 0; k < n; k++) link({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n }, { x: a.x + ((b.x - a.x) * (k + 1)) / n, y: a.y + ((b.y - a.y) * (k + 1)) / n });
    }
  });
  const goals = new Set(drivers.map(key));
  const reaches = (start) => {
    const seen = new Set([key(start)]);
    const queue = [start];
    while (queue.length) {
      const p = queue.shift();
      if (goals.has(key(p))) return true;
      for (const q of edges.get(key(p)) || []) if (!seen.has(key(q))) { seen.add(key(q)); queue.push(q); }
    }
    return false;
  };
  const fromA = reaches(target.a);
  const fromB = reaches(target.b);
  return fromA === fromB ? null : fromA ? 'a' : 'b';
}

/**
 * A signal-flow part (an `in` and an `out` pin) dropped on a wire: the
 * rotation that lays it along the wire with its input toward the signal's
 * source, as `{ rotation, target }`, or null where none splices. `pinsAt`
 * gives a rotation's world `{ in, out }`; `paths` are spliceCandidate's;
 * `upstream(target)` is 'a', 'b', or null (any direction then, the first
 * rotation that fits).
 */
export function signalSpliceRotation(pinsAt, paths, upstream) {
  let fallback = null;
  for (const rotation of [0, 90, 180, 270]) {
    const pins = pinsAt(rotation);
    const target = spliceCandidate([pins.in, pins.out], paths);
    if (!target) continue;
    const side = upstream(target);
    if (!side) { fallback ||= { rotation, target }; continue; }
    const from = target[side];
    const distance = (p) => Math.abs(p.x - from.x) + Math.abs(p.y - from.y);
    if (distance(pins.in) < distance(pins.out)) return { rotation, target };
  }
  return fallback;
}

/** Radius (world units) of a pin handle. It scales with the drawing like the
 * pin itself, but stays between `minPx` and `maxPx` on screen so it neither
 * vanishes when zoomed out nor swells when zoomed in. `unitsPerPx` is world
 * units per screen pixel. */
export function pinHandleRadius(unitsPerPx, { world = 6, minPx = 2, maxPx = 4.5 } = {}) {
  const scale = Number.isFinite(unitsPerPx) && unitsPerPx > 0 ? unitsPerPx : 1;
  return Math.min(Math.max(world, minPx * scale), maxPx * scale);
}

/** What a wheel event means. `mouse` zooms on every wheel (the historical
 * behavior); `trackpad` pans two-finger scrolls and zooms on pinch, which
 * browsers report as a ctrl-modified wheel. */
export function wheelIntent(ev, scheme = 'mouse') {
  if (ev.ctrlKey || ev.metaKey) return 'zoom';
  return scheme === 'trackpad' ? 'pan' : 'zoom';
}

/** Ease-out cubic for view animations. */
export function easeOutCubic(t) {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - (1 - clamped) ** 3;
}

/** Interpolate two view rectangles. */
/** Ease in and out: a camera move that starts and lands gently. */
export function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/**
 * A view between `from` and `to` at `t` (0..1) as one camera move: the
 * scale changes geometrically (each moment zooms by the same factor) about
 * the world point both views show at the same place on screen, so a zoom into
 * a design heads straight for it instead of drifting. Views of one size pan.
 */
export function zoomView(from, to, t) {
  const k = easeInOutCubic(t);
  const ratio = to.w / from.w;
  if (Math.abs(ratio - 1) < 1e-6) {
    return { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k, w: to.w, h: to.h };
  }
  const f = ratio ** k;
  // The fixed point: from and to put it at the same fraction of the pane.
  const fx = (to.x * from.w - from.x * to.w) / (from.w - to.w);
  const fy = (to.y * from.h - from.y * to.h) / (from.h - to.h);
  return { x: fx + (from.x - fx) * f, y: fy + (from.y - fy) * f, w: from.w * f, h: from.h * f };
}

export function lerpView(from, to, t) {
  const k = easeOutCubic(t);
  return {
    x: from.x + (to.x - from.x) * k,
    y: from.y + (to.y - from.y) * k,
    w: from.w + (to.w - from.w) * k,
    h: from.h + (to.h - from.h) * k,
  };
}

/**
 * Which of `pins` ({x, y, netId}) will join something when the parts carrying
 * them land: another part's pin, a free end of a managed wire, or -- for a pin
 * on no net yet -- the middle of one managed wire, which it tees into
 * (Circuit#teeTerminalsOntoWires). `carried` names the parts that move with
 * the pins, which are never targets. A pin already on the only net standing
 * there joins nothing new.
 */
export function pinJoinPoints(circuit, pins, carried = new Set()) {
  if (!pins.length) return [];
  const targets = new Map(); // "x,y" -> ids of the nets already there
  const add = (x, y, netId) => {
    const key = `${x},${y}`;
    if (!targets.has(key)) targets.set(key, new Set());
    targets.get(key).add(netId);
  };
  const standing = new Set();
  for (const component of circuit.components.values()) {
    if (carried.has(component.refdes)) continue;
    for (const t of component.worldTerminals()) {
      standing.add(`${t.x},${t.y}`);
      add(t.x, t.y, circuit.netOfTerminal({ comp: component.refdes, term: t.name })?.id || null);
    }
  }
  const carriedNets = new Set(pins.map((pin) => pin.netId).filter(Boolean));
  for (const net of circuit.nets.values()) {
    if (net.routingMode === 'fixed' || carriedNets.has(net.id)) continue;
    const paths = net.paths();
    paths.forEach((path, index) => {
      if (path.length < 2) return;
      for (const end of [path[0], path.at(-1)]) {
        if (standing.has(`${end.x},${end.y}`)) continue;
        if (net.junctions.some((p) => p.x === end.x && p.y === end.y)) continue;
        if (paths.some((other, i) => i !== index && pointOnPath(end, other))) continue;
        add(end.x, end.y, net.id);
      }
    });
  }
  const managed = [...circuit.nets.values()].filter((net) => net.routingMode !== 'fixed' && !carriedNets.has(net.id));
  const points = new Map();
  for (const pin of pins) {
    const there = targets.get(`${pin.x},${pin.y}`);
    const tee = !there && !pin.netId
      && managed.filter((net) => net.paths().some((path) => pointOnPath(pin, path))).length === 1;
    if (tee || (there && !(pin.netId && there.size === 1 && there.has(pin.netId)))) points.set(`${pin.x},${pin.y}`, { x: pin.x, y: pin.y });
  }
  return [...points.values()];
}
