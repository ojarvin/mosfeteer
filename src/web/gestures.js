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
 * (ground, supply, VCM) keep their only pose. */
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
  if (!direction || (terminals.length === 1 && !port)) {
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
          if (port) {
            // A port's body lies beyond its pin, along the wire.
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
