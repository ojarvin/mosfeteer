import { snap } from './grid.js';

/**
 * Interactive re-routing of an explicit wire polyline by dragging a segment.
 *
 * A route is an ordered list of grid points (endpoints are fixed component
 * terminals). A "run" is a maximal run of consecutive collinear (horizontal or
 * vertical) segments. Dragging a segment moves its whole run perpendicularly.
 *
 * Key behaviors:
 *  - The run may slide as far as an adjacent run; reaching it collapses the
 *    shared corner, and the now-invisible collinear vertex is removed.
 *  - The run never slides past a neighbor (no inverted folds).
 *  - A run touching a terminal endpoint keeps that pin fixed and EXTENDS the
 *    wire with an added connector segment so the pin stays connected.
 */

/** Maximal collinear run of the polyline containing segment `seg` (pts[seg-1]->pts[seg]). */
export function wireRunAt(pts, seg) {
  const n = pts.length;
  const i = Math.max(1, Math.min(seg, n - 1));
  const orient = pts[i - 1].y === pts[i].y ? 'h' : 'v';
  const val = orient === 'h' ? pts[i].y : pts[i].x;
  const same = (p) => (orient === 'h' ? p.y === val : p.x === val);
  let lo = i - 1;
  let hi = i;
  while (lo > 0 && same(pts[lo - 1])) lo--;
  while (hi < n - 1 && same(pts[hi + 1])) hi++;
  return { lo, hi, orient, val };
}

/**
 * Drop consecutive duplicates and any middle point collinear with its
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

/**
 * Move the maximal collinear run of orientation `orient` presently at
 * perpendicular line `line` to `target` (grid-snapped along the perpendicular
 * axis). The run may slide as far as an adjacent run (reaching it collapses the
 * shared corner, removing the now-invisible collinear vertex) but never past it
 * (no inverted folds). Runs touching a terminal endpoint keep that pin fixed and
 * EXTEND the wire with an added connector segment so the pin stays connected.
 * Returns the perpendicular line value the run actually ended on (== `line`
 * when nothing could move).
 */
export function moveWireRun(pts, orient, line, target) {
  const si = findRunLine(pts, orient, line);
  if (si < 0) return line;
  const run = wireRunAt(pts, si);
  const { lo, hi } = run;
  const n = pts.length;
  const loEnd = lo === 0;
  const hiEnd = hi === n - 1;
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

  // A run touching a terminal endpoint: keep the pin fixed and push the run away
  // from it, adding a connector segment so the wire still reaches the pin.
  if (loEnd && hiEnd) return val; // whole wire is a straight pin-to-pin run
  if (orient === 'h') {
    if (loEnd) {
      const px = pts[0].x;
      for (let i = 1; i <= hi; i++) pts[i].y = t;
      pts.splice(1, 0, { x: px, y: t });
    } else {
      const px = pts[n - 1].x;
      for (let i = lo; i <= n - 2; i++) pts[i].y = t;
      pts.splice(n - 1, 0, { x: px, y: t });
    }
  } else {
    if (loEnd) {
      const py = pts[0].y;
      for (let i = 1; i <= hi; i++) pts[i].x = t;
      pts.splice(1, 0, { x: t, y: py });
    } else {
      const py = pts[n - 1].y;
      for (let i = lo; i <= n - 2; i++) pts[i].x = t;
      pts.splice(n - 1, 0, { x: t, y: py });
    }
  }
  collapseCollinear(pts);
  return t;
}
