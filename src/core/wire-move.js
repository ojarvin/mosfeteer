/**
 * Moving a run of a managed wire sideways, keeping its ends joined: what a
 * segment drag in the editor does (web/main.js) and what `net <id>
 * segment-move` does from the command language. A run ending on a junction
 * carries the junction with it, so the branches meeting there follow; a run
 * ending on a pin keeps the pin and adds a connector leg.
 */

import { moveJunctionEndpoint, moveWireRun, wireRunAt } from './wireedit.js';
import { crossNetOverlaps } from './wiring.js';
import { snap } from './grid.js';

/** What a managed path's end at `point` is: a terminal (with its pin
 *  direction), a junction, or free. A terminal wins when both share the
 *  point: that end must stay on its pin. */
export function managedEndpointMeta(circuit, net, point) {
  const terminal = net.terminals.find((t) => {
    const p = circuit.components.get(t.comp)?.terminalWorld(t.term);
    return p && p.x === point.x && p.y === point.y;
  });
  if (terminal) {
    const c = circuit.components.get(terminal.comp);
    const def = c?.terminalDefs.find((t) => t.name === terminal.term);
    return {
      type: 'terminal', comp: terminal.comp, term: terminal.term, point: { ...point },
      dir: c && def ? circuit._pinDir(c, def, point.x, point.y) : null,
    };
  }
  if (net.junctions.some((p) => p.x === point.x && p.y === point.y)) return { type: 'junction', point: { ...point } };
  return { type: 'free', point: { ...point } };
}

/** The points a run never slides past: the net's terminals and junctions. */
export function managedWireBreaks(net) {
  return new Set((net?.anchorWorlds?.() || []).map((p) => `${p.x},${p.y}`));
}

/** Move one junction of `net`, its incident branch ends with it. */
export function moveManagedJunction(circuit, net, oldPoint, newPoint) {
  if (oldPoint.x === newPoint.x && oldPoint.y === newPoint.y) return;
  const paths = net.branches?.length ? net.branches : net.route ? [net.route] : [];
  net.junctions = moveJunctionEndpoint(paths, net.junctions, oldPoint, newPoint, (path, index) => managedEndpointMeta(circuit, net, path[index]));
}

/** Move `run` ({ net, pts, orient, line, endpointMeta }) to `target`,
 *  keeping junction ends joined. Returns the line it ended on. */
export function moveManagedWireRun(circuit, run, target) {
  const endpoints = [run.endpointMeta?.start?.point, run.endpointMeta?.end?.point].map((p) => p && { ...p });
  run.line = moveWireRun(run.pts, run.orient, run.line, target, run.endpointMeta);
  for (const i of [0, 1]) {
    const meta = run.endpointMeta?.[i === 0 ? 'start' : 'end'];
    const oldPoint = endpoints[i];
    if (meta?.type !== 'junction' || !oldPoint) continue;
    const actual = i === 0 ? run.pts[0] : run.pts[run.pts.length - 1];
    // Topology-bounded runs keep junction ends fixed and add connector legs;
    // unbounded moves carry the junction.
    if (actual?.x === oldPoint.x && actual?.y === oldPoint.y) continue;
    const newPoint = run.orient === 'h' ? { x: oldPoint.x, y: run.line } : { x: run.line, y: oldPoint.y };
    moveManagedJunction(circuit, run.net, oldPoint, newPoint);
  }
  return run.line;
}

/** The branch and segment of `net` whose straight segment holds `point`. */
function segmentAt(net, point) {
  const paths = net.branches?.length ? net.branches : net.route?.length >= 2 ? [net.route] : [];
  for (let branch = 0; branch < paths.length; branch++) {
    const pts = paths[branch];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const within = (v, p, q) => v >= Math.min(p, q) && v <= Math.max(p, q);
      const onH = a.y === b.y && point.y === a.y && within(point.x, a.x, b.x);
      const onV = a.x === b.x && point.x === a.x && within(point.y, a.y, b.y);
      if ((onH || onV) && !(a.x === b.x && a.y === b.y)) return { branch, segment: i, pts };
    }
  }
  return null;
}

const wireBodyIssues = (evaluate, circuit, netId) => evaluate(circuit).issues
  .filter((issue) => issue.kind === 'wire-through-body' && issue.netId === netId)
  .map((issue) => JSON.stringify([issue.netId, issue.refs || [], issue.points || []]));

/**
 * Move the straight run of `net` through `point` sideways to the line `to`
 * (a y for a horizontal run, an x for a vertical one), its ends kept joined.
 * Refuses, changing nothing, a move that would overlap another net or run
 * through a body it did not before. `evaluate` is commands.js's Design Check.
 * Returns { orient, from, to }.
 */
export function moveWireSegment(circuit, net, point, to, { evaluate }) {
  const p = { x: snap(point.x), y: snap(point.y) };
  const hit = segmentAt(net, p);
  if (!hit) throw new Error(`no straight segment of ${net.id} passes through (${p.x},${p.y})`);
  const breaks = managedWireBreaks(net);
  const run = wireRunAt(hit.pts, hit.segment, breaks);
  const before = JSON.stringify({ route: net.route, branches: net.branches, junctions: net.junctions });
  const overlapsBefore = new Set(crossNetOverlaps([...circuit.nets.values()].map((n) => ({ id: n.id, paths: n.paths() })))
    .map((o) => [o.key.split(':')[0], o.otherKey.split(':')[0]].sort().join('|')));
  const bodyBefore = new Set(wireBodyIssues(evaluate, circuit, net.id));
  const endpointMeta = {
    start: managedEndpointMeta(circuit, net, hit.pts[run.lo]),
    end: managedEndpointMeta(circuit, net, hit.pts[run.hi]),
    segment: hit.segment,
    breaks,
    runBounds: { lo: run.lo, hi: run.hi },
  };
  const live = { net, pts: hit.pts, orient: run.orient, line: run.val, endpointMeta };
  const restore = () => {
    const saved = JSON.parse(before);
    net.route = saved.route;
    net.branches = saved.branches;
    net.junctions = saved.junctions;
    circuit.syncJunctionSolders();
  };
  const reached = moveManagedWireRun(circuit, live, snap(to));
  if (reached === run.val) throw new Error(`the ${run.orient === 'h' ? 'horizontal' : 'vertical'} run at ${run.val} cannot move to ${snap(to)}: a neighboring run or a pin is in the way`);
  if (net.branches?.length) net.route = net.branches[0].map((q) => ({ ...q }));
  circuit._reduceNet(net);
  circuit.syncJunctionSolders();
  const collision = crossNetOverlaps([...circuit.nets.values()].map((n) => ({ id: n.id, paths: n.paths() })))
    .map((o) => [o.key.split(':')[0], o.otherKey.split(':')[0]])
    .find((pair) => pair.includes(net.id) && !overlapsBefore.has([...pair].sort().join('|')));
  if (collision) {
    restore();
    throw new Error(`the wire would overlap net ${collision.find((id) => id !== net.id) || net.id}`);
  }
  const body = wireBodyIssues(evaluate, circuit, net.id).find((key) => !bodyBefore.has(key));
  if (body) {
    restore();
    throw new Error(`the wire would run through a part: ${JSON.parse(body)[1].join(', ')}`);
  }
  return { orient: run.orient, from: run.val, to: reached };
}
