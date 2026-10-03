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
 * starting and ending `gap` outside their edges. Null when the tiles
 * overlap or sit too close for an arrow to show.
 */
export function linkArrow(from, to, gap = 0) {
  const fromCentre = { x: from.x + from.w / 2, y: from.y + from.h / 2 };
  const toCentre = { x: to.x + to.w / 2, y: to.y + to.h / 2 };
  const a = exitPoint(from, toCentre);
  const b = exitPoint(to, fromCentre);
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  // The tiles overlap when the exits cross over.
  const along = (b.x - a.x) * (toCentre.x - fromCentre.x) + (b.y - a.y) * (toCentre.y - fromCentre.y);
  if (along <= 0 || length <= 2 * gap) return null;
  const ux = (b.x - a.x) / length;
  const uy = (b.y - a.y) / length;
  return { x1: a.x + ux * gap, y1: a.y + uy * gap, x2: b.x - ux * gap, y2: b.y - uy * gap };
}
