/**
 * Following parts with their wires: which nets a set of parts touches, where
 * their pins were before a transform, and rerouting those nets after it.
 * Shared by the command language and the editor, so a scripted rotate and a
 * keyboard one reroute the same way.
 */

import { netTerminalPositionKey } from './model.js';

/** Ids of every net touching any of `refs`, in the parts' and their pins'
 *  order (reroutes run in it). Each pin's net comes from one pass over the
 *  nets: a scan per pin was quadratic when everything moves. */
export function netsTouching(circuit, refs) {
  const wanted = new Set(refs);
  const netOfPin = new Map();
  for (const net of circuit.nets.values()) {
    for (const t of net.terminals) {
      if (wanted.has(t.comp) && !netOfPin.has(`${t.comp}.${t.term}`)) netOfPin.set(`${t.comp}.${t.term}`, net);
    }
  }
  const touched = new Set();
  for (const refdes of refs) {
    const component = circuit.components.get(refdes);
    if (!component) continue;
    for (const terminal of component.terminalDefs) {
      const net = netOfPin.get(`${refdes}.${terminal.name}`);
      if (net) touched.add(net.id);
    }
  }
  return touched;
}

/** Each touched net's pin positions (netTerminalPositionKey), before a
 *  transform: a net whose pins all stay put need not reroute. */
export function captureNetTerminalPositions(circuit, refs) {
  return new Map([...netsTouching(circuit, refs)].map((id) => [id, netTerminalPositionKey(circuit, circuit.nets.get(id))]));
}

/** Each part's origin and pin positions, before a transform. */
export function captureComponentTerminalPositions(circuit, refs) {
  return new Map(refs.map((refdes) => {
    const component = circuit.components.get(refdes);
    return [refdes, {
      origin: component ? { x: component.transform.x, y: component.transform.y } : null,
      terminals: new Map(component?.worldTerminals().map((terminal) => [terminal.name, { x: terminal.x, y: terminal.y }]) || []),
    }];
  }));
}

/** How each part moved since `before` (captureComponentTerminalPositions):
 *  its origin's { dx, dy } and every pin's { before, after }, the form
 *  Circuit#rerouteNet takes. */
export function componentTerminalMoves(circuit, refs, before) {
  return new Map(refs.map((refdes) => {
    const component = circuit.components.get(refdes);
    const previous = before.get(refdes);
    const terminals = new Map(component?.worldTerminals().map((terminal) => [terminal.name, {
      before: previous?.terminals.get(terminal.name) || { x: terminal.x, y: terminal.y },
      after: { x: terminal.x, y: terminal.y },
    }]) || []);
    return [refdes, {
      dx: component && previous?.origin ? component.transform.x - previous.origin.x : 0,
      dy: component && previous?.origin ? component.transform.y - previous.origin.y : 0,
      terminals,
    }];
  }));
}

/**
 * Reroute every net touching `refs`. `moved` (refdes -> { dx, dy }) keeps
 * drawn shapes, slid or re-anchored; `fresh` lays a transformed part's nets
 * out again, except those whose pins `beforeTerminals` shows unmoved, and
 * `terminalMoves` (componentTerminalMoves) lets a managed net follow its
 * pins instead. Returns the id of a net that could not follow, else null.
 */
export function rerouteTouchedNets(circuit, refs, moved, { fresh = false, beforeTerminals = null, terminalMoves = null } = {}) {
  for (const id of netsTouching(circuit, refs)) {
    const net = circuit.nets.get(id);
    if (!net) continue;
    const unchanged = fresh && beforeTerminals?.has(id)
      && beforeTerminals.get(id) === netTerminalPositionKey(circuit, net);
    const routeArg = unchanged ? null
      : net.routingMode === 'fixed' ? (fresh ? 'refresh' : moved)
        : terminalMoves || (fresh ? 'refresh' : moved);
    if (circuit.rerouteNet(net, routeArg) === false) return id;
  }
  return null;
}

/**
 * Set a part's value. A transfer-function block sizes its box to its
 * equation, so a new definition can move its pins: the nets touching it
 * follow, as after a transform. Throws, leaving the circuit as it was, when
 * the value does not read or a wire cannot follow.
 */
export function setPartValue(circuit, refdes, value) {
  const component = circuit.getComponent(refdes);
  const before = captureComponentTerminalPositions(circuit, [refdes]);
  const beforeTerminals = captureNetTerminalPositions(circuit, [refdes]);
  const saved = { value: component.value, topology: circuit._snapshotNetTopology() };
  circuit.setValue(refdes, value);
  const moves = componentTerminalMoves(circuit, [refdes], before);
  const moved = [...moves.get(refdes).terminals.values()].some(({ before: a, after: b }) => a.x !== b.x || a.y !== b.y);
  if (!moved) return component;
  const stuck = rerouteTouchedNets(circuit, [refdes], null, { fresh: true, beforeTerminals, terminalMoves: moves });
  if (stuck !== null) {
    const name = circuit.nets.get(stuck)?.name || stuck;
    circuit.setValue(refdes, saved.value);
    circuit._restoreNetTopology(saved.topology);
    circuit.invalidateRoutingCache();
    throw new Error(`unable to reroute ${name} around the resized ${refdes}`);
  }
  circuit.reconnectCoincidentNets();
  circuit.syncJunctionSolders();
  return component;
}
