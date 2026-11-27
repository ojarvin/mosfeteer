/**
 * The wires' shared ink path (render.js `wire-ink`) with its pieces joined
 * where one runs on into another: a part's lead into the wire at its pin,
 * a wire into the next. Two pieces whose square caps overlap there draw the
 * same ink as one line through the point, but a viewer that smooths each
 * piece's edges on its own (some PDF viewers) paints the overlap's edge
 * twice, a bump at every pin. Joined, there is no overlap.
 *
 * Pieces join only where the ink is unchanged: end to end at one point, or
 * a lead stopped half a stroke short of the point the other starts at (its
 * cap reaching it), the two running straight on or turning a right angle
 * (a mitre there covers what the two caps did); and only where exactly two
 * ends meet -- three or more are a junction, left as they are.
 */

const round = (v) => Math.round(v * 100) / 100;
const key = (p) => `${round(p.x)},${round(p.y)}`;

/** The polylines of SVG path data made of M and L commands; null for any
 *  other command (that path is left as it is). */
function polylines(d) {
  const tokens = String(d).trim().split(/[\s,]+/).filter(Boolean);
  const lines = [];
  for (let i = 0; i < tokens.length;) {
    const command = tokens[i];
    if (command !== 'M' && command !== 'L') return null;
    const p = { x: Number(tokens[i + 1]), y: Number(tokens[i + 2]) };
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    if (command === 'M') lines.push([p]);
    else if (lines.length) lines.at(-1).push(p);
    else return null;
    i += 3;
  }
  return lines.filter((line) => line.length >= 2);
}

/** An end of a line: its point, the way it points out, and where its
 *  square cap reaches. */
function lineEnd(line, index, atStart, half) {
  const p = atStart ? line[0] : line.at(-1);
  const q = atStart ? line[1] : line.at(-2);
  const length = Math.hypot(p.x - q.x, p.y - q.y) || 1;
  const out = { x: (p.x - q.x) / length, y: (p.y - q.y) / length };
  return { index, atStart, p, out, reach: { x: p.x + out.x * half, y: p.y + out.y * half } };
}

/** Whether ends `a` and `b` meet as one line would pass through: where
 *  they meet, and that their directions are straight on or a right angle. */
function meeting(a, b) {
  const dot = a.out.x * b.out.x + a.out.y * b.out.y;
  // Straight on: the outward directions are opposite. A right angle: square.
  const straight = Math.abs(dot + 1) < 1e-6;
  const square = Math.abs(dot) < 1e-6;
  if (key(a.p) === key(b.p)) return straight || square;
  // One stops half a stroke short of the other's point, its cap reaching it.
  if (key(a.reach) === key(b.p) || key(b.reach) === key(a.p)) return straight || square;
  return false;
}

/**
 * Join the pieces of `ds` (path data strings of one ink path, square caps,
 * stroke `width`) into as few lines as the ink allows. Returns path data.
 */
export function joinInkPaths(ds, width) {
  const half = width / 2;
  const kept = [];
  const lines = [];
  for (const d of ds) {
    const parsed = polylines(d);
    if (parsed) lines.push(...parsed);
    else kept.push(d);
  }
  if (!(half > 0)) return [...kept, ...lines.map(lineD)].join(' ');
  // Every end, found by its point and by where its cap reaches.
  const ends = lines.flatMap((line, index) => [lineEnd(line, index, true, half), lineEnd(line, index, false, half)]);
  const byPoint = new Map();
  for (const end of ends) for (const k of new Set([key(end.p), key(end.reach)])) byPoint.set(k, [...(byPoint.get(k) || []), end]);
  // The one other end an end could join, if there is exactly one.
  const partner = (end) => {
    const near = new Set([...(byPoint.get(key(end.p)) || []), ...(byPoint.get(key(end.reach)) || [])]);
    near.delete(end);
    // Any other end at the same point makes it a junction.
    const all = [...near].filter((other) => other.index !== end.index || other.atStart !== end.atStart);
    if (all.length !== 1) return null;
    return meeting(end, all[0]) ? all[0] : null;
  };
  const links = new Map();
  for (const end of ends) {
    const other = partner(end);
    if (other && other.index !== end.index && partner(other) === end) links.set(end, other);
  }
  // Walk each chain from an end with no link (or any end of a loop).
  const endOf = (index, atStart) => ends[index * 2 + (atStart ? 0 : 1)];
  const used = new Set();
  const out = [];
  const walk = (index, fromStart) => {
    const points = [];
    let current = index;
    let enterAtStart = fromStart;
    while (current !== null && !used.has(current)) {
      used.add(current);
      const line = enterAtStart ? lines[current] : [...lines[current]].reverse();
      points.push(...line);
      const exit = endOf(current, !enterAtStart);
      const next = links.get(exit);
      // From one end's point straight on to the other's: the short one's
      // cap reached it, so the ink is the same.
      if (!next || used.has(next.index)) break;
      current = next.index;
      enterAtStart = next.atStart;
    }
    return points;
  };
  for (let index = 0; index < lines.length; index++) {
    if (used.has(index)) continue;
    const startFree = !links.has(endOf(index, true));
    const endFree = !links.has(endOf(index, false));
    if (!startFree && !endFree) continue; // in a loop or mid-chain; later
    out.push(walk(index, startFree));
  }
  // Loops left: walked from anywhere, left open (the caps close them).
  for (let index = 0; index < lines.length; index++) if (!used.has(index)) out.push(walk(index, true));
  return [...kept, ...out.map((points) => lineD(dropRepeats(points)))].join(' ');
}

function dropRepeats(points) {
  return points.filter((p, i) => i === 0 || key(p) !== key(points[i - 1]));
}

const fmt = (v) => String(round(v));
function lineD(points) {
  return points.map((p, i) => `${i ? 'L' : 'M'} ${fmt(p.x)} ${fmt(p.y)}`).join(' ');
}
