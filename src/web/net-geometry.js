/**
 * Snapshots of a net's drawn geometry for a drag or a paste to restore or
 * move: its route, branches, and junctions, and the segment styles keyed by
 * their place on that route. Plain data, detached from the live model.
 */

const clonePoint = (p) => ({ ...p });
const clonePoints = (points, move = clonePoint) => (points || []).map(move);

export function cloneWireStyles(styles) {
  return Object.fromEntries(Object.entries(styles || {}).map(([key, style]) => [key, { ...style }]));
}

/** A net's route geometry, each point through `move` (a copy by default). */
export function captureRouteGeometry(net, move = clonePoint) {
  return {
    route: net.route ? clonePoints(net.route, move) : null,
    branches: net.branches ? net.branches.map((path) => clonePoints(path, move)) : null,
    junctions: clonePoints(net.junctions, move),
  };
}

/** Route geometry with the segment styles that decorate it. */
export function captureNetGeometry(net) {
  return { ...captureRouteGeometry(net), wireStyles: cloneWireStyles(net.wireStyles) };
}

/** One snapshot per distinct net behind a set of dragged wire runs. */
export function captureRunNetGeometry(runs) {
  const snapshots = new Map();
  for (const run of runs) {
    if (!snapshots.has(run.net.id)) snapshots.set(run.net.id, { id: run.net.id, net: run.net, ...captureNetGeometry(run.net) });
  }
  return snapshots;
}

/** Put a snapshot back on `net`, moved by (dx, dy): its geometry and its
 *  segment styles together, so a style stays on the segment it was set on. */
export function translateNetGeometry(net, saved, dx, dy) {
  const move = (p) => ({ x: p.x + dx, y: p.y + dy });
  Object.assign(net, captureRouteGeometry(saved, move));
  if (saved.wireStyles) net.wireStyles = cloneWireStyles(saved.wireStyles);
}
