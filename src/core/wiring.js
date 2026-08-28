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

export function clonePath(path = []) {
  return normalizePath(orthogonalizePath(path));
}

export function normalizePath(path = []) {
  const out = [];
  for (const raw of path) {
    const p = { x: snap(raw.x), y: snap(raw.y) };
    const last = out[out.length - 1];
    if (last && last.x === p.x && last.y === p.y) continue;
    if (last && out.length > 1) {
      const prev = out[out.length - 2];
      if ((prev.x === last.x && last.x === p.x) || (prev.y === last.y && last.y === p.y)) {
        out[out.length - 1] = p;
        continue;
      }
    }
    out.push(p);
  }
  return out;
}

export function wireSegments(path = []) {
  const out = [];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    if (a.x !== b.x && a.y !== b.y) throw new Error('wire path must be orthogonal');
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
    if (a.x === b.x && P.x === a.x && between(P.y, a.y, b.y)) return true;
    if (a.y === b.y && P.y === a.y && between(P.x, a.x, b.x)) return true;
  }
  return false;
}

/** Split a normalized orthogonal polyline at grid point `p`, which must lie in
 *  the STRICT INTERIOR of one of its segments. Returns [left, right], where left
 *  ends at `p` and right starts at `p`. Returns null when `p` is a vertex (or
 *  off the path), in which case no split is needed. */
export function splitBranchAt(path = [], p) {
  const P = { x: snap(p.x), y: snap(p.y) };
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const interior =
      (a.x === b.x && P.x === a.x && P.y > Math.min(a.y, b.y) && P.y < Math.max(a.y, b.y)) ||
      (a.y === b.y && P.y === a.y && P.x > Math.min(a.x, b.x) && P.x < Math.max(a.x, b.x));
    if (interior) {
      return [
        normalizePath([...path.slice(0, i), P]),
        normalizePath([P, ...path.slice(i)]),
      ];
    }
  }
  return null;
}

/** Normalize a set of branches so no branch passes through a point shared with
 *  another branch or a terminal: every such point is split into a vertex, and
 *  duplicate branches are removed. Used to repair stale/overlapping geometry. */
export function normalizeBranches(paths = [], terminalPoints = []) {
  const cut = new Map();
  for (const path of paths) for (const p of path) cut.set(pointKey(p), { x: snap(p.x), y: snap(p.y) });
  for (const p of terminalPoints) cut.set(pointKey(p), { x: snap(p.x), y: snap(p.y) });

  const splitAtCut = (path) => {
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      for (const p of cut.values()) {
        const interior =
          (a.x === b.x && p.x === a.x && p.y > Math.min(a.y, b.y) && p.y < Math.max(a.y, b.y)) ||
          (a.y === b.y && p.y === a.y && p.x > Math.min(a.x, b.x) && p.x < Math.max(a.x, b.x));
        if (interior) {
          return [normalizePath([...path.slice(0, i), p]), normalizePath([p, ...path.slice(i)])]
            .filter((h) => h.length >= 2);
        }
      }
    }
    return null;
  };

  let work = paths.map((p) => normalizePath(p)).filter((p) => p.length >= 2);
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
export function junctionPoints(paths = [], terminalPoints = []) {
  const junctions = new Set();
  const strict = (n, a, b) => n > Math.min(a, b) && n < Math.max(a, b);

  // 1. Strict-interior perpendicular crossings (an unsplit wire passing through
  //    the endpoint of another branch, or two interiors crossing).
  for (let i = 0; i < paths.length; i++) {
    for (let j = i + 1; j < paths.length; j++) {
      for (const sa of wireSegments(paths[i])) for (const sb of wireSegments(paths[j])) {
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
  for (const path of paths) for (const s of wireSegments(path)) {
    const dx = Math.sign(s.b.x - s.a.x);
    const dy = Math.sign(s.b.y - s.a.y);
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
  return wireSegments(path).reduce((n, s) => n + Math.abs(s.a.x - s.b.x) + Math.abs(s.a.y - s.b.y), 0);
}

export function validateWiring(net) {
  const errors = [];
  for (const [bi, path] of net.paths().entries()) {
    for (const p of path) {
      if (p.x % GRID || p.y % GRID) errors.push(`branch ${bi} has off-grid point (${p.x},${p.y})`);
    }
    try { wireSegments(path); } catch (err) { errors.push(`branch ${bi}: ${err.message}`); }
  }
  return errors;
}
