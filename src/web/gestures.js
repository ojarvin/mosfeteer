/**
 * Pure geometry and decision helpers for pointer gestures.
 *
 * The editor owns the pointer state machine; these functions answer the
 * questions it asks (is this press a pin grab? which quick-add placement joins
 * the wire? which radial sector is the pointer in? which wire segments did a
 * knife stroke cross?) without touching the DOM or the model.
 */

import { applyTransform } from '../core/geometry.js';

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

/** Choose the rotation and terminal that land a new part on `point` with its
 * body continuing in the wire's arrival `direction`. The chosen terminal's
 * world position is exactly `point`; the origin follows from it. Rotation 0 and
 * the first terminal win ties so common parts keep their textbook pose. */
export function quickAddPlacement(def, point, direction = null) {
  const terminals = def?.terminals || [];
  const mirror = { mirrorX: !!def?.defaultMirrorX, mirrorY: !!def?.defaultMirrorY };
  if (!terminals.length) return { x: point.x, y: point.y, rotation: 0, terminal: null };
  if (terminals.length === 1 || !direction) {
    const offset = applyTransform({ x: 0, y: 0, rotation: 0, ...mirror }, terminals[0].x, terminals[0].y);
    return { x: point.x - offset.x, y: point.y - offset.y, rotation: 0, terminal: terminals[0].name };
  }
  let best = null;
  for (const rotation of [0, 90, 180, 270]) {
    for (const terminal of terminals) {
      const offset = applyTransform({ x: 0, y: 0, rotation, ...mirror }, terminal.x, terminal.y);
      const length = Math.hypot(offset.x, offset.y);
      // A terminal at the origin has no body direction to align.
      const score = length ? (-offset.x * direction.x - offset.y * direction.y) / length : -1;
      if (!best || score > best.score + 1e-9) best = { score, rotation, terminal: terminal.name, offset };
    }
  }
  return { x: point.x - best.offset.x, y: point.y - best.offset.y, rotation: best.rotation, terminal: best.terminal };
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
export function lerpView(from, to, t) {
  const k = easeOutCubic(t);
  return {
    x: from.x + (to.x - from.x) * k,
    y: from.y + (to.y - from.y) * k,
    w: from.w + (to.w - from.w) * k,
    h: from.h + (to.h - from.h) * k,
  };
}
