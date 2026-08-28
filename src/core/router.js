import { snap } from './grid.js';
import { segmentCrossesRect } from './geometry.js';

/**
 * Auto-routing helpers. All returned points are snapped to the 40-unit grid.
 */

export function snapP(p) {
  return { x: snap(p.x), y: snap(p.y) };
}

/**
 * Collapse a polyline: drop consecutive duplicates and any point that is
 * collinear with its neighbours (so output is the minimal list of corners).
 */
export function compressElbow(pts) {
  const out = [];
  for (const p of pts) {
    const q = { x: snap(p.x), y: snap(p.y) };
    const last = out[out.length - 1];
    if (last && last.x === q.x && last.y === q.y) continue;
    out.push(q);
  }
  for (let i = out.length - 2; i > 0; i--) {
    const a = out[i - 1];
    const b = out[i];
    const c = out[i + 1];
    if ((a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y)) {
      out.splice(i, 1);
    }
  }
  return out;
}

/** Simple auto-router: connects ordered points with orthogonal Manhattan
 *  segments; corners land on a grid-snapped midpoint. Used whenever a net has
 *  no explicit route. */
export function autoRoute(points) {
  if (points.length === 0) return [];
  if (points.length >= 3 && hasCenteredBranch(points)) return balancedRoute(points);
  return pruneRoute(simpleAutoRoute(points), points);
}

function simpleAutoRoute(points) {
  const out = [{ x: points[0].x, y: points[0].y }];
  for (let i = 1; i < points.length; i++) {
    const a = out[out.length - 1];
    const b = points[i];
    if (a.x === b.x && a.y === b.y) continue;
    if (a.x === b.x || a.y === b.y) {
      out.push({ x: b.x, y: b.y });
      continue;
    }
    // L-shaped bend. Prefer a corner on the horizontal span.
    let cx = snap((a.x + b.x) / 2);
    if (cx === a.x || cx === b.x) {
      // degenerate (adjacent columns) -> corner on the vertical span instead
      const cy = snap((a.y + b.y) / 2);
      if (cy === a.y || cy === b.y) {
        out.push({ x: b.x, y: b.y });
        continue;
      }
      out.push({ x: a.x, y: cy }, { x: b.x, y: cy }, { x: b.x, y: b.y });
      continue;
    }
    out.push({ x: cx, y: a.y }, { x: cx, y: b.y }, { x: b.x, y: b.y });
  }
  return out;
}

function hasCenteredBranch(points) {
  const terminals = points.map(snapP);
  for (let i = 0; i < terminals.length; i++) {
    for (let j = i + 1; j < terminals.length; j++) {
      const a = terminals[i];
      const b = terminals[j];
      if (a.y === b.y) {
        if (terminals.some((p, k) => k !== i && k !== j && p.x > Math.min(a.x, b.x) && p.x < Math.max(a.x, b.x) && p.y !== a.y)) return true;
      } else if (a.x === b.x) {
        if (terminals.some((p, k) => k !== i && k !== j && p.y > Math.min(a.y, b.y) && p.y < Math.max(a.y, b.y) && p.x !== a.x)) return true;
      }
    }
  }
  return false;
}

function samePoint(a, b) {
  return a.x === b.x && a.y === b.y;
}

/** Remove non-terminal 180-degree stubs and closed loops from a route. */
export function pruneRoute(points, protectedPoints = []) {
  const protectedSet = new Set(protectedPoints.map((p) => `${snap(p.x)},${snap(p.y)}`));
  const out = points.map(snapP);
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 1; i < out.length - 1; i++) {
      if (!samePoint(out[i - 1], out[i + 1])) continue;
      const key = `${out[i].x},${out[i].y}`;
      if (protectedSet.has(key)) continue;
      out.splice(i, 2);
      changed = true;
      break;
    }
  }
  return out;
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function appendBalancedRoute(out, target, env) {
  const a = out[out.length - 1];
  const b = { x: snap(target.x), y: snap(target.y) };
  if (a.x === b.x && a.y === b.y) return;
  const segment = smartRoute(a, b, env);
  for (let i = 1; i < segment.length; i++) out.push(segment[i]);
}

/**
 * Route a multi-terminal net through a median grid junction. The polyline
 * walks each branch from the junction and back because the state format stores
 * one ordered path, while the resulting geometry is a balanced Manhattan tree.
 */
export function balancedRoute(points, env = { rects: [], pins: new Map(), wires: [] }) {
  const terminals = points.map(snapP);
  if (terminals.length < 3 || !hasCenteredBranch(terminals)) return pruneRoute(simpleAutoRoute(terminals), terminals);
  const pair = terminals.find((p, i) => terminals.some((q, j) => j !== i && p.y === q.y && terminals.some((r, k) => k !== i && k !== j && r.x > Math.min(p.x, q.x) && r.x < Math.max(p.x, q.x))))
    || terminals.find((p, i) => terminals.some((q, j) => j !== i && p.x === q.x && terminals.some((r, k) => k !== i && k !== j && r.y > Math.min(p.y, q.y) && r.y < Math.max(p.y, q.y))));
  if (!pair) return pruneRoute(simpleAutoRoute(terminals), terminals);
  const pairIndex = terminals.indexOf(pair);
  const other = terminals.find((p, i) => i !== pairIndex && (p.y === pair.y || p.x === pair.x));
  const branch = terminals.find((p, i) => i !== pairIndex && p !== other);
  const junction = pair.y === other.y
    ? { x: median(terminals.map((p) => p.x)), y: snap((pair.y + branch.y) / 2) }
    : { x: snap((pair.x + branch.x) / 2), y: median(terminals.map((p) => p.y)) };
  const start = branch || terminals[0];
  const out = [{ ...start }];
  appendBalancedRoute(out, junction, env);
  appendBalancedRoute(out, pair, env);
  appendBalancedRoute(out, other || terminals[terminals.length - 1], env);
  return pruneRoute(out, terminals);
}

/** Renderable branch paths for a centered T-junction. */
export function balancedPaths(points, env = { rects: [], pins: new Map(), wires: [] }) {
  const terminals = points.map(snapP);
  if (terminals.length < 3 || !hasCenteredBranch(terminals)) return [simpleAutoRoute(terminals)];
  const pair = terminals.find((p, i) => terminals.some((q, j) => j !== i && p.y === q.y && terminals.some((r, k) => k !== i && k !== j && r.x > Math.min(p.x, q.x) && r.x < Math.max(p.x, q.x))))
    || terminals.find((p, i) => terminals.some((q, j) => j !== i && p.x === q.x && terminals.some((r, k) => k !== i && k !== j && r.y > Math.min(p.y, q.y) && r.y < Math.max(p.y, q.y))));
  if (!pair) return [simpleAutoRoute(terminals)];
  const pairIndex = terminals.indexOf(pair);
  const other = terminals.find((p, i) => i !== pairIndex && (p.y === pair.y || p.x === pair.x));
  const branch = terminals.find((p, i) => i !== pairIndex && p !== other);
  const junction = pair.y === other.y
    ? { x: median(terminals.map((p) => p.x)), y: snap((pair.y + branch.y) / 2) }
    : { x: snap((pair.x + branch.x) / 2), y: median(terminals.map((p) => p.y)) };
  const makePath = (a, b) => {
    const path = [{ ...a }];
    appendBalancedRoute(path, b, env);
    return pruneRoute(path, terminals);
  };
  return [makePath(branch, junction), makePath(junction, pair), makePath(junction, other)];
}

/** True if segments (a->b) and (c->d) cross at an interior point (both x- and y-spans). */
export function segmentsCross(a, b, c, d) {
  const minOf = Math.min, maxOf = Math.max;
  if (a.x === b.x && c.y === d.y) {
    return a.x > minOf(c.x, d.x) && a.x < maxOf(c.x, d.x) && c.y > minOf(a.y, b.y) && c.y < maxOf(a.y, b.y);
  }
  if (a.y === b.y && c.x === d.x) {
    return c.x > minOf(a.x, b.x) && c.x < maxOf(a.x, b.x) && a.y > minOf(c.y, d.y) && a.y < maxOf(c.y, d.y);
  }
  return false;
}

/**
 * True if an axis-aligned segment a->b ENTERS the strict interior of rect r at
 * any point other than its endpoints. Unlike segmentCrossesRect this also
 * flags a segment that departs from a pin on the rect boundary straight
 * through the body (e.g. a resistor's "a" pin wired across its own body),
 * while still allowing wires that hug the boundary at exactly r.y / r.x.
 */
export function segThroughInterior(a, b, r) {
  if (a.y === b.y) {
    return a.y > r.y && a.y < r.y + r.h && Math.max(a.x, b.x) > r.x && Math.min(a.x, b.x) < r.x + r.w;
  }
  if (a.x === b.x) {
    return a.x > r.x && a.x < r.x + r.w && Math.max(a.y, b.y) > r.y && Math.min(a.y, b.y) < r.y + r.h;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Obstacle-aware routing for the interactive editor.
//
// smartRoute(from, to, env) picks the "suggested" wire between two grid points
// (terminals/cursor). env: {
//   rects   [{x,y,w,h}]  component bboxes whose STRICT INTERIOR blocks wires
//   pins    Map "x,y" -> {x,y}  outward direction at each terminal pin
//   wires   [[{x,y},...]]          existing net polylines (avoid crossing)
// }
// Preference order (lexicographic): fewest bbox interiors crossed, fewest
// other-wire crossings, fewest collinear overlaps, most clearance (>= 1 grid
// cell from every body, barring the pin legs), best straight-on pin access,
// fewest bends, then shortest.
// ---------------------------------------------------------------------------

const STEP = 40;

function strictlyInside(p, r) {
  return p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;
}

function bboxCrossings(pts, env) {
  let n = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    for (const r of env.rects || []) if (segThroughInterior(a, b, r)) n++;
  }
  return n;
}

/** True if a new-route segment and an existing wire segment run collinearly on
 *  top of each other with a shared non-zero span (not just touching at a point).
 *  Only axis-aligned segments are considered (routes are always orthogonal). */
function overlapSpan(a, b, c, d) {
  if (a.x === b.x && c.x === d.x && a.x === c.x) {
    // both vertical on the same line x
    const lo = Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y));
    const hi = Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y));
    return hi - lo > 0;
  }
  if (a.y === b.y && c.y === d.y && a.y === c.y) {
    // both horizontal on the same line y
    const lo = Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x));
    const hi = Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x));
    return hi - lo > 0;
  }
  return false;
}

function wireConflicts(pts, env) {
  let cross = 0;
  let overlap = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    for (const wire of env.wires || []) {
      for (let j = 1; j < wire.length; j++) {
        const c = wire[j - 1];
        const d = wire[j];
        if (segmentsCross(a, b, c, d)) cross++;
        else if (overlapSpan(a, b, c, d)) overlap++;
      }
    }
  }
  return { cross, overlap };
}

function axisOf(seg) {
  return seg[0].x === seg[1].x
    ? { x: 0, y: Math.sign(seg[1].y - seg[0].y) }
    : { x: Math.sign(seg[1].x - seg[0].x), y: 0 };
}

/** Distance from an axis-aligned segment to a rect (0 when they intersect or
 *  touch). Used to keep wires at least one grid cell clear of component bodies. */
function segRectDist(a, b, r) {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  const dx = x0 > r.x + r.w ? x0 - (r.x + r.w) : x1 < r.x ? r.x - x1 : 0;
  const dy = y0 > r.y + r.h ? y0 - (r.y + r.h) : y1 < r.y ? r.y - y1 : 0;
  return Math.hypot(dx, dy);
}

/** Number of body segments that pass within a grid cell of a component bbox
 *  (excluding the two pin-connected segments, which must touch their pins). The
 *  router prefers routes with full clearance, even if they take a longer way
 *  around. */
function clearanceScore(pts, env) {
  let n = 0;
  for (let i = 1; i < pts.length; i++) {
    if (i === 1 || i === pts.length - 1) continue;
    const a = pts[i - 1];
    const b = pts[i];
    for (const r of env.rects || []) {
      if (segRectDist(a, b, r) < STEP) {
        n++;
        break;
      }
    }
  }
  return n;
}

/** 0 = aligned with the outward direction, 1 = perpendicular, 2 = inward. */
function dirScore(dx, dy, dir) {
  if (!dir) return 0;
  if (dx === dir.x && dy === dir.y) return 0;
  if (dx === -dir.x && dy === -dir.y) return 2;
  return 1;
}

/** Penalties for the first segment not leaving the source pin outward (and the
 *  last segment not entering the target pin straight-on). Inward (going up into
 *  the component) is the worst penalty; sideways is a lighter one. */
function conformScore(pts, env) {
  if (pts.length < 2) return 0;
  let s = 0;
  const pins = env.pins || new Map();
  const src = pins.get(`${pts[0].x},${pts[0].y}`);
  const dst = pins.get(`${pts[pts.length - 1].x},${pts[pts.length - 1].y}`);
  if (src) {
    const a = axisOf([pts[0], pts[1]]);
    s += dirScore(a.x, a.y, src);
  }
  if (dst) {
    const b = axisOf([pts[pts.length - 2], pts[pts.length - 1]]);
    s += dirScore(b.x, b.y, { x: -dst.x, y: -dst.y });
  }
  return s;
}

function routeLength(pts) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.abs(pts[i].x - pts[i - 1].x) + Math.abs(pts[i].y - pts[i - 1].y);
  return len;
}

/** Compare two candidate routes by (bbox, wireCross, overlap, turns, conform, length). */
function cmpScore(a, b) {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return a.length - b.length;
}

function scoreCandidate(pts, env) {
  const { cross, overlap } = wireConflicts(pts, env);
  return [bboxCrossings(pts, env), cross, overlap, clearanceScore(pts, env), conformScore(pts, env), Math.max(0, pts.length - 2), routeLength(pts)];
}

/** Enumerate straight / L / Z candidates (Z via channel rows and columns). */
function routeCandidates(from, to) {
  const out = [];
  const add = (pts) => {
    const c = compressElbow(pts);
    if (c.length >= 2 && c.every((p, i) => i === 0 || p.x === c[i - 1].x || p.y === c[i - 1].y)) out.push(c);
  };
  add([{ ...from }, { ...to }]);
  add([{ ...from }, { x: to.x, y: from.y }, { ...to }]);
  add([{ ...from }, { x: from.x, y: to.y }, { ...to }]);
  const rowMin = Math.floor(Math.min(from.y, to.y) / STEP);
  const rowMax = Math.ceil(Math.max(from.y, to.y) / STEP);
  const colMin = Math.floor(Math.min(from.x, to.x) / STEP);
  const colMax = Math.ceil(Math.max(from.x, to.x) / STEP);
  for (let off = -8; off <= 8; off++) {
    const my = (rowMin + off) * STEP;
    add([{ ...from }, { x: from.x, y: my }, { x: to.x, y: my }, { ...to }]);
    const mx = (colMin + off) * STEP;
    add([{ ...from }, { x: mx, y: from.y }, { x: mx, y: to.y }, { ...to }]);
  }
  return out;
}

/** A* on the coarse grid avoiding strict rect interiors, turn-averse. */
function astar(from, to, env) {
  const sx = Math.round(from.x / STEP);
  const sy = Math.round(from.y / STEP);
  const tx = Math.round(to.x / STEP);
  const ty = Math.round(to.y / STEP);
  if (sx === tx && sy === ty) return [{ ...from }];
  for (const margin of [20, 40]) {
    const x0 = Math.min(sx, tx) - margin;
    const x1 = Math.max(sx, tx) + margin;
    const y0 = Math.min(sy, ty) - margin;
    const y1 = Math.max(sy, ty) + margin;
    const blocked = (cx, cy) => {
      if ((cx === sx && cy === sy) || (cx === tx && cy === ty)) return false;
      const w = { x: cx * STEP, y: cy * STEP };
      for (const r of env.rects || []) if (strictlyInside(w, r)) return true;
      return false;
    };
    const TURN = 6;
    const D = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const g = new Map();
    const back = new Map();
    const open = [];
    const addOpen = (cost, cx0, cy0, d) => {
      open.push([cost + Math.abs(cx0 - tx) + Math.abs(cy0 - ty), cost, cx0, cy0, d]);
    };
    for (let d = 0; d < 4; d++) {
      const nx = sx + D[d][0];
      const ny = sy + D[d][1];
      if (nx < x0 || nx > x1 || ny < y0 || ny > y1 || blocked(nx, ny)) continue;
      g.set(`${nx},${ny},${d}`, 1);
      back.set(`${nx},${ny},${d}`, `${sx},${sy},-1`);
      addOpen(1, nx, ny, d);
    }
    let best = null;
    while (open.length) {
      let mi = 0;
      for (let i = 1; i < open.length; i++) {
        if (open[i][0] < open[mi][0] || (open[i][0] === open[mi][0] && open[i][1] < open[mi][1])) mi = i;
      }
      const [, cost, cx0, cy0, d] = open[mi];
      open.splice(mi, 1);
      const key = `${cx0},${cy0},${d}`;
      if (cost > (g.get(key) ?? Infinity)) continue;
      if (cx0 === tx && cy0 === ty) {
        best = { cx: cx0, cy: cy0 };
        break;
      }
      for (let nd = 0; nd < 4; nd++) {
        const nx = cx0 + D[nd][0];
        const ny = cy0 + D[nd][1];
        if (nx < x0 || nx > x1 || ny < y0 || ny > y1 || blocked(nx, ny)) continue;
        const nc = cost + 1 + (nd === d ? 0 : TURN);
        const nk = `${nx},${ny},${nd}`;
        if (nc < (g.get(nk) ?? Infinity)) {
          g.set(nk, nc);
          back.set(nk, key);
          addOpen(nc, nx, ny, nd);
        }
      }
    }
    if (!best) continue;
    const path = [{ x: best.cx * STEP, y: best.cy * STEP }];
    let cur = `${best.cx},${best.cy},${0}`;
    // recover the direction of the goal from an open node with that cell
    let dirSeen = null;
    for (const [k] of g) {
      const m = k.split(',');
      if (Number(m[0]) === best.cx && Number(m[1]) === best.cy) {
        dirSeen = Number(m[2]);
        break;
      }
    }
    // re-derive direction: goal cell has a back entry per direction; use any whose g is the min
    let minG = Infinity;
    let dirKey = null;
    for (let d = 0; d < 4; d++) {
      const k = `${best.cx},${best.cy},${d}`;
      const gg = g.get(k);
      if (gg !== undefined && gg <= minG) {
        minG = gg;
        dirKey = k;
      }
    }
    if (dirKey) cur = dirKey;
    const ordered = [cur];
    let node = back.get(cur);
    const guard = new Set(ordered);
    while (node && !guard.has(node)) {
      ordered.unshift(node);
      guard.add(node);
      node = back.get(node);
    }
    for (const k of ordered) {
      const [x, y] = k.split(',').map(Number);
      path.unshift({ x: x * STEP, y: y * STEP });
    }
    return compressElbow(path);
  }
  return null;
}

/**
 * Pick the best orthogonal route from -> to given the routing environment.
 * When an endpoint is a component pin, candidates that first extend one grid
 * cell OUTWARD in the pin's direction (a clean outside bend, never drilling the
 * body) are generated alongside the plain straight/L/Z ones; the conform score
 * prefers them unless a direct route is already clean (e.g. two facing pins).
 * The A* fallback only kicks in when every candidate would drill through a
 * component footprint.
 */
export function smartRoute(from, to, env = { rects: [], pins: new Map(), wires: [] }) {
  const f = snapP(from);
  const t = snapP(to);
  if (f.x === t.x && f.y === t.y) return [f];
  const pins = env.pins || new Map();
  const src = pins.get(`${f.x},${f.y}`);
  const dst = pins.get(`${t.x},${t.y}`);
  const f2 = src ? { x: f.x + src.x * STEP, y: f.y + src.y * STEP } : null;
  const t2 = dst ? { x: t.x + dst.x * STEP, y: t.y + dst.y * STEP } : null;
  const cands = routeCandidates(f, t);
  // Escaped candidates: leave each pin one cell along its outward direction
  // before routing, so the bend happens clear of the component body.
  const wrap = (mid) => {
    const out = [{ ...f }];
    if (f2) out.push({ ...f2 });
    for (const p of mid) {
      const last = out[out.length - 1];
      if (p.x !== last.x || p.y !== last.y) out.push({ ...p });
    }
    if (t2) out.push({ ...t2 });
    const last = out[out.length - 1];
    if (last.x !== t.x || last.y !== t.y) out.push({ ...t });
    return compressElbow(out);
  };
  if (f2 && t2) for (const c of routeCandidates(f2, t2)) cands.push(wrap(c));
  if (f2 && !t2) for (const c of routeCandidates(f2, t)) cands.push(wrap(c));
  if (!f2 && t2) for (const c of routeCandidates(f, t2)) cands.push(wrap(c));
  let best = cands[0];
  let bestScore = scoreCandidate(best, env);
  for (let i = 1; i < cands.length; i++) {
    const s = scoreCandidate(cands[i], env);
    if (cmpScore(s, bestScore) < 0) {
      best = cands[i];
      bestScore = s;
    }
  }
  if (bestScore[0] > 0) {
    const ast = astar(f, t, env);
    if (ast) {
      const s = scoreCandidate(ast, env);
      if (cmpScore(s, bestScore) < 0) {
        best = ast;
        bestScore = s;
      }
    }
  }
  return best;
}
