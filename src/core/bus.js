/**
 * Multi-bit nets: a net named with a bit range, `D[7:0]` or `D<7:0>`, is a
 * bus. It connects like any net (by its whole name); the drawing marks it
 * with a short slash across the wire. The mark belongs to the net, not to the
 * parts on it (the ADC and DAC draw none of their own), and it is drawn in
 * world space: a `/` whichever way the wire runs or the parts are turned.
 *
 * First iteration of the mark's placement: one slash per drawn branch, at
 * the middle of its longest straight segment, moved a cell along when a net
 * label sits there.
 */

import { GRID } from './grid.js';

const BUS_NAME = /^(.*?)[[<]\s*(\d+)\s*:\s*(\d+)\s*[\]>]$/;

/** Bits in a bus name (`D[7:0]` -> 8), or 0 for any other name. */
export function busWidth(name) {
  const match = BUS_NAME.exec(String(name ?? '').trim());
  return match && match[1] ? Math.abs(Number(match[2]) - Number(match[3])) + 1 : 0;
}

/** Half extents of the slash: one grid cell across the wire, leaning 3
 *  along it for every 4 across. */
const SLASH = { along: 15, across: 20 };

/**
 * Where a bus's slashes go on its drawn `paths`, keeping clear of the net
 * label anchors `avoid`: [{ x, y, horizontal }].
 */
export function busMarkPoints(paths, avoid = []) {
  const marks = [];
  for (const path of paths) {
    if (!path || path.length < 2) continue;
    let best = null;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      if (a.x !== b.x && a.y !== b.y) continue; // a diagonal keeps its own look
      const length = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
      if (length > 0 && (!best || length > best.length)) best = { a, b, length };
    }
    if (!best) continue;
    const { a, b, length } = best;
    const ux = Math.sign(b.x - a.x);
    const uy = Math.sign(b.y - a.y);
    const at = (t) => ({ x: a.x + ux * t, y: a.y + uy * t });
    let t = length / 2;
    const near = (p) => avoid.some((q) => Math.abs(q.x - p.x) + Math.abs(q.y - p.y) < GRID);
    if (near(at(t))) {
      const moved = [t - GRID, t + GRID].find((s) => s >= GRID / 2 && s <= length - GRID / 2 && !near(at(s)));
      if (moved !== undefined) t = moved;
    }
    marks.push({ ...at(t), horizontal: uy === 0 });
  }
  return marks;
}

/** SVG path data for a slash at `mark`: a `/` across the wire. */
export function busMarkD({ x, y, horizontal }) {
  const dx = horizontal ? SLASH.along : SLASH.across;
  const dy = horizontal ? SLASH.across : SLASH.along;
  return `M ${x - dx} ${y + dy} L ${x + dx} ${y - dy}`;
}
