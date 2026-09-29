/**
 * Joining line annotations: several polylines that touch -- end to end, or
 * along a shared stretch, as copies of one clock cycle laid side by side --
 * become one continuous line. Their segments are split at each other's
 * vertices, shared pieces are kept once, and the result is walked from one
 * end to the other with the straight-through vertices dropped.
 */

const key = (p) => `${p.x},${p.y}`;

/** Whether `p` lies on segment a-b (grid points, so exact arithmetic). */
function onSegment(p, a, b) {
  if ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) !== 0) return false;
  return p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x)
    && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y);
}

/** Drop repeated points and the vertices a path runs straight through. */
export function tidyPolyline(points) {
  const out = [];
  for (const p of points) {
    if (out.length && out.at(-1).x === p.x && out.at(-1).y === p.y) continue;
    if (out.length >= 2) {
      const a = out.at(-2);
      const b = out.at(-1);
      const straight = (b.x - a.x) * (p.y - b.y) - (b.y - a.y) * (p.x - b.x) === 0
        && (b.x - a.x) * (p.x - b.x) + (b.y - a.y) * (p.y - b.y) > 0;
      if (straight) out.pop();
    }
    out.push({ x: p.x, y: p.y });
  }
  return out;
}

/**
 * The one polyline that the given polylines draw together, or null when
 * they do not make one continuous line (apart, branching, or crossing).
 */
export function joinPolylines(lists) {
  const polylines = lists.map((points) => (points || []).map((p) => ({ x: p.x, y: p.y }))).filter((points) => points.length >= 2);
  if (polylines.length < 2) return null;
  const vertices = new Map();
  for (const points of polylines) for (const p of points) vertices.set(key(p), p);
  // Every segment, split at any vertex lying on it; shared pieces once.
  const edges = new Map();
  for (const points of polylines) {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      if (a.x === b.x && a.y === b.y) continue;
      const along = [...vertices.values()]
        .filter((p) => onSegment(p, a, b))
        .sort((p, q) => (Math.abs(p.x - a.x) + Math.abs(p.y - a.y)) - (Math.abs(q.x - a.x) + Math.abs(q.y - a.y)));
      for (let j = 1; j < along.length; j++) {
        const [u, v] = [key(along[j - 1]), key(along[j])];
        edges.set(u < v ? `${u}|${v}` : `${v}|${u}`, [u, v]);
      }
    }
  }
  const neighbors = new Map();
  for (const [u, v] of edges.values()) {
    if (!neighbors.has(u)) neighbors.set(u, []);
    if (!neighbors.has(v)) neighbors.set(v, []);
    neighbors.get(u).push(v);
    neighbors.get(v).push(u);
  }
  if ([...neighbors.values()].some((list) => list.length > 2)) return null;
  const ends = [...neighbors.keys()].filter((node) => neighbors.get(node).length === 1);
  if (ends.length !== 2 && ends.length !== 0) return null;
  // Walk it: from one end, or round a closed loop back to its start.
  const start = ends[0] || neighbors.keys().next().value;
  const path = [start];
  const used = new Set();
  let node = start;
  for (;;) {
    const next = neighbors.get(node).find((other) => !used.has(node < other ? `${node}|${other}` : `${other}|${node}`));
    if (next === undefined) break;
    used.add(node < next ? `${node}|${next}` : `${next}|${node}`);
    path.push(next);
    node = next;
  }
  if (used.size !== edges.size) return null;
  return tidyPolyline(path.map((id) => vertices.get(id)));
}

/**
 * Join line annotations (ids) into the first of them, which keeps its style
 * and id; the others go. Throws, changing nothing, unless they make one
 * continuous line. Returns the joined line.
 */
export function joinLineAnnotations(circuit, ids) {
  const lines = [...new Set(ids)].map((id) => circuit.labels.get(id)).filter((label) => label?.kind === 'line');
  if (lines.length < 2) throw new Error('select two or more line annotations to join');
  const points = joinPolylines(lines.map((line) => line.points));
  if (!points) throw new Error('these lines do not make one continuous line: they must meet end to end or share a stretch, without branching');
  const [kept, ...rest] = lines;
  kept.points = points;
  kept.anchor = { ...points[0] };
  kept.end = { ...points.at(-1) };
  for (const line of rest) circuit.removeLabel(line.id);
  circuit.invalidateRoutingCache();
  return kept;
}
