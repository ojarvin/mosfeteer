import { GRID, snap } from './grid.js';

/**
 * Interactive re-routing of an explicit wire polyline by dragging a segment.
 * A route is an ordered list of grid points. By default a "run" is a maximal
 * run of consecutive collinear segments; callers may provide topology breaks
 * to treat aligned segments on either side of a terminal or junction
 * independently. Dragging a segment moves its bounded run perpendicularly.
 * `endpointMeta` identifies path endpoints as `{ type: 'terminal'|'junction' }`;
 * omitted metadata uses terminal-endpoint behavior.
 *
 * Key behaviors:
 *  - The run may slide as far as an adjacent run; reaching it collapses the
 *    shared corner, and the now-invisible collinear vertex is removed.
 *  - The run never slides past a neighbour (no inverted folds).
 *  - A run touching a terminal endpoint keeps that pin fixed and EXTENDS the
 *    wire with an added connector segment so the pin stays connected.
 *  - A standalone two-point bridge between two junctions moves both junction
 *    endpoints together; a standalone pin-to-pin run remains immovable.
 */

/** Collinear run containing segment `seg`, stopping at optional topology
 * points. Topology breaks let adjacent aligned branch segments move
 * independently when a junction sits between them. */
export function wireRunAt(pts, seg, breaks = null) {
  const n = pts.length;
  const i = Math.max(1, Math.min(seg, n - 1));
  const orient = pts[i - 1].y === pts[i].y ? 'h' : 'v';
  const val = orient === 'h' ? pts[i].y : pts[i].x;
  const same = (p) => (orient === 'h' ? p.y === val : p.x === val);
  const isBreak = (p) => breaks?.has(`${p.x},${p.y}`);
  let lo = i - 1;
  let hi = i;
  while (lo > 0 && same(pts[lo - 1]) && !isBreak(pts[lo])) lo--;
  while (hi < n - 1 && same(pts[hi + 1]) && !isBreak(pts[hi])) hi++;
  return { lo, hi, orient, val };
}

/** Drop consecutive duplicates and any middle point collinear with its
 * neighbours, in place. Endpoints (terminal pins) are always preserved.
 * Returns the new length.
 */
export function collapseCollinear(pts) {
  let i = pts.length - 2;
  while (i >= 1) {
    const a = pts[i - 1];
    const b = pts[i];
    const c = pts[i + 1];
    if ((a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y) || (a.x === b.x && a.y === b.y)) {
      pts.splice(i, 1);
    }
    i--;
  }
  return pts.length;
}

/** Index of a segment lying on the collinear run at perpendicular line `line`
 *  (a y for horizontal runs, an x for vertical runs), or -1 if none. */
export function findRunLine(pts, orient, line) {
  for (let i = 1; i < pts.length; i++) {
    const onLine = orient === 'h' ? pts[i].y === line : pts[i].x === line;
    if (!onLine) continue;
    const aligned = orient === 'h' ? pts[i - 1].y === pts[i].y : pts[i - 1].x === pts[i].x;
    if (aligned) return i;
  }
  return -1;
}

/** Move one junction in a managed branch set and rebuild each incident branch
 * endpoint with a local orthogonal elbow when the old and new locations are not
 * collinear with its neighbour. The caller owns the net object; this pure
 * helper mutates `paths` and returns the replacement junction list. */
export function moveJunctionEndpoint(paths, junctions, oldPoint, newPoint, endpointInfo = null) {
  if (oldPoint.x === newPoint.x && oldPoint.y === newPoint.y) return junctions;
  for (const path of paths || []) {
    for (let i = 0; i < path.length; i++) {
      const p = path[i];
      if (p.x !== oldPoint.x || p.y !== oldPoint.y) continue;
      const neighbor = i === 0 ? path[1] : path[i - 1];
      const oldHorizontal = neighbor && neighbor.y === oldPoint.y;
      const oldVertical = neighbor && neighbor.x === oldPoint.x;
      const otherIndex = i === 0 ? 1 : i === path.length - 1 ? path.length - 2 : -1;
      const otherMeta = otherIndex >= 0 && endpointInfo ? endpointInfo(path, otherIndex) : null;
      p.x = newPoint.x;
      p.y = newPoint.y;
      if (neighbor && p.x !== neighbor.x && p.y !== neighbor.y) {
        const candidates = oldHorizontal
          ? [{ x: neighbor.x, y: newPoint.y }, { x: newPoint.x, y: neighbor.y }]
          : oldVertical
            ? [{ x: newPoint.x, y: neighbor.y }, { x: neighbor.x, y: newPoint.y }]
            : [{ x: newPoint.x, y: neighbor.y }, { x: neighbor.x, y: newPoint.y }];
        const same = (a, b) => a.x === b.x && a.y === b.y;
        const step = (a, b) => ({ x: Math.sign(b.x - a.x), y: Math.sign(b.y - a.y) });
        const incoming = (q) => i === 0 ? step(q, neighbor) : step(neighbor, q);
        const desired = otherMeta?.type === 'terminal' && otherMeta.dir
          ? { x: -otherMeta.dir.x, y: -otherMeta.dir.y } : null;
        const valid = candidates.filter((q) =>
          !same(q, oldPoint) && !same(q, newPoint) && !same(q, neighbor)
        );
        const elbow = valid.find((q) =>
          (!desired || (incoming(q).x === desired.x && incoming(q).y === desired.y))
        );
        if (elbow) {
          path.splice(i === 0 ? 1 : i, 0, elbow);
        } else if (desired) {
          // Detour one extra grid cell outward from the terminal to preserve
          // pin conformity without retaining the junction coordinate.
          const sign = otherMeta.dir;
          const distance = same({ x: neighbor.x + sign.x * GRID, y: neighbor.y + sign.y * GRID }, oldPoint) ? 2 : 1;
          const pinLead = { x: neighbor.x + sign.x * GRID * distance, y: neighbor.y + sign.y * GRID * distance };
          const detours = newPoint.x === pinLead.x || newPoint.y === pinLead.y ? [] : [
            { x: newPoint.x, y: pinLead.y },
            { x: pinLead.x, y: newPoint.y },
          ];
          const detour = detours.find((q) => !same(q, oldPoint) && !same(q, newPoint) && !same(q, pinLead));
          const inserts = i === 0 ? [ ...(detour ? [detour] : []), pinLead ] : [ pinLead, ...(detour ? [detour] : []) ];
          path.splice(i === 0 ? 1 : i, 0, ...inserts);
        }
      }
    }
  }
  return (junctions || []).map((p) => (
    p.x === oldPoint.x && p.y === oldPoint.y ? { ...newPoint } : p
  ));
}

/**
 * Move the collinear run of orientation `orient` presently at perpendicular
 * line `line` to `target` (grid-snapped along the perpendicular axis).
 * `endpointMeta.runBounds` and `endpointMeta.breaks` may bound the run at
 * electrical topology points; otherwise the maximal run is used. The run may
 * slide as far as an adjacent run (reaching it collapses the shared corner)
 * but never past it (no inverted folds). Runs touching a terminal endpoint
 * keep that pin fixed and extend the wire with a connector segment.
 * `endpointMeta` is optional for compatibility with callers whose paths are
 * known to be terminal-ended: `{ start: { type }, end: { type } }`.
 * Returns the perpendicular line value the run actually ended on (== `line`
 * when nothing could move).
 */
export function moveWireRun(pts, orient, line, target, endpointMeta = null) {
  const si = Number.isInteger(endpointMeta?.segment)
    ? Math.max(1, Math.min(endpointMeta.segment, pts.length - 1))
    : findRunLine(pts, orient, line);
  if (si < 0) return line;
  const run = wireRunAt(pts, si, endpointMeta?.breaks);
  const forcedInterior = endpointMeta?.interiorRun === true;
  const lo = endpointMeta?.runBounds?.lo ?? (forcedInterior ? 1 : run.lo);
  const hi = endpointMeta?.runBounds?.hi ?? (forcedInterior ? pts.length - 2 : run.hi);
  const n = pts.length;
  const loEnd = lo === 0;
  const hiEnd = hi === n - 1;
  const startType = endpointMeta?.start?.type || 'terminal';
  const endType = endpointMeta?.end?.type || 'terminal';
  const startTerminal = startType === 'terminal';
  const endTerminal = endType === 'terminal';
  const val = line;
  const nv = (idx) => (orient === 'h' ? pts[idx].y : pts[idx].x);
  let lower = -Infinity;
  let upper = Infinity;
  if (!loEnd) {
    const v = nv(lo - 1);
    if (v < val) lower = Math.max(lower, v);
    else upper = Math.min(upper, v);
  }
  if (!hiEnd) {
    const v = nv(hi + 1);
    if (v < val) lower = Math.max(lower, v);
    else upper = Math.min(upper, v);
  }
  let t = snap(target);
  if (t < val) t = Math.max(t, lower);
  else if (t > val) t = Math.min(t, upper);
  if (t === val) return val;

  if (!loEnd && !hiEnd) {
    // Interior run: slide freely (possibly up to a neighbour to collapse).
    for (let i = lo; i <= hi; i++) {
      if (orient === 'h') pts[i].y = t;
      else pts[i].x = t;
    }
    collapseCollinear(pts);
    return t;
  }

  const boundedRun = !!endpointMeta?.runBounds;
  const anchoredStart = boundedRun && loEnd && (startTerminal || startType === 'junction');
  const anchoredEnd = boundedRun && hiEnd && (endTerminal || endType === 'junction');
  if (anchoredStart || anchoredEnd) {
    // A topology-bounded run moves without moving its electrical anchors.
    // Keep each terminal/junction fixed and add connector legs at the ends;
    // incident branches therefore remain stationary unless explicitly selected.
    if (anchoredStart && anchoredEnd) {
      const a = { ...pts[0] };
      const b = { ...pts[n - 1] };
      if (orient === 'h') {
        for (let i = 1; i < n - 1; i++) pts[i].y = t;
        pts.splice(1, 0, { x: a.x, y: t }, { x: b.x, y: t });
      } else {
        for (let i = 1; i < n - 1; i++) pts[i].x = t;
        pts.splice(1, 0, { x: t, y: a.y }, { x: t, y: b.y });
      }
      return t;
    }
    if (anchoredStart) {
      const p = { ...pts[0] };
      if (orient === 'h') {
        for (let i = 1; i <= hi; i++) pts[i].y = t;
        pts.splice(1, 0, { x: p.x, y: t });
      } else {
        for (let i = 1; i <= hi; i++) pts[i].x = t;
        pts.splice(1, 0, { x: t, y: p.y });
      }
      return t;
    }
    const p = { ...pts[n - 1] };
    if (orient === 'h') {
      for (let i = lo; i < n - 1; i++) pts[i].y = t;
      pts.splice(n - 1, 0, { x: p.x, y: t });
    } else {
      for (let i = lo; i < n - 1; i++) pts[i].x = t;
      pts.splice(n - 1, 0, { x: t, y: p.y });
    }
    return t;
  }

  // A standalone bridge is bounded by two real junctions rather than pins.
  // Without run bounds, move the whole bridge.
  if (loEnd && hiEnd && startType === 'junction' && endType === 'junction') {
    for (const p of pts) {
      if (orient === 'h') p.y = t;
      else p.x = t;
    }
    return t;
  }

  if (loEnd && hiEnd && startTerminal && endTerminal) {
    if (!boundedRun) return val;
    const a = { ...pts[0] };
    const b = { ...pts[n - 1] };
    if (orient === 'h') {
      pts.splice(1, 0, { x: a.x, y: t }, { x: b.x, y: t });
    } else {
      pts.splice(1, 0, { x: t, y: a.y }, { x: t, y: b.y });
    }
    return t;
  }
  if (orient === 'h') {
    if (loEnd && (!hiEnd || startTerminal)) {
      const px = pts[0].x;
      for (let i = 1; i <= hi; i++) pts[i].y = t;
      if (startTerminal) pts.splice(1, 0, { x: px, y: t });
      else pts[0].y = t;
    } else if (hiEnd) {
      const px = pts[n - 1].x;
      for (let i = lo; i <= n - 2; i++) pts[i].y = t;
      if (endTerminal) pts.splice(n - 1, 0, { x: px, y: t });
      else pts[n - 1].y = t;
    }
  } else {
    if (loEnd && (!hiEnd || startTerminal)) {
      const py = pts[0].y;
      for (let i = 1; i <= hi; i++) pts[i].x = t;
      if (startTerminal) pts.splice(1, 0, { x: t, y: py });
      else pts[0].x = t;
    } else if (hiEnd) {
      const py = pts[n - 1].y;
      for (let i = lo; i <= n - 2; i++) pts[i].x = t;
      if (endTerminal) pts.splice(n - 1, 0, { x: t, y: py });
      else pts[n - 1].x = t;
    }
  }
  collapseCollinear(pts);
  return t;
}
