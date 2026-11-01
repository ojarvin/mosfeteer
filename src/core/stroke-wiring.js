/**
 * Stroke wiring: one dragged path wires the terminals it passes.
 *
 * The stroke is a list of runs (the pen is lifted between runs). Each run
 * visits the terminals its cursor passes within `radius`, in order; two
 * visits in a row are linked into one net, except:
 *
 * - two terminals of one part never link (the stroke goes through the part);
 * - two terminals already on different nets never link (no shorts);
 * - a terminal of a net this stroke already left does not link a net of two
 *   or more terminals to it: the stroke returns to that net instead.
 *
 * A run's first link is deliberate: it may also be a diode connection (MOS
 * drain–gate, BJT collector–base) or join two wired nets whose names do not
 * conflict. A visit that does not link starts the next net from that
 * terminal. `planStroke` decides the links; `applyStrokePlan` wires them as
 * clicks from pin to pin would.
 */

import { GRID } from './grid.js';

const DIODE_PAIRS = [['drain', 'gate'], ['collector', 'base']];

function refOf(visit) {
  return `${visit.comp}.${visit.term}`;
}

function diodePair(a, b) {
  return DIODE_PAIRS.some(([p, q]) => (a.direction === p && b.direction === q) || (a.direction === q && b.direction === p));
}

/** Every component terminal in world space, with its direction. */
function strokeTerminals(circuit) {
  const out = [];
  for (const comp of circuit.components.values()) {
    for (const def of comp.terminalDefs || []) {
      const at = comp.terminalWorld(def.name);
      out.push({ comp: comp.refdes, term: def.name, direction: def.direction || '', x: at.x, y: at.y });
    }
  }
  return out;
}

/**
 * Collects terminal visits as the stroke grows. `add(point)` extends the
 * current run, `lift()` ends it (the next `add` starts a new run).
 */
export class StrokeWiring {
  constructor(circuit, { radius = GRID * 1.75 } = {}) {
    this.circuit = circuit;
    this.radius = radius;
    this.terminals = strokeTerminals(circuit);
    this.runs = [];
    this.visits = [];
    this.lifted = true;
  }

  /** The terminal nearest `point` within the capture radius, or null. */
  terminalNear(point) {
    let best = null;
    let bestD = this.radius;
    for (const t of this.terminals) {
      const d = Math.hypot(t.x - point.x, t.y - point.y);
      if (d <= bestD) {
        best = t;
        bestD = d;
      }
    }
    return best;
  }

  add(point) {
    const p = { x: point.x, y: point.y };
    if (this.lifted) {
      this.runs.push([p]);
      this.lifted = false;
      this._capture(p, true);
      return;
    }
    const run = this.runs.at(-1);
    const last = run.at(-1);
    // Sample the segment densely enough that no terminal is jumped over.
    const steps = Math.max(1, Math.ceil(Math.hypot(p.x - last.x, p.y - last.y) / (this.radius / 3)));
    for (let i = 1; i <= steps; i++) {
      this._capture({ x: last.x + (p.x - last.x) * i / steps, y: last.y + (p.y - last.y) * i / steps }, false);
    }
    run.push(p);
  }

  lift() {
    this.lifted = true;
  }

  _capture(point, start) {
    const hit = this.terminalNear(point);
    if (!hit) return;
    const run = this.runs.length - 1;
    const previous = this.visits.at(-1);
    if (!start && previous && previous.run === run && previous.comp === hit.comp && previous.term === hit.term) return;
    if (start && previous && previous.run === run) return;
    this.visits.push({ ...hit, run });
  }

  plan() {
    return planStroke(this.circuit, this.visits);
  }
}

/**
 * The wires a list of visits makes. Returns `{ links, wires }`: `links` are
 * the consecutive visit pairs, `ok` or with a `reason` (`part`, `short`,
 * `return`), and `same` when already one net; `wires` are the links to
 * wire, `{ from, to }` visits in stroke order.
 */
export function planStroke(circuit, visits) {
  const existing = new Map(); // terminal ref -> net id
  for (const net of circuit.nets.values()) {
    for (const t of net.terminals) existing.set(`${t.comp}.${t.term}`, net.id);
  }
  // Groups are union-find records over terminals; a terminal on an existing
  // net starts in that net's group.
  const parent = new Map();
  const info = new Map(); // root key -> { nets: Set, size, visited }
  const keyOf = (ref) => existing.get(ref) || ref;
  const find = (key) => {
    if (!parent.has(key)) {
      parent.set(key, key);
      const netId = circuit.nets.has(key) ? key : null;
      const size = netId ? circuit.nets.get(netId).terminals.length : 1;
      info.set(key, { nets: new Set(netId ? [netId] : []), size, visited: false });
    }
    let root = key;
    while (parent.get(root) !== root) root = parent.get(root);
    parent.set(key, root);
    return root;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return ra;
    parent.set(rb, ra);
    const ia = info.get(ra);
    const ib = info.get(rb);
    for (const id of ib.nets) ia.nets.add(id);
    ia.size += ib.size;
    ia.visited = ia.visited || ib.visited;
    info.delete(rb);
    return ra;
  };
  const namesConflict = (a, b) => circuit._namedNetNames([...a.nets, ...b.nets].map((id) => circuit.nets.get(id))).length > 1;

  const links = [];
  let current = null;
  let previous = null;
  let first = false; // the next link is the run's first: deliberate
  for (const visit of visits) {
    const group = find(keyOf(refOf(visit)));
    const enter = () => {
      current = group;
      info.get(group).visited = true;
      previous = visit;
    };
    if (!previous || previous.run !== visit.run) {
      enter();
      first = true;
      continue;
    }
    const deliberate = first;
    first = false;
    const link = { from: previous, to: visit, ok: false };
    links.push(link);
    if (find(current) === group) {
      // Already one net: nothing to wire, but the pair was passed in order.
      link.ok = true;
      link.same = true;
      enter();
      continue;
    }
    const here = info.get(find(current));
    const there = info.get(group);
    if (previous.comp === visit.comp && !(deliberate && diodePair(previous, visit))) link.reason = 'part';
    else if (here.nets.size && there.nets.size && (!deliberate || namesConflict(here, there))) link.reason = 'short';
    else if (there.visited && here.size >= 2) link.reason = 'return';
    else {
      link.ok = true;
      current = union(current, group);
      info.get(current).visited = true;
      previous = visit;
      continue;
    }
    enter();
  }
  return { links, wires: links.filter((link) => link.ok && !link.same).map(({ from, to }) => ({ from, to })) };
}

/**
 * Wire a plan's links in stroke order, each from its first pin to its
 * second, as a click on one pin and then the other would. `wireLink(from,
 * to)` does one; by default `Circuit#wireTo` routes it. Returns the nets.
 */
export function applyStrokePlan(circuit, plan, wireLink = (from, to) => circuit.wireTo(refOf(from), { x: to.x, y: to.y })) {
  const nets = new Set();
  for (const { from, to } of plan.wires) wireLink(from, to);
  for (const { from } of plan.wires) nets.add(circuit.netOfTerminal(refOf(from)));
  return [...nets];
}
