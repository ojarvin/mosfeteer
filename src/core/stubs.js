/**
 * Wire stubs: a short wire out of every unconnected terminal of the chosen
 * parts, each ending its own new net and carrying a net label with a fresh
 * generated name (net1, net2, ...). Like Virtuoso's "create wire stubs and
 * labels", it turns a placed part into one that is wired up by name.
 */

import { GRID } from './grid.js';
import { INTERFACE_PIN_TYPES, REFERENCE_MARKER_TYPES, canonicalNetName } from './model.js';
import { pointOnPath } from './wiring.js';

/** Stub length: two grid cells out of the terminal. */
export const STUB_CELLS = 2;

const samePoint = (a, b) => a.x === b.x && a.y === b.y;

/** The lowest `net<k>` that no net and no part is called. */
function freshNetName(taken) {
  for (let k = 1; ; k += 1) {
    const name = `net${k}`;
    if (!taken.has(name.toLowerCase())) return name;
  }
}

function takenNames(circuit) {
  const taken = new Set();
  for (const net of circuit.nets.values()) if (net.name) taken.add(canonicalNetName(net.name).toLowerCase());
  for (const refdes of circuit.components.keys()) taken.add(String(refdes).toLowerCase());
  return taken;
}

/**
 * Whether a stub from terminal point `from` to `to` (grid points `points`
 * along it) would join something: another terminal or a solder dot anywhere on
 * it, a wire touching either end, or a wire running along it or ending,
 * bending, or branching on it. A wire crossing it straight through is fine.
 */
function stubShorts(circuit, component, terminalName, points) {
  const from = points[0];
  const to = points.at(-1);
  for (const other of circuit.components.values()) {
    if (other.type === 'solder') {
      const dot = { x: other.transform.x, y: other.transform.y };
      if (points.some((p) => samePoint(p, dot))) return true;
      continue;
    }
    for (const def of other.terminalDefs) {
      if (other === component && def.name === terminalName) continue;
      const w = other.terminalWorld(def.name);
      if (points.some((p) => samePoint(p, w))) return true;
    }
  }
  const horizontal = from.y === to.y;
  for (const net of circuit.nets.values()) {
    for (const path of net.paths()) {
      if (path.length < 2) continue;
      for (const [i, p] of points.entries()) {
        if (!pointOnPath(p, path)) continue;
        if (i === 0 || i === points.length - 1) return true;
        if (path.some((vertex) => samePoint(vertex, p))) return true;
        for (let s = 1; s < path.length; s += 1) {
          const a = path[s - 1];
          const b = path[s];
          if (!pointOnPath(p, [a, b])) continue;
          if (horizontal ? a.y === b.y : a.x === b.x) return true;
        }
      }
    }
  }
  return false;
}

/**
 * Add a stub and a named net label to every unconnected terminal of the parts
 * `refdes`. A stub leaves its terminal along the terminal's outward direction,
 * STUB_CELLS long; its label sits at the middle of the stub, above a
 * horizontal stub with its text aligned toward the terminal, and beside a
 * vertical one aligned toward the wire. A stub that would join anything else
 * is skipped. Returns { stubs: [{ ref, netId, name, labelId }], skipped: [ref] }.
 */
export function addTerminalStubs(circuit, refdes) {
  const stubs = [];
  const skipped = [];
  const taken = takenNames(circuit);
  // Resolve every part first, so an unknown one leaves the drawing untouched.
  const components = refdes.map((ref) => circuit.getComponent(ref));
  for (const component of components) {
    if (component.type === 'solder' || REFERENCE_MARKER_TYPES.includes(component.type) || INTERFACE_PIN_TYPES.has(component.type)) continue;
    for (const def of component.terminalDefs) {
      const termRef = `${component.refdes}.${def.name}`;
      if (circuit.netOfTerminal({ comp: component.refdes, term: def.name })) continue;
      const from = component.terminalWorld(def.name);
      const dir = circuit._pinDir(component, def, from.x, from.y);
      const points = [];
      for (let i = 0; i <= STUB_CELLS; i += 1) points.push({ x: from.x + dir.x * GRID * i, y: from.y + dir.y * GRID * i });
      if (stubShorts(circuit, component, def.name, points)) {
        skipped.push(termRef);
        continue;
      }
      const path = [points[0], points.at(-1)];
      const name = freshNetName(taken);
      taken.add(name.toLowerCase());
      const net = circuit.createWireNet({ branches: [path], route: path });
      circuit.connectTo(net.id, termRef);
      circuit.renameNet(net, name);
      const middle = points[Math.floor(points.length / 2)];
      const labelOpts = dir.y === 0
        ? { netSide: 'above', align: dir.x < 0 ? 'right' : 'left' }
        : { netSide: 'right', align: 'parent' };
      const label = circuit.addNetLabel(net, { anchor: middle, ...labelOpts });
      stubs.push({ ref: termRef, netId: net.id, name, labelId: label.id });
    }
  }
  return { stubs, skipped };
}
