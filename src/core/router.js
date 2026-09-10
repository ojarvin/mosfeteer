import { GRID, snap } from './grid.js';
import { junctionPoints, normalizeBranches, pointKey, reduceBranches } from './wiring.js';

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
 *  segments; corners land on a grid-snapped midpoint. Used for the two-point
 *  previews and the degenerate fallbacks below. */
export function autoRoute(points) {
  if (points.length === 0) return [];
  if (points.length === 1) return [{ x: snap(points[0].x), y: snap(points[0].y) }];
  if (points.length === 2) return pruneRoute(simpleAutoRoute(points), points);
  // 3+ terminals: exact rectilinear Steiner minimum tree (see steiner.js section).
  return steinerRoute(points);
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

// ---------------------------------------------------------------------------
// Multi-terminal net routing: rectilinear Steiner minimum tree (RSMT) over the
// coarse 40-grid with obstacle avoidance. This is the exact version of the
// "rat nest" router: Dreyfus–Wagner subset DP on a grid graph whose vertices
// are every cell of the terminals' padded bounding box; edge cost is one cell
// plus tiny tie-break penalties that prefer pin-conformity and label clearance.
// The DP minimizes total length; visible candidate routes prioritize fewer bends
// before comparing lengths. Nets too large for the exponential DP fall back to
// the classic MST-of-shortest-paths Steiner approximation, so any net is
// routable.
// ---------------------------------------------------------------------------

// Pin-conformity penalties for the first/last segment of a net. Leaving a pin
// sideways (perpendicular to its direction) is the worst offence — it sends the
// wire along the component's pin row (the "pin-row trunk" anti-pattern) — so it
// costs CONFORM_SIDE cells. Heading straight opposite the outward direction
// (into/through the body side) is less bad but still penalized. The exact DP
// minimizes total length, so a conforming route that is a few cells longer wins
// whenever the sideways shortcut is not worth the penalty.
const CONFORM_SIDE = 30; // first/last segment perpendicular to the pin direction
const CONFORM_OPP = 8; // first/last segment heading opposite the pin direction
const LABEL_EPS = 0.1; // soft: prefer channels one cell clear of label boxes

/** Minimal binary heap for Dijkstra's relaxation loop. */
class MinHeap {
  constructor() {
    this.a = [];
  }
  get size() {
    return this.a.length;
  }
  push(prio, val) {
    const a = this.a;
    a.push([prio, val]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/** Multi-source Dijkstra over the grid graph. `initDist[v]` seeds each source
 *  (single source = terminal escape; many sources = one per split vertex of the
 *  Steiner DP). Returns final distances and a predecessor pointer per vertex. */
function gridDijkstra(initDist, adj, V) {
  const dist = new Float64Array(V);
  const par = new Int32Array(V).fill(-1);
  const heap = new MinHeap();
  for (let v = 0; v < V; v++) {
    dist[v] = initDist[v];
    if (initDist[v] !== Infinity) heap.push(initDist[v], v);
  }
  while (heap.size) {
    const [d, v] = heap.pop();
    if (d > dist[v]) continue;
    for (const e of adj[v]) {
      const nd = d + e.w;
      if (nd < dist[e.to]) {
        dist[e.to] = nd;
        par[e.to] = v;
        heap.push(nd, e.to);
      }
    }
  }
  return { dist, par };
}

/** Weight of a one-cell grid step, or null when the step is illegal: it would
 *  run through a body interior, pass within a grid cell of a body (unless it is
 *  the valid one-cell pin leg), or lie on top of an existing wire. Legal steps cost
 *  one cell, plus tiny penalties that break length-ties toward pin-conformity
 *  and label clearance. */
function gatePassageAt(point, env) {
  return (env.gatePassages || []).find((passage) =>
    passage.point.x === point.x && passage.point.y === point.y
  );
}

function pointOnSegment(point, a, b) {
  return point.x >= Math.min(a.x, b.x) && point.x <= Math.max(a.x, b.x) &&
    point.y >= Math.min(a.y, b.y) && point.y <= Math.max(a.y, b.y);
}

/** A shared MOS gate bus may cross its own transistor bodies, but only along
 * the gate axis and only when the segment touches that component's gate pin. */
export function gateBodyCrossingAllowed(a, b, r, env = {}) {
  const passages = env.gatePassages || [];
  if (passages.length < 2) return false;
  return passages.some((passage) => {
    if (passage.rect.x !== r.x || passage.rect.y !== r.y ||
        passage.rect.w !== r.w || passage.rect.h !== r.h) return false;
    if (!pointOnSegment(passage.point, a, b)) return false;
    const horizontal = passage.dir.x !== 0;
    return horizontal ? a.y === passage.point.y && b.y === passage.point.y
      : a.x === passage.point.x && b.x === passage.point.x;
  });
}

function gatePinAllowsDirection(point, direction, env, source) {
  const passage = gatePassageAt(point, env);
  if (!passage) return false;
  return source
    ? direction.x === -passage.dir.x && direction.y === -passage.dir.y
    : direction.x === passage.dir.x && direction.y === passage.dir.y;
}

function terminalEdgeValid(a, b, env) {
  const pins = env.pins || new Map();
  const aPin = pins.get(`${a.x},${a.y}`);
  const bPin = pins.get(`${b.x},${b.y}`);
  const dx = Math.sign(b.x - a.x);
  const dy = Math.sign(b.y - a.y);
  if (aPin && (dx !== aPin.x || dy !== aPin.y) &&
      !gatePinAllowsDirection(a, { x: dx, y: dy }, env, true)) return false;
  if (bPin && (dx !== -bPin.x || dy !== -bPin.y) &&
      !gatePinAllowsDirection(b, { x: dx, y: dy }, env, false)) return false;
  return true;
}

function edgeWeight(a, b, env) {
  const pins = env.pins || new Map();
  const aPin = pins.get(`${a.x},${a.y}`);
  const bPin = pins.get(`${b.x},${b.y}`);
  if (!terminalEdgeValid(a, b, env)) return null;
  for (const r of env.rects || []) {
    if (segThroughInterior(a, b, r) && !gateBodyCrossingAllowed(a, b, r, env)) return null;
  }
  for (const r of env.rects || []) {
    if (gateBodyCrossingAllowed(a, b, r, env)) continue;
    if (segRectDist(a, b, r) < STEP) {
      const aOk = aPin && onBodyBoundary(a, r);
      const bOk = bPin && onBodyBoundary(b, r);
      if (!aOk && !bOk) return null;
    }
  }
  for (const wire of env.wires || []) {
    for (let i = 1; i < wire.length; i++) {
      if (overlapSpan(a, b, wire[i - 1], wire[i])) return null;
    }
  }
  let w = 1;
  const dx = Math.sign(b.x - a.x);
  const dy = Math.sign(b.y - a.y);
  // Valid edges leave a pin in its outward direction. Keep the conformance
  // scoring for the remaining non-terminal choices.
  if (aPin) {
    if (dx === -aPin.x && dy === -aPin.y) w += CONFORM_OPP;
    else if (dx !== aPin.x || dy !== aPin.y) w += CONFORM_SIDE;
  }
  // Valid edges enter a pin from its outward side. Keep the conformance scoring
  // for the remaining non-terminal choices.
  if (bPin) {
    if (dx === bPin.x && dy === bPin.y) w += CONFORM_OPP;
    else if (dx !== -bPin.x || dy !== -bPin.y) w += CONFORM_SIDE;
  }
  for (const lr of env.labelRects || []) {
    if (segRectDist(a, b, lr) < STEP) {
      w += LABEL_EPS;
      break;
    }
  }
  return w;
}

/** Build the coarse-grid graph over cell rows y0..y1 × cols x0..x1 (inclusive).
 *  Terminals are grid points; the graph's vertices are every grid cell in the
 *  rectangle, edges are the legal one-cell steps. */
function buildGridGraph(x0, y0, x1, y1, terminals, env) {
  const W = x1 - x0 + 1;
  const H = y1 - y0 + 1;
  const V = W * H;
  const id = (x, y) => (y - y0) * W + (x - x0);
  const px = (v) => ({ x: (v % W + x0) * GRID, y: (Math.floor(v / W) + y0) * GRID });
  const adj = new Array(V);
  for (let i = 0; i < V; i++) adj[i] = [];
  const tryEdge = (ax, ay, bx, by) => {
    const w = edgeWeight({ x: ax * GRID, y: ay * GRID }, { x: bx * GRID, y: by * GRID }, env);
    if (w === null) return;
    const ia = id(ax, ay);
    const ib = id(bx, by);
    adj[ia].push({ to: ib, w });
    adj[ib].push({ to: ia, w });
  };
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      if (cx < x1) tryEdge(cx, cy, cx + 1, cy);
      if (cy < y1) tryEdge(cx, cy, cx, cy + 1);
    }
  }
  return {
    V,
    adj,
    id,
    px,
    terminalIds: terminals.map((p) => id(Math.round(p.x / GRID), Math.round(p.y / GRID))),
  };
}

function graphConnected(adj, V, terminalIds) {
  const seen = new Array(V).fill(false);
  const stack = [terminalIds[0]];
  seen[terminalIds[0]] = true;
  while (stack.length) {
    const v = stack.pop();
    for (const e of adj[v]) {
      if (!seen[e.to]) {
        seen[e.to] = true;
        stack.push(e.to);
      }
    }
  }
  return terminalIds.every((t) => seen[t]);
}

function bitIndex(mask) {
  return 31 - Math.clz32(mask);
}

function segKey(a, b) {
  return `${Math.min(a, b)}|${Math.max(a, b)}`;
}

/** Dreyfus–Wagner subset DP: g[mask][v] is the cost of the cheapest tree that
 *  connects the terminals of `mask` and passes through vertex v. Single-terminal
 *  masks seed with a plain Dijkstra; larger masks split into two subsets at a
 *  shared vertex, then relax with a multi-source Dijkstra. Parent/split records
 *  are kept so the optimal tree can be reconstructed edge by edge. */
function steinerDP(graph, terminals) {
  const { V, adj, terminalIds } = graph;
  const m = terminals.length;
  const FULL = (1 << m) - 1;
  const g = new Array(1 << m);
  const par = new Array(1 << m);
  for (let i = 0; i < m; i++) {
    const init = new Float64Array(V).fill(Infinity);
    init[terminalIds[i]] = 0;
    const r = gridDijkstra(init, adj, V);
    g[1 << i] = r.dist;
    par[1 << i] = r.par;
  }
  const splitA = new Array(1 << m);
  for (let mask = 1; mask < (1 << m); mask++) {
    if ((mask & (mask - 1)) === 0) continue; // single-bit masks are seeded above
    const h = new Float64Array(V).fill(Infinity);
    const sa = new Int32Array(V).fill(-1);
    const low = mask & -mask;
    // Every unordered pair of proper subsets {A, mask\A} is visited once by only
    // iterating the submasks that contain the lowest set bit.
    for (let sub = (mask - 1) & mask; sub; sub = (sub - 1) & mask) {
      if (!(sub & low)) continue;
      const gA = g[sub];
      const gB = g[mask ^ sub];
      for (let v = 0; v < V; v++) {
        const s = gA[v] + gB[v];
        if (s < h[v]) {
          h[v] = s;
          sa[v] = sub;
        }
      }
    }
    const r = gridDijkstra(h, adj, V);
    g[mask] = r.dist;
    par[mask] = r.par;
    splitA[mask] = sa;
  }
  let bestRoot = 0;
  let bestCost = Infinity;
  const gFull = g[FULL];
  for (let v = 0; v < V; v++) {
    if (gFull[v] < bestCost) {
      bestCost = gFull[v];
      bestRoot = v;
    }
  }
  const segs = new Set();
  const rec = (mask, v) => {
    if ((mask & (mask - 1)) === 0) {
      const target = terminalIds[bitIndex(mask)];
      const pm = par[mask];
      let cur = v;
      let guard = 0;
      while (cur !== target && guard++ < V) {
        const p = pm[cur];
        if (p === -1) break;
        segs.add(segKey(cur, p));
        cur = p;
      }
      return;
    }
    const pm = par[mask];
    if (pm[v] === -1) {
      const A = splitA[mask][v];
      if (A === -1) return;
      rec(A, v);
      rec(mask ^ A, v);
    } else {
      segs.add(segKey(v, pm[v]));
      rec(mask, pm[v]);
    }
  };
  rec(FULL, bestRoot);
  return segs;
}

/** Turn a polyline's grid edges into a bend count. */
function bendCount(path) {
  let bends = 0;
  let previous = null;
  for (let i = 1; i < path.length; i++) {
    const current = path[i - 1].x === path[i].x ? 'v' : 'h';
    if (previous && current !== previous) bends++;
    previous = current;
  }
  return bends;
}

/** Replace a shortest staircase between two branch points with an equally
 * short route having fewer bends when the routing environment permits it. */
function simplifyBranch(path, env) {
  if (!path || path.length < 3) return path;
  const candidate = smartRoute(path[0], path[path.length - 1], env);
  if (!candidate || candidate.length < 2) return path;
  const oldLength = routeLength(path);
  const newLength = routeLength(candidate);
  const oldBends = bendCount(path);
  const newBends = bendCount(candidate);
  if (newBends < oldBends || (newBends === oldBends && newLength < oldLength)) {
    return candidate;
  }
  return path;
}
/** Turn a Steiner tree's segment set into renderable branches. Branch points are
 *  the terminals plus every vertex whose degree differs from 2; each maximal
 *  chain between two branch points becomes one polyline (collinear cells
 *  compressed away). */
function branchesFromSegments(segs, graph, allTerminalPts, env) {
  const { V, id, px } = graph;
  if (segs.size === 0) return [];
  const adj = new Map();
  const add = (a, b) => {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push(b);
    adj.get(b).push(a);
  };
  for (const key of segs) {
    const [a, b] = key.split('|').map(Number);
    add(a, b);
  }
  const branchPts = new Set();
  for (const p of allTerminalPts) branchPts.add(id(Math.round(p.x / GRID), Math.round(p.y / GRID)));
  for (const [v, nbrs] of adj) if (nbrs.length !== 2) branchPts.add(v);
  const visited = new Set();
  const branches = [];
  for (const v of branchPts) {
    for (const u of adj.get(v) || []) {
      const ek = segKey(v, u);
      if (visited.has(ek)) continue;
      visited.add(ek);
      const poly = [v, u];
      let prev = v;
      let cur = u;
      while (!branchPts.has(cur)) {
        const next = (adj.get(cur) || []).find((n) => n !== prev);
        if (next === undefined) break;
        visited.add(segKey(cur, next));
        poly.push(next);
        prev = cur;
        cur = next;
      }
      const points = compressElbow(poly.map(px));
      branches.push(simplifyBranch(points, env));
    }
  }
  return branches;
}

/**
 * Route a multi-terminal net as a rectilinear Steiner minimum tree (see above),
 * honoring the routing environment (component bodies are hard one-cell-clear
 * obstacles, labels steer softly, wires must not be collinearly overlapped).
 * Returns the renderable branch polylines. Nets too large for the exact DP fall
 * back to the MST-of-shortest-paths approximation, so any net is routable.
 */
export function steinerBranches(terminals, env = { rects: [], pins: new Map(), wires: [], labelRects: [] }) {
  const pts = terminals.map(snapP);
  const unique = [];
  const toUnique = [];
  for (const p of pts) {
    let idx = unique.findIndex((q) => q.x === p.x && q.y === p.y);
    if (idx === -1) {
      idx = unique.length;
      unique.push({ x: p.x, y: p.y });
    }
    toUnique.push(idx);
  }
  const k = unique.length;
  if (k <= 1) return [];
  if (k === 2) {
    const path = smartRoute(unique[0], unique[1], env);
    return path && path.length >= 2 ? [path] : [];
  }
  const tree = steinerTree(unique, env);
  if (!tree) {
    // Exact DP out of budget or the region never connected: 2-approximation
    // via the MST of all pairwise shortest paths (reduceBranches does Kruskal).
    const paths = [];
    for (let i = 0; i < k; i++) {
      for (let j = i + 1; j < k; j++) {
        const path = smartRoute(unique[i], unique[j], env);
        if (path && path.length >= 2) paths.push(path);
      }
    }
    return reduceBranches(paths, unique);
  }
  return branchesFromSegments(tree.segs, tree.graph, pts, env);
}

/** Compute the Steiner tree's segment set, growing the routing region until all
 *  terminals are connected (a big body next to the net may need several cells of
 *  padding to route around). Returns {segs, graph} or null for the fallback. */
function steinerTree(terminals, env) {
  const cancelled = () => env?.signal?.aborted || env?.cancelled?.() === true;
  const k = terminals.length;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of terminals) {
    minX = Math.min(minX, Math.round(p.x / GRID));
    maxX = Math.max(maxX, Math.round(p.x / GRID));
    minY = Math.min(minY, Math.round(p.y / GRID));
    maxY = Math.max(maxY, Math.round(p.y / GRID));
  }
  let margin = 10;
  for (let iter = 0; iter < 6; iter++) {
    if (cancelled()) return null;
    const x0 = minX - margin;
    const y0 = minY - margin;
    const x1 = maxX + margin;
    const y1 = maxY + margin;
    const graph = buildGridGraph(x0, y0, x1, y1, terminals, env);
    if (graphConnected(graph.adj, graph.V, graph.terminalIds)) {
      const V = graph.V;
      const splitCost = ((Math.pow(3, k) - Math.pow(2, k)) / 2) * V;
      const relaxCost = Math.pow(2, k) * V;
      // Keep exact DP bounded: its subset-state work grows exponentially in k
      // and linearly with the search area. Cancellation is checked between
      // retries; callers can safely fall back to the bounded approximation.
      if (k <= 10 && graph.V <= 25000 && splitCost + relaxCost <= 120e6) {
        if (cancelled()) return null;
        const segs = steinerDP(graph, terminals);
        return { segs, graph };
      }
      return null;
    }
    margin = Math.min(margin * 2, 40);
  }
  return null;
}

/** Single-polyline form of the Steiner tree: a depth-first walk of the branch
 *  tree from the first terminal, visiting every terminal (route reversals at
 *  junctions/terminals are preserved by pruneRoute). */
export function steinerRoute(terminals, env) {
  const branches = steinerBranches(terminals, env);
  if (branches.length <= 1) return branches[0] ? branches[0].slice() : [];
  const pts = terminals.map(snapP);
  const split = normalizeBranches(branches, pts);
  if (split.length === 0) return [];
  const adj = new Map();
  for (const path of split) {
    for (let i = 1; i < path.length; i++) {
      const ka = pointKey(path[i - 1]);
      const kb = pointKey(path[i]);
      if (!adj.has(ka)) adj.set(ka, []);
      if (!adj.has(kb)) adj.set(kb, []);
      adj.get(ka).push(kb);
      adj.get(kb).push(ka);
    }
  }
  const out = [];
  const visited = new Set();
  const byKey = new Map();
  for (const path of split) for (const p of path) byKey.set(pointKey(p), p);
  const walk = (p, parent) => {
    const k = pointKey(p);
    if (visited.has(k)) return;
    visited.add(k);
    out.push({ x: p.x, y: p.y });
    const kids = (adj.get(k) || []).filter((n) => n !== parent);
    for (let i = 0; i < kids.length; i++) {
      walk(byKey.get(kids[i]), k);
      if (i < kids.length - 1) out.push({ x: p.x, y: p.y });
    }
  };
  walk(pts[0], null);
  // The walk revisits junction points between terminal legs; a junction's
  // reversal is a real vertex (like a terminal's), so protect it from pruning.
  const protectedPoints = [...pts, ...junctionPoints(split, pts)];
  return pruneRoute(out, protectedPoints);
}

/**
 * Renderable branch paths for a multi-terminal net — the exact Steiner minimum
 * tree honoring the routing environment. Retained under the historic name.
 */
export function balancedPaths(points, env) {
  return steinerBranches(points, env);
}

/** Single-polyline form of the Steiner minimum tree (see steinerRoute). */
export function balancedRoute(points, env) {
  return steinerRoute(points, env);
}

/**
 * Validate and preserve two matched diagonal paths for a mirrored feedback
 * pair. Each input is a two-point endpoint pair; the four endpoints must be
 * the four corners of one non-degenerate, grid-aligned rectangle and the pairs
 * must be its opposite diagonals. The returned value is `[pathA, pathB]`,
 * preserving each input pair's endpoint order. These are protected direct
 * paths: introducing elbows here would change the authored diagonal geometry
 * and would make a crossing look electrically ambiguous.
 */
export function balancedCrossCoupling(pairA, pairB) {
  const asPair = (pair) => {
    if (Array.isArray(pair) && pair.length === 2) return pair;
    if (pair && pair.start && pair.end) return [pair.start, pair.end];
    throw new Error('cross-coupling endpoints must be two-point pairs');
  };
  const a = asPair(pairA);
  const b = asPair(pairB);
  const all = [...a, ...b];
  if (all.some((p) => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y) ||
      p.x % GRID !== 0 || p.y % GRID !== 0)) {
    throw new Error('cross-coupling endpoints must be grid-aligned');
  }
  const xs = [...new Set(all.map((p) => p.x))].sort((x, y) => x - y);
  const ys = [...new Set(all.map((p) => p.y))].sort((x, y) => x - y);
  if (xs.length !== 2 || ys.length !== 2 || xs[1] <= xs[0] || ys[1] <= ys[0]) {
    throw new Error('cross-coupling endpoints must form a rectangle');
  }
  const [x0, x1] = xs;
  const [y0, y1] = ys;
  const width = x1 - x0;
  const height = y1 - y0;
  if (width % (2 * GRID) !== 0 || height % (2 * GRID) !== 0 ||
      width <= 2 * GRID || height <= 2 * GRID) {
    throw new Error('cross-coupling rectangle is too small or has no grid center');
  }
  const corners = new Set([
    `${x0},${y0}`, `${x1},${y0}`, `${x1},${y1}`, `${x0},${y1}`,
  ]);
  if (new Set(all.map((p) => `${p.x},${p.y}`)).size !== 4 ||
      all.some((p) => !corners.has(`${p.x},${p.y}`))) {
    throw new Error('cross-coupling endpoints must be distinct rectangle corners');
  }
  const diagonal = (pair) => pair[0].x !== pair[1].x && pair[0].y !== pair[1].y;
  if (!diagonal(a) || !diagonal(b)) throw new Error('cross-coupling pairs must be diagonals');
  // The rectangle and diagonal checks above establish that these are exactly
  // the two opposite X legs. Return the original order; callers use it to
  // retain each path's terminal anchors.
  return [a, b].map((path) => path.map((p) => ({ ...p })));
}

/** Short alias for callers that describe the result as route templates. */
export const crossCoupledRoutes = balancedCrossCoupling;

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
 * True if a segment a->b ENTERS the strict interior of rect r. Managed routes
 * are axis-aligned, while protected direct paths may be diagonal, so this uses
 * open-rectangle clipping rather than an axis-only span test. A segment that
 * merely touches an edge or corner remains legal; any positive-length portion
 * in the interior is a body drill.
 */
export function segThroughInterior(a, b, r) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let lo = 0;
  let hi = 1;
  const clipOpen = (start, delta, min, max) => {
    if (delta === 0) return start > min && start < max;
    let t0 = (min - start) / delta;
    let t1 = (max - start) / delta;
    if (t0 > t1) [t0, t1] = [t1, t0];
    lo = Math.max(lo, t0);
    hi = Math.min(hi, t1);
    return lo < hi;
  };
  if (!clipOpen(a.x, dx, r.x, r.x + r.w)) return false;
  if (!clipOpen(a.y, dy, r.y, r.y + r.h)) return false;
  return lo < hi;
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
// fewest bends, then shortest. If no enumerated candidate is hard-safe, A* is
// used as a bounded fallback; failure to find a hard-safe route is reported as
// null rather than returning an unsafe candidate.
// ---------------------------------------------------------------------------

const STEP = 40;
const wireOccupancyCache = new WeakMap();

function strictlyInside(p, r) {
  return p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;
}

function bboxCrossings(pts, env) {
  let n = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    for (const r of env.rects || []) {
      if (segThroughInterior(a, b, r) && !gateBodyCrossingAllowed(a, b, r, env)) n++;
    }
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

function wireOccupancy(env) {
  let index = wireOccupancyCache.get(env);
  if (index) return index;
  index = new Map();
  const key = (x, y) => `${Math.floor(x / STEP)},${Math.floor(y / STEP)}`;
  let order = 0;
  for (const wire of env.wires || []) for (let i = 1; i < wire.length; i++) {
    const a = wire[i - 1], b = wire[i];
    const record = { a, b, order: order++ };
    for (let x = Math.floor(Math.min(a.x, b.x) / STEP); x <= Math.floor(Math.max(a.x, b.x) / STEP); x++) {
      for (let y = Math.floor(Math.min(a.y, b.y) / STEP); y <= Math.floor(Math.max(a.y, b.y) / STEP); y++) {
        const bucket = key(x * STEP, y * STEP);
        if (!index.has(bucket)) index.set(bucket, []);
        index.get(bucket).push(record);
      }
    }
  }
  wireOccupancyCache.set(env, index);
  return index;
}

function occupiedWire(a, b, env) {
  const index = wireOccupancy(env);
  const key = (x, y) => `${Math.floor(x / STEP)},${Math.floor(y / STEP)}`;
  const records = new Set();
  for (let x = Math.floor(Math.min(a.x, b.x) / STEP); x <= Math.floor(Math.max(a.x, b.x) / STEP); x++) {
    for (let y = Math.floor(Math.min(a.y, b.y) / STEP); y <= Math.floor(Math.max(a.y, b.y) / STEP); y++) {
      for (const record of index.get(key(x * STEP, y * STEP)) || []) records.add(record);
    }
  }
  return [...records].sort((a, b) => a.order - b.order).some(record => overlapSpan(a, b, record.a, record.b));
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
      if (gateBodyCrossingAllowed(a, b, r, env)) continue;
      if (segRectDist(a, b, r) < STEP) {
        n++;
        break;
      }
    }
  }
  return n;
}
/** Soft preference: segments passing within a grid cell of a label box. Unlike
 *  component bodies (hard clearance, see hardSafe), labels only steer the route
 *  toward a cleaner channel when one exists — they never block a connection. */
function labelScore(pts, env) {
  let n = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    for (const r of env.labelRects || []) {
      if (segRectDist(a, b, r) < STEP) {
        n++;
        break;
      }
    }
  }
  return n;
}

// Clearance is a hard invariant for committed routes. A segment may touch a
// component body only at a terminal pin on that body; otherwise it must stay at
// least one grid cell clear.
function onBodyBoundary(p, r) {
  return ((p.x === r.x || p.x === r.x + r.w) && p.y >= r.y && p.y <= r.y + r.h) ||
    ((p.y === r.y || p.y === r.y + r.h) && p.x >= r.x && p.x <= r.x + r.w);
}

function pointAt(a, b, distance) {
  const dx = Math.sign(b.x - a.x);
  const dy = Math.sign(b.y - a.y);
  return { x: a.x + dx * distance, y: a.y + dy * distance };
}

/**
 * Check body clearance while allowing only the first/last one-cell leg at a
 * valid terminal. A turned, interior obstacle-edge segment is also retained
 * for tightly packed multi-terminal layouts. Shared MOS gate passages are
 * handled before this generic clearance policy.
 */
function bodyClearanceSafe(a, b, index, points, rect, env) {
  // A route may follow an obstacle edge only after it has turned away from a
  // terminal leg. Keep this exception limited to edge-touching geometry;
  // clearance violations in open space are still rejected.
  if (segRectDist(a, b, rect) === 0 &&
      index > 1 && index < points.length - 1) return true;
  const length = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
  let clearFrom = 0;
  let clearTo = length;
  const pins = env.pins || new Map();
  const src = pins.get(`${points[0].x},${points[0].y}`);
  const dst = pins.get(`${points[points.length - 1].x},${points[points.length - 1].y}`);
  if (index === 1 && src && terminalEdgeValid(a, b, env)) {
    clearFrom = Math.min(STEP, length);
  }
  if (index === points.length - 1 && dst && terminalEdgeValid(a, b, env)) {
    clearTo = Math.max(0, length - STEP);
  }
  if (clearFrom >= clearTo) return true;
  return segRectDist(pointAt(a, b, clearFrom), pointAt(a, b, clearTo), rect) >= STEP;
}

function hardSafe(pts, env) {
  const pins = env.pins || new Map();
  if (pts.length >= 2) {
    if (pins.has(`${pts[0].x},${pts[0].y}`) && !terminalEdgeValid(pts[0], pts[1], env)) return false;
    const last = pts.length - 1;
    if (pins.has(`${pts[last].x},${pts[last].y}`) && !terminalEdgeValid(pts[last - 1], pts[last], env)) return false;
  }
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    for (const r of env.rects || []) {
      if (gateBodyCrossingAllowed(a, b, r, env)) continue;
      if (segThroughInterior(a, b, r)) return false;
      if (segRectDist(a, b, r) < STEP && !bodyClearanceSafe(a, b, i, pts, r, env)) return false;
    }
  }
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    for (const wire of env.wires || []) for (let j = 1; j < wire.length; j++) {
      if (overlapSpan(a, b, wire[j - 1], wire[j])) return false;
    }
  }
  return true;
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
  const gatePassageFor = (point) => gatePassageAt(point, env);
  if (src) {
    const a = axisOf([pts[0], pts[1]]);
    const passage = gatePassageFor(pts[0]);
    s += passage && gateBodyCrossingAllowed(pts[0], pts[1], passage.rect, env)
      ? 0
      : dirScore(a.x, a.y, src);
  }
  if (dst) {
    const b = axisOf([pts[pts.length - 2], pts[pts.length - 1]]);
    const passage = gatePassageFor(pts[pts.length - 1]);
    s += passage && gateBodyCrossingAllowed(pts[pts.length - 2], pts[pts.length - 1], passage.rect, env)
      ? 0
      : dirScore(b.x, b.y, { x: -dst.x, y: -dst.y });
  }
  return s;
}

function routeLength(pts) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.abs(pts[i].x - pts[i - 1].x) + Math.abs(pts[i].y - pts[i - 1].y);
  return len;
}

/** Compare candidates lexicographically by safety, then bends, then length. */
function cmpScore(a, b) {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return a.length - b.length;
}

function scoreCandidate(pts, env) {
  const { cross, overlap } = wireConflicts(pts, env);
  // Crossing is a legal visual operation; collinear overlap is not. Prefer
  // separate wire channels before minimizing crossings. Labels are soft:
  // component clearance is hard, label clearance steers. After spacing and
  // pin-direction conformity, minimize visible bends, then route length.
  return [bboxCrossings(pts, env), overlap, cross, clearanceScore(pts, env), labelScore(pts, env), conformScore(pts, env), bendCount(pts), routeLength(pts)];
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
      for (const r of env.rects || []) {
        const clear = { x: r.x - STEP, y: r.y - STEP, w: r.w + 2 * STEP, h: r.h + 2 * STEP };
        const gateRow = (env.gatePassages || []).some((passage) => {
          if (passage.rect.x !== r.x || passage.rect.y !== r.y ||
              passage.rect.w !== r.w || passage.rect.h !== r.h) return false;
          return passage.dir.x !== 0 ? w.y === passage.point.y : w.x === passage.point.x;
        });
        if (strictlyInside(w, clear) && !gateRow) return true;
      }
      return false;
    };
    const occupied = (a, b) => occupiedWire(a, b, env);
    const LENGTH_WEIGHT = 1;
    const BEND_WEIGHT = 20;
    const D = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const g = new Map();
    const back = new Map();
    // Binary heap keeps A* from degenerating to O(n²) selection as the
    // bounded search window grows around large obstacles.
    const open = [];
    const less = (a, b) => a[0] !== b[0] ? a[0] < b[0] : a[1] < b[1];
    const pushOpen = (item) => {
      let i = open.length;
      open.push(item);
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (!less(item, open[p])) break;
        open[i] = open[p]; i = p;
      }
      open[i] = item;
    };
    const popOpen = () => {
      const first = open[0];
      const last = open.pop();
      if (open.length && last) {
        let i = 0;
        while (true) {
          let child = i * 2 + 1;
          if (child >= open.length) break;
          if (child + 1 < open.length && less(open[child + 1], open[child])) child++;
          if (!less(open[child], last)) break;
          open[i] = open[child]; i = child;
        }
        open[i] = last;
      }
      return first;
    };
    const addOpen = (cost, cx0, cy0, d) => {
      pushOpen([cost + (Math.abs(cx0 - tx) + Math.abs(cy0 - ty)) * LENGTH_WEIGHT, cost, cx0, cy0, d]);
    };
    for (let d = 0; d < 4; d++) {
      const nx = sx + D[d][0];
      const ny = sy + D[d][1];
      if (nx < x0 || nx > x1 || ny < y0 || ny > y1 || blocked(nx, ny)) continue;
      if (!terminalEdgeValid({ x: sx * STEP, y: sy * STEP }, { x: nx * STEP, y: ny * STEP }, env)) continue;
      if (occupied({ x: sx * STEP, y: sy * STEP }, { x: nx * STEP, y: ny * STEP })) continue;
      g.set(`${nx},${ny},${d}`, LENGTH_WEIGHT);
      back.set(`${nx},${ny},${d}`, `${sx},${sy},-1`);
      addOpen(LENGTH_WEIGHT, nx, ny, d);
    }
    let best = null;
    while (open.length) {
      const [, cost, cx0, cy0, d] = popOpen();
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
        if (!terminalEdgeValid({ x: cx0 * STEP, y: cy0 * STEP }, { x: nx * STEP, y: ny * STEP }, env)) continue;
        const nc = cost + LENGTH_WEIGHT + (nd === d ? 0 : BEND_WEIGHT);
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
 * cell OUTWARD in the pin's direction (a clean outside bend, never drilling
 * the body) are generated alongside the plain straight/L/Z ones; the conform
 * score prefers them, except when a constrained shared MOS gate passage makes
 * the direct gate bus intentional. The A* fallback only kicks in when every
 * enumerated candidate is rejected by the hard-safety checks. It is accepted
 * only after the same checks pass.
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
  const viable = cands.filter((candidate) => hardSafe(candidate, env));
  if (!viable.length) {
    const ast = astar(f, t, env);
    return ast && hardSafe(ast, env) ? ast : null;
  }
  const pool = viable;
  let best = pool[0];
  let bestScore = scoreCandidate(best, env);
  for (let i = 1; i < pool.length; i++) {
    const s = scoreCandidate(pool[i], env);
    if (cmpScore(s, bestScore) < 0) {
      best = pool[i];
      bestScore = s;
    }
  }
  return best;
}
