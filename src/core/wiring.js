import { snap, GRID } from './grid.js';

export const pointKey = (p) => `${snap(p.x)},${snap(p.y)}`;

export function orthogonalizePath(path = []) {
  const out = [];
  for (let i = 0; i < path.length; i++) {
    const a = path[i];
    const p = { x: snap(a.x), y: snap(a.y) };
    const last = out[out.length - 1];
    if (last && last.x !== p.x && last.y !== p.y) out.push({ x: p.x, y: last.y });
    out.push(p);
  }
  return out;
}

export function clonePath(path = [], allowDiagonal = false) {
  return allowDiagonal ? normalizePath(path, true) : normalizePath(orthogonalizePath(path));
}

/** Clone a protected direct-wire path without changing its shape. Direct wires
 * are still grid-snapped, but unlike managed paths their diagonal segments and
 * intentional intermediate collinear points are part of the saved geometry. */
export function cloneFixedPath(path = []) {
  const out = [];
  for (const raw of path || []) {
    const p = { x: snap(raw.x), y: snap(raw.y) };
    const last = out[out.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) out.push(p);
  }
  return out;
}

/** Return path segments without imposing managed-wire orthogonality. */
export function pathSegments(path = []) {
  const out = [];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    if (a.x !== b.x || a.y !== b.y) out.push({ index: i, a, b });
  }
  return out;
}

export function normalizePath(path = [], allowDiagonal = false) {
  const out = [];
  for (const raw of path) {
    const p = { x: snap(raw.x), y: snap(raw.y) };
    const last = out[out.length - 1];
    if (last && last.x === p.x && last.y === p.y) continue;
    if (last && out.length > 1) {
      const prev = out[out.length - 2];
      // Merge a collinear middle point ONLY when the run is monotonic. A point
      // where the polyline reverses direction (an out-and-back such as the
      // balanced route's visit to a terminal: (120,120)->(120,80)->(120,120))
      // is a real vertex and must be preserved, otherwise the terminal's wire
      // leg silently disappears.
      const cross = (last.x - prev.x) * (p.y - last.y) - (last.y - prev.y) * (p.x - last.x);
      const horiz = prev.y === last.y && last.y === p.y;
      const vert = prev.x === last.x && last.x === p.x;
      const collinear = allowDiagonal && cross === 0;
      if ((horiz || collinear) && (p.x - last.x) * (last.x - prev.x) +
          (p.y - last.y) * (last.y - prev.y) >= 0) {
        out[out.length - 1] = p;
        continue;
      }
      if (vert && (p.y - last.y) * (last.y - prev.y) >= 0) {
        out[out.length - 1] = p;
        continue;
      }
    }
    out.push(p);
  }
  return out;
}

export function wireSegments(path = [], allowDiagonal = false) {
  const out = [];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    if (!allowDiagonal && a.x !== b.x && a.y !== b.y) throw new Error('wire path must be orthogonal');
    if (a.x !== b.x || a.y !== b.y) out.push({ index: i, a, b });
  }
  return out;
}

function between(n, a, b) {
  return n >= Math.min(a, b) && n <= Math.max(a, b);
}

/** True if grid point `p` lies on any segment of `path` (interior or vertex). */
export function pointOnPath(p, path = []) {
  const P = { x: snap(p.x), y: snap(p.y) };
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const cross = (P.x - a.x) * (b.y - a.y) - (P.y - a.y) * (b.x - a.x);
    if (cross === 0 && between(P.x, a.x, b.x) && between(P.y, a.y, b.y)) return true;
  }
  return false;
}

/** Split a normalized orthogonal polyline at grid point `p`, which must lie in
 *  the STRICT INTERIOR of one of its segments. Returns [left, right], where left
 *  ends at `p` and right starts at `p`. Returns null when `p` is a vertex (or
 *  off the path), in which case no split is needed. */
export function splitBranchAt(path = [], p, allowDiagonal = false) {
  const P = { x: snap(p.x), y: snap(p.y) };
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const cross = (P.x - a.x) * (b.y - a.y) - (P.y - a.y) * (b.x - a.x);
    const interior = cross === 0 && between(P.x, a.x, b.x) && between(P.y, a.y, b.y) &&
      !(P.x === a.x && P.y === a.y) && !(P.x === b.x && P.y === b.y);
    if (interior) {
      return [
        normalizePath([...path.slice(0, i), P], allowDiagonal),
        normalizePath([P, ...path.slice(i)], allowDiagonal),
      ];
    }
  }
  return null;
}

/** Normalize a set of branches so no branch passes through a point shared with
 *  another branch or a terminal: every such point is split into a vertex, and
 *  duplicate branches are removed. Used to repair stale/overlapping geometry. */
export function normalizeBranches(paths = [], terminalPoints = [], allowDiagonal = false) {
  const cut = new Map();
  for (const path of paths) for (const p of path) cut.set(pointKey(p), { x: snap(p.x), y: snap(p.y) });
  for (const p of terminalPoints) cut.set(pointKey(p), { x: snap(p.x), y: snap(p.y) });

  const splitAtCut = (path) => {
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      for (const p of cut.values()) {
        const cross = (p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x);
        const interior = cross === 0 && between(p.x, a.x, b.x) && between(p.y, a.y, b.y) &&
          !(p.x === a.x && p.y === a.y) && !(p.x === b.x && p.y === b.y);
        if (interior) {
          return [normalizePath([...path.slice(0, i), p], allowDiagonal), normalizePath([p, ...path.slice(i)], allowDiagonal)]
            .filter((h) => h.length >= 2);
        }
      }
    }
    return null;
  };

  let work = paths.map((p) => normalizePath(p, allowDiagonal)).filter((p) => p.length >= 2);
  let changed = true;
  while (changed) {
    changed = false;
    const next = [];
    for (const path of work) {
      const split = splitAtCut(path);
      if (split) { next.push(...split); changed = true; }
      else next.push(path);
    }
    work = next;
  }

  const seen = new Set();
  const out = [];
  for (const p of work) {
    const key = JSON.stringify(p);
    if (!seen.has(key)) { seen.add(key); out.push(p); }
  }
  return out;
}

/** Return all same-net junction points, including T and cross intersections.
 *  A junction is a grid point where three or more electrical arms meet, where
 *  each arm is a distinct wire direction leaving the point or a terminal. */
export function junctionPoints(paths = [], terminalPoints = [], allowDiagonal = false) {
  const junctions = new Set();
  const strict = (n, a, b) => n > Math.min(a, b) && n < Math.max(a, b);

  // 1. Strict-interior perpendicular crossings (an unsplit wire passing through
  //    the endpoint of another branch, or two interiors crossing).
  for (let i = 0; i < paths.length; i++) {
    for (let j = i + 1; j < paths.length; j++) {
      const segmentsA = allowDiagonal ? pathSegments(paths[i]) : wireSegments(paths[i]);
      const segmentsB = allowDiagonal ? pathSegments(paths[j]) : wireSegments(paths[j]);
      for (const sa of segmentsA) for (const sb of segmentsB) {
        if (sa.a.x === sa.b.x && sb.a.y === sb.b.y &&
            between(sa.a.x, sb.a.x, sb.b.x) && between(sb.a.y, sa.a.y, sa.b.y) &&
            (strict(sa.a.x, sb.a.x, sb.b.x) || strict(sb.a.y, sa.a.y, sa.b.y))) junctions.add(`${sa.a.x},${sb.a.y}`);
        if (sa.a.y === sa.b.y && sb.a.x === sb.b.x &&
            between(sb.a.x, sa.a.x, sa.b.x) && between(sa.a.y, sb.a.y, sb.b.y) &&
            (strict(sb.a.x, sa.a.x, sa.b.x) || strict(sa.a.y, sb.a.y, sb.b.y))) junctions.add(`${sb.a.x},${sa.a.y}`);
      }
    }
  }

  // 2. Branch vertices and terminals with three or more distinct arms.
  const arms = new Map();
  const add = (p, dir) => {
    const k = pointKey(p);
    if (!arms.has(k)) arms.set(k, new Set());
    arms.get(k).add(dir);
  };
  const gcd = (a, b) => {
    while (b) [a, b] = [b, a % b];
    return a || 1;
  };
  for (const path of paths) for (const s of (allowDiagonal ? pathSegments(path) : wireSegments(path))) {
    const rawDx = s.b.x - s.a.x;
    const rawDy = s.b.y - s.a.y;
    const divisor = gcd(Math.abs(rawDx), Math.abs(rawDy));
    const dx = rawDx / divisor;
    const dy = rawDy / divisor;
    add(s.a, `${dx},${dy}`);
    add(s.b, `${-dx},${-dy}`);
  }
  for (const p of terminalPoints) add(p, 'term');
  for (const [key, dirs] of arms) if (dirs.size >= 3) junctions.add(key);

  return [...junctions].map((key) => {
    const [x, y] = key.split(',').map(Number);
    return { x, y };
  });
}

/** Return the positive-length collinear overlap of two arbitrary segments. */
function collinearOverlap(a, b, c, d) {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const wx = d.x - c.x;
  const wy = d.y - c.y;
  if ((c.x - a.x) * vy - (c.y - a.y) * vx !== 0 || vx * wy - vy * wx !== 0) return null;
  const useX = Math.abs(vx) >= Math.abs(vy);
  const value = (p) => useX ? p.x : p.y;
  const lo = Math.max(Math.min(value(a), value(b)), Math.min(value(c), value(d)));
  const hi = Math.min(Math.max(value(a), value(b)), Math.max(value(c), value(d)));
  if (hi <= lo) return null;
  const at = (s) => useX
    ? { x: s, y: a.y + (s - a.x) * vy / vx }
    : { x: a.x + (s - a.y) * vx / vy, y: s };
  const p0 = at(lo);
  const p1 = at(hi);
  return { x0: p0.x, y0: p0.y, x1: p1.x, y1: p1.y };
}

/** Collinear overlapping segments between DIFFERENT nets.
 *  nets: [{ id, paths: [[{x,y},...]] }]. Returns [{ key, otherKey, x0, y0, x1, y1 }]
 *  where key = `${netId}:${branch}:${seg}` and (x0,y0)-(x1,y1) is the shared span. */
export function crossNetOverlaps(nets) {
  const segs = [];
  for (const net of nets || []) {
    const paths = net.paths || [];
    for (let bi = 0; bi < paths.length; bi++) {
      const path = paths[bi];
      for (const s of pathSegments(path)) {
        segs.push({ key: `${net.id}:${bi}:${s.index}`, netId: net.id, a: s.a, b: s.b });
      }
    }
  }
  const out = [];
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const sa = segs[i];
      const sb = segs[j];
      if (sa.netId === sb.netId) continue;
      const overlap = collinearOverlap(sa.a, sa.b, sb.a, sb.b);
      if (overlap) out.push({ key: sa.key, otherKey: sb.key, ...overlap });
      if (false) {
        // both vertical on the same x
        const lo = Math.max(Math.min(sa.a.y, sa.b.y), Math.min(sb.a.y, sb.b.y));
        const hi = Math.min(Math.max(sa.a.y, sa.b.y), Math.max(sb.a.y, sb.b.y));
        if (hi > lo) out.push({ key: sa.key, otherKey: sb.key, x0: sa.a.x, y0: lo, x1: sa.a.x, y1: hi });
      } else if (false && sa.a.y === sa.b.y && sb.a.y === sb.b.y && sa.a.y === sb.a.y) {
        // both horizontal on the same y
        const lo = Math.max(Math.min(sa.a.x, sa.b.x), Math.min(sb.a.x, sb.b.x));
        const hi = Math.min(Math.max(sa.a.x, sa.b.x), Math.max(sb.a.x, sb.b.x));
        if (hi > lo) out.push({ key: sa.key, otherKey: sb.key, x0: lo, y0: sa.a.y, x1: hi, y1: sa.a.y });
      }
    }
  }
  return out;
}

/** True when two branch lists are point-identical (same order, same points). */
export function samePolylineSet(a = [], b = []) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const pa = a[i];
    const pb = b[i];
    if (!pa || !pb || pa.length !== pb.length) return false;
    for (let k = 0; k < pa.length; k++) {
      if (pa[k].x !== pb[k].x || pa[k].y !== pb[k].y) return false;
    }
  }
  return true;
}

/** Endpoints of every strictly-positive collinear overlap between two segments
 *  of DIFFERENT branches. Splitting both branches at these points turns an
 *  overlapped span into a parallel edge the MST can drop, so a wire dragged on
 *  top of a same-net wire merges into it instead of hiding beneath it. */
function overlapEndpoints(paths = [], allowDiagonal = false) {
  const out = [];
  for (let i = 0; i < paths.length; i++) {
    for (let j = i + 1; j < paths.length; j++) {
      const segmentsA = allowDiagonal ? pathSegments(paths[i]) : wireSegments(paths[i]);
      const segmentsB = allowDiagonal ? pathSegments(paths[j]) : wireSegments(paths[j]);
      for (const sa of segmentsA) for (const sb of segmentsB) {
        const overlap = collinearOverlap(sa.a, sa.b, sb.a, sb.b);
        if (overlap) out.push({ x: overlap.x0, y: overlap.y0 }, { x: overlap.x1, y: overlap.y1 });
        if (false && sa.a.x === sa.b.x && sb.a.x === sb.b.x && sa.a.x === sb.a.x) {
          // both vertical on the same x
          const lo = Math.max(Math.min(sa.a.y, sb.a.y), Math.min(sb.a.y, sb.b.y));
          const hi = Math.min(Math.max(sa.a.y, sb.a.y), Math.max(sb.a.y, sb.b.y));
          if (hi > lo) { out.push({ x: sa.a.x, y: lo }, { x: sa.a.x, y: hi }); }
        } else if (false && sa.a.y === sa.b.y && sb.a.y === sb.b.y && sa.a.y === sb.a.y) {
          // both horizontal on the same y
          const lo = Math.max(Math.min(sa.a.x, sb.a.x), Math.min(sb.a.x, sb.b.x));
          const hi = Math.min(Math.max(sa.a.x, sb.a.x), Math.max(sb.a.x, sb.b.x));
          if (hi > lo) { out.push({ x: lo, y: sa.a.y }, { x: hi, y: sa.a.y }); }
        }
      }
    }
  }
  return out;
}

/**
 * Reduce a set of wire branches to the minimum spanning tree of their
 * connectivity graph — the conventional ratsnest-style reduction (Kruskal;
 * KiCad's RN_NET::kruskalMST, EAGLE RATSNEST). Terminals and junctions
 * (T/cross points) become graph vertices; each polyline run between two
 * vertices is an edge weighted by its Manhattan length. Parallel edges (the
 * same two points wired more than once, or two runs lying on top of each
 * other along a shared span) and cycle edges (loops) are removed, keeping
 * only the cheapest connected structure; ties are broken by insertion order
 * (older branches win), so the result is deterministic and idempotent: an
 * already-minimal net is returned unchanged. Bridges (the only path between
 * two points) are never removed; terminals are never moved or dropped, and
 * always stay branch endpoints (never collapsed into a run).
 */
export function reduceBranches(paths = [], terminalPoints = [], allowDiagonal = false) {
  const terminals = terminalPoints.map((p) => ({ x: snap(p.x), y: snap(p.y) }));
  // Split every branch at every shared vertex, terminal, junction, and
  // collinear-overlap boundary so all intersections become real vertices
  // before the graph is built.
  const split = normalizeBranches(
    paths,
    [...terminals, ...junctionPoints(paths, terminalPoints, allowDiagonal), ...overlapEndpoints(paths, allowDiagonal)],
    allowDiagonal,
  ).filter((p) => p.length >= 2);
  if (split.length === 0) return [];

  const key = (p) => `${snap(p.x)},${snap(p.y)}`;
  const terminalKeys = new Set(terminals.map(key));
  // A polyline that closes on itself (first point == last point) is a loop in
  // a single branch; open it by dropping the duplicated closing point so the
  // MST reduces it like any other path instead of a degenerate self-loop.
  const open = split.map((p) =>
    p.length > 1 && p[0].x === p[p.length - 1].x && p[0].y === p[p.length - 1].y ? p.slice(0, -1) : p
  ).filter((p) => p.length >= 2);
  if (open.length === 0) return [];

  // Branch points: terminals plus junctions of the split geometry (3+ arms).
  const branchPoints = new Set([...terminalKeys, ...junctionPoints(open, terminalPoints, allowDiagonal).map(key)]);

  // Runs: maximal spans of each branch between branch points (or the branch's
  // own dangling ends). Each run is one graph edge carrying its polyline.
  const edges = [];
  for (let bi = 0; bi < open.length; bi++) {
    const path = open[bi];
    let runStart = 0;
    let runCost = 0;
    for (let i = 1; i < path.length; i++) {
      const prev = path[i - 1];
      const p = path[i];
      runCost += allowDiagonal
        ? Math.hypot(p.x - prev.x, p.y - prev.y)
        : Math.abs(p.x - prev.x) + Math.abs(p.y - prev.y);
      if (branchPoints.has(key(p)) || i === path.length - 1) {
        if (i > runStart) {
          edges.push({
            a: key(path[runStart]), b: key(p), cost: runCost, bi, si: runStart + 1,
            pts: path.slice(runStart, i + 1),
          });
        }
        runStart = i;
        runCost = 0;
      }
    }
  }
  if (edges.length === 0) return [];

  // Kruskal: keep the cheapest edge joining two previously separate components;
  // parallel edges (2-cycles) and loop edges (cycle property) are dropped.
  const parent = new Map();
  const find = (k) => {
    let p = parent.get(k);
    if (p === undefined) { parent.set(k, k); return k; }
    while (p !== parent.get(p)) p = parent.get(p);
    let q = k;
    while (parent.get(q) !== q) { const n = parent.get(q); parent.set(q, p); q = n; }
    return p;
  };
  const union = (a, b) => {
    a = find(a);
    b = find(b);
    if (a === b) return false;
    parent.set(a, b);
    return true;
  };
  const sorted = [...edges].sort((e1, e2) => e1.cost - e2.cost || e1.bi - e2.bi || e1.si - e2.si);
  const kept = [];
  for (const e of sorted) if (union(e.a, e.b)) kept.push(e);
  if (kept.length === edges.length) return open; // already minimal

  // Reassemble the kept forest: runs meeting at a non-terminal degree-2 vertex
  // (a point that ceased to branch) merge into one polyline, so no phantom
  // junctions or redundant vertices survive. Terminal vertices stay branch
  // boundaries so wire legs re-anchor correctly when their component moves.
  const adj = new Map();
  const add = (v) => { if (!adj.has(v)) adj.set(v, []); };
  for (const e of kept) {
    add(e.a);
    add(e.b);
    adj.get(e.a).push({ to: e.b, e });
    adj.get(e.b).push({ to: e.a, e });
  }
  const seen = new Set();
  const out = [];
  const tag = (e) => `${e.bi}:${e.si}`;
  // Orient an edge's polyline to start at `fromV` (a tree walk crosses edges
  // in either direction; runs are always stored start-to-end).
  const orient = (e, fromV) => {
    const pts = e.pts;
    if (key(pts[0]) === fromV) return pts;
    return pts.slice().reverse();
  };
  for (const [v, list] of adj) {
    if (list.length === 2 && !terminalKeys.has(v)) continue; // interior of a run
    for (const first of list) {
      if (seen.has(tag(first.e))) continue;
      const poly = [...orient(first.e, v)]; // starts at v, carries every bend
      let prev = v;
      let cur = first.to;
      seen.add(tag(first.e));
      while (adj.get(cur).length === 2 && !terminalKeys.has(cur)) {
        const next = adj.get(cur).find((n) => n.to !== prev);
        if (!next) break;
        seen.add(tag(next.e));
        const shared = cur; // orient must start at the vertex the walk is AT
        prev = cur;
        cur = next.to;
        poly.push(...orient(next.e, shared).slice(1)); // next.pts starts at `shared`
      }
      out.push({ poly: normalizePath(poly, allowDiagonal), bi: first.e.bi, si: first.e.si });
    }
  }
  out.sort((a, b) => a.bi - b.bi || a.si - b.si);
  return out.map((o) => o.poly);
}

/** Remove one editable segment and return normalized remaining paths. */
export function deleteWireSegment(paths, branch, segment) {
  if (!paths[branch]) return paths;
  const path = paths[branch];
  if (segment <= 0 || segment >= path.length) return paths;
  const left = normalizePath(path.slice(0, segment));
  const right = normalizePath(path.slice(segment));
  const next = paths.slice();
  next.splice(branch, 1, ...(left.length > 1 ? [left] : []), ...(right.length > 1 ? [right] : []));
  return next;
}

/** Group terminal points connected by the remaining wire geometry. */
export function connectedTerminalGroups(paths, terminals) {
  const points = new Map();
  const parent = new Map();
  const add = (p) => { const k = pointKey(p); if (!parent.has(k)) parent.set(k, k); points.set(k, { x: snap(p.x), y: snap(p.y) }); return k; };
  const find = (k) => { let p = parent.get(k); while (p !== parent.get(p)) p = parent.get(p); let q = k; while (parent.get(q) !== q) { const n = parent.get(q); parent.set(q, p); q = n; } return p; };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent.set(a, b); };
  const on = (p, a, b) => a.x === b.x ? p.x === a.x && between(p.y, a.y, b.y) : p.y === a.y && between(p.x, a.x, b.x);
  for (const path of paths) for (const p of path) add(p);
  for (const path of paths) for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]; const b = path[i];
    for (const [k, p] of points) if (on(p, a, b)) union(add(a), k);
  }
  const groups = new Map();
  for (const t of terminals) {
    const p = t.point;
    const candidates = [...points.values()].filter((q) => q.x === p.x && q.y === p.y);
    const root = candidates.length ? find(pointKey(candidates[0])) : `terminal:${t.comp}.${t.term}`;
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(t);
  }
  return [...groups.values()];
}

/** Partition terminals and branches into connected components. A branch whose
 *  points do not touch any terminal is dropped. Returns
 *  [{ terminals: [{comp,term,point}], paths: [[...]] }]. */
export function splitByComponent(paths, terminals) {
  const parent = new Map();
  const find = (k) => { let p = parent.get(k); while (p !== parent.get(p)) p = parent.get(p); let q = k; while (parent.get(q) !== q) { const n = parent.get(q); parent.set(q, p); q = n; } return p; };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent.set(a, b); };
  const addPoint = (p) => { const k = pointKey(p); if (!parent.has(k)) parent.set(k, k); return k; };
  for (const path of paths) {
    let prev = null;
    for (const p of path) {
      const k = addPoint(p);
      if (prev) union(prev, k);
      prev = k;
    }
  }
  const groups = new Map();
  for (const t of terminals) {
    if (!t.point) continue;
    const k = pointKey(t.point);
    const root = parent.has(k) ? find(k) : `terminal:${t.comp}.${t.term}`;
    if (!groups.has(root)) groups.set(root, { terminals: [], paths: [] });
    groups.get(root).terminals.push(t);
  }
  for (const path of paths) {
    if (!path.length) continue;
    const root = find(pointKey(path[0]));
    if (groups.has(root)) groups.get(root).paths.push(path);
  }
  return [...groups.values()];
}

export function pathLength(path = []) {
  return pathSegments(path).reduce((n, s) => n + Math.hypot(s.a.x - s.b.x, s.a.y - s.b.y), 0);
}

export function validateWiring(net) {
  const errors = [];
  for (const [bi, path] of net.paths().entries()) {
    for (const p of path) {
      if (p.x % GRID || p.y % GRID) errors.push(`branch ${bi} has off-grid point (${p.x},${p.y})`);
    }
    if (net.routingMode !== 'fixed') {
      try { wireSegments(path, net.allowDiagonal === true); } catch (err) { errors.push(`branch ${bi}: ${err.message}`); }
    }
  }
  return errors;
}
