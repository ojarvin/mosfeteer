/**
 * The workspace's links as a graph: which designs a design's parts link to
 * (its children) and which designs link to it (where it is used). A link
 * names a design (ComponentInstance#link); a name no design has is a broken
 * link and joins nothing.
 */

/**
 * `designs`: [{ id, name, links: [name] }]. Returns `{ edges, children,
 * parents }`: edges `{ from, to }` by id, parent to child, each pair once;
 * children and parents map an id to the ids on the other end. A name shared
 * by several designs resolves to the first, as a link does.
 */
export function linkGraph(designs) {
  const byName = new Map();
  for (const design of designs) if (!byName.has(design.name)) byName.set(design.name, design.id);
  const edges = [];
  const children = new Map(designs.map((design) => [design.id, []]));
  const parents = new Map(designs.map((design) => [design.id, []]));
  for (const design of designs) {
    for (const name of new Set(design.links || [])) {
      const to = byName.get(name);
      if (to === undefined || to === design.id || children.get(design.id).includes(to)) continue;
      edges.push({ from: design.id, to });
      children.get(design.id).push(to);
      parents.get(to).push(design.id);
    }
  }
  return { edges, children, parents };
}

/** Where the line from `r`'s centre toward `toward` leaves the rectangle. */
function exitPoint(r, toward) {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const t = Math.min(dx ? (r.w / 2) / Math.abs(dx) : Infinity, dy ? (r.h / 2) / Math.abs(dy) : Infinity);
  return { x: cx + dx * t, y: cy + dy * t };
}

/**
 * An arrow from one tile to another along the line joining their centres,
 * starting and ending `gap` outside their edges -- less when the tiles sit
 * close, so neighbours still get a short arrow. Null when they overlap.
 */
export function linkArrow(from, to, gap = 0) {
  const fromCentre = { x: from.x + from.w / 2, y: from.y + from.h / 2 };
  const toCentre = { x: to.x + to.w / 2, y: to.y + to.h / 2 };
  const a = exitPoint(from, toCentre);
  const b = exitPoint(to, fromCentre);
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  // The tiles overlap when the exits cross over.
  const along = (b.x - a.x) * (toCentre.x - fromCentre.x) + (b.y - a.y) * (toCentre.y - fromCentre.y);
  if (along <= 0 || !length) return null;
  const ux = (b.x - a.x) / length;
  const uy = (b.y - a.y) / length;
  const g = Math.min(gap, length / 4);
  return { x1: a.x + ux * g, y1: a.y + uy * g, x2: b.x - ux * g, y2: b.y - uy * g };
}

/**
 * A link drawn from a point (the part that links, in screen units) to a
 * design's frame `to` ({ x, y, w, h }): a cubic curve that leaves toward
 * the frame and arrives square to the side facing the point, at the point's
 * own height (or width) on that side, kept within its middle so arrows to
 * one design spread out without crowding its corners. `gap` keeps the head
 * off the frame. Returns `{ start, c1, c2, end, direction }` (direction the
 * unit vector the head points along), or null when the point is inside the
 * frame.
 */
export function linkCurve(from, to, gap = 6) {
  const left = to.x - from.x;
  const right = from.x - (to.x + to.w);
  const above = to.y - from.y;
  const below = from.y - (to.y + to.h);
  const outside = Math.max(left, right, above, below);
  if (outside <= 0) return null;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  let end;
  let normal;
  if (outside === left || outside === right) {
    const y = clamp(from.y, to.y + to.h * 0.2, to.y + to.h * 0.8);
    normal = { x: outside === left ? -1 : 1, y: 0 };
    end = { x: outside === left ? to.x - gap : to.x + to.w + gap, y };
  } else {
    const x = clamp(from.x, to.x + to.w * 0.2, to.x + to.w * 0.8);
    normal = { x: 0, y: outside === above ? -1 : 1 };
    end = { x, y: outside === above ? to.y - gap : to.y + to.h + gap };
  }
  const length = Math.hypot(end.x - from.x, end.y - from.y);
  const reach = Math.min(length * 0.45, 160);
  const towards = { x: (end.x - from.x) / (length || 1), y: (end.y - from.y) / (length || 1) };
  return {
    start: { ...from },
    c1: { x: from.x + towards.x * reach, y: from.y + towards.y * reach },
    c2: { x: end.x + normal.x * reach, y: end.y + normal.y * reach },
    end,
    direction: { x: -normal.x, y: -normal.y },
  };
}
