/**
 * Stroke wiring: one dragged path wires the terminals it passes.
 *
 * The stroke is a list of runs (the pen is lifted between runs). Each run
 * passes terminals; which of them it meant is decided from the whole run:
 *
 * - a terminal is a candidate where the run comes nearest it, within its
 *   reach (`radius`, but no further than halfway to the nearest other
 *   terminal unless that is still within 1.75 cells), and only if it is
 *   a quarter nearer than any other terminal there;
 * - a candidate is deliberate when the run passes within half a cell, turns
 *   or slows down at it, or starts or ends there; a deliberate candidate is
 *   kept, a passing one only if keeping it costs less than leaving it out;
 * - two terminals of one part in a row cost little when the run goes
 *   through the part between them (in at one pin against its outward
 *   direction, out at the other along its), and much when it only skims
 *   past, so a gate grazed beside a source rail is left out;
 * - running back the way it came over the last terminal releases it (and
 *   on, the one before); `dropLast` releases the last one too.
 *
 * Two kept terminals in a row are linked into one net, except:
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

// The path is examined every eighth of a cell.
const STEP = GRID / 8;
// Costs of the run's explanation: keeping a candidate costs its distance as
// a share of its reach; leaving out a deliberate one costs SKIP_DELIBERATE,
// a passing one SKIP_PASSING plus more the nearer it was passed; two pins of
// one part in a row cost PART_SKIM, or PART_THROUGH when the run passes
// through the part from one to the other.
const SKIP_DELIBERATE = 3;
const SKIP_PASSING = 0.6;
const PART_SKIM = 2;
const PART_THROUGH = 0.1;

function refOf(visit) {
  return `${visit.comp}.${visit.term}`;
}

function diodePair(a, b) {
  return DIODE_PAIRS.some(([p, q]) => (a.direction === p && b.direction === q) || (a.direction === q && b.direction === p));
}

/**
 * Every component terminal in world space, with its direction. Terminals at
 * one point are one stop: the first stands for them all.
 */
function strokeTerminals(circuit) {
  const out = [];
  const seen = new Set();
  for (const comp of circuit.components.values()) {
    for (const def of comp.terminalDefs || []) {
      const at = comp.terminalWorld(def.name);
      const key = `${at.x},${at.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const outward = circuit._pinDir(comp, def, at.x, at.y);
      out.push({ comp: comp.refdes, term: def.name, direction: def.direction || '', x: at.x, y: at.y, outward });
    }
  }
  return out;
}

/** The unit heading from `a` to `b`, or null when they coincide. */
function heading(a, b) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  return len ? { x: (b.x - a.x) / len, y: (b.y - a.y) / len } : null;
}

/**
 * Collects a stroke's path. `add(point)` extends the current run (a point
 * may carry its time `t` in milliseconds), `lift()` ends it (the next `add`
 * starts a new run). `visits` are the terminals the stroke means, in order.
 */
export class StrokeWiring {
  constructor(circuit, { radius = GRID * 1.75 } = {}) {
    this.circuit = circuit;
    this.radius = radius;
    this.terminals = strokeTerminals(circuit);
    for (const t of this.terminals) {
      let nearest = Infinity;
      for (const u of this.terminals) if (u !== t) nearest = Math.min(nearest, Math.hypot(u.x - t.x, u.y - t.y));
      t.reach = Math.min(radius, Math.max(GRID * 1.75, nearest / 2));
    }
    this.runs = [];
    this.lifted = true;
    this._dense = [];
    this._dropped = new Set();
    this._visits = null;
  }

  /** The terminal nearest `point` within its reach, or null. */
  terminalNear(point) {
    let best = null;
    let bestD = Infinity;
    for (const t of this.terminals) {
      const d = Math.hypot(t.x - point.x, t.y - point.y);
      if (d <= t.reach && d < bestD) {
        best = t;
        bestD = d;
      }
    }
    return best;
  }

  add(point) {
    const p = { x: point.x, y: point.y, ...(Number.isFinite(point.t) ? { t: point.t } : {}) };
    this._visits = null;
    if (this.lifted) {
      this.runs.push([p]);
      this._dense.push([{ ...p, arc: 0 }]);
      this.lifted = false;
      return;
    }
    const dense = this._dense.at(-1);
    const last = dense.at(-1);
    const length = Math.hypot(p.x - last.x, p.y - last.y);
    const steps = Math.max(1, Math.ceil(length / STEP));
    for (let i = 1; i <= steps; i++) {
      const f = i / steps;
      const q = { x: last.x + (p.x - last.x) * f, y: last.y + (p.y - last.y) * f, arc: last.arc + length * f };
      if (Number.isFinite(p.t) && Number.isFinite(last.t)) q.t = last.t + (p.t - last.t) * f;
      dense.push(q);
    }
    this.runs.at(-1).push(p);
  }

  lift() {
    this.lifted = true;
  }

  /** Releases the last terminal the stroke means. Returns it, or null. */
  dropLast() {
    const last = this.visits.at(-1);
    if (!last) return null;
    this._dropped.add(last.key);
    this._visits = null;
    return last;
  }

  /** The terminals the stroke means, in order, each with its `run`. */
  get visits() {
    if (!this._visits) this._visits = this._dense.flatMap((dense, run) => this._decode(dense, run));
    return this._visits;
  }

  plan() {
    return planStroke(this.circuit, this.visits);
  }

  /** Where one run comes nearest each terminal within its reach. */
  _candidates(dense, run) {
    const box = dense.reduce((b, p) => ({
      x0: Math.min(b.x0, p.x), y0: Math.min(b.y0, p.y), x1: Math.max(b.x1, p.x), y1: Math.max(b.y1, p.y),
    }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
    const out = [];
    for (const t of this.terminals) {
      if (t.x < box.x0 - t.reach || t.x > box.x1 + t.reach || t.y < box.y0 - t.reach || t.y > box.y1 + t.reach) continue;
      let best = null;
      let start = -1;
      const close = () => {
        if (best) out.push({ ...t, ...best, run, key: `${run}:${t.comp}.${t.term}:${start}` });
        best = null;
      };
      for (let i = 0; i < dense.length; i++) {
        const d = Math.hypot(dense[i].x - t.x, dense[i].y - t.y);
        if (d > t.reach) {
          close();
          continue;
        }
        if (!best) start = i;
        if (!best || d < best.d) best = { d, i };
      }
      close();
    }
    out.sort((a, b) => a.i - b.i);
    // Clearly the nearest terminal where the run passes it (a quarter nearer
    // than any other), or within half a cell.
    return out.filter((c) => {
      if (c.d <= GRID / 2) return true;
      const at = dense[c.i];
      return this.terminals.every((u) => (u.x === c.x && u.y === c.y) || c.d < 0.75 * Math.hypot(u.x - at.x, u.y - at.y));
    });
  }

  /** The terminals one run means: see the module comment. */
  _decode(dense, run) {
    if (dense.length < 2) {
      const hit = dense[0] && this.terminalNear(dense[0]);
      if (!hit) return [];
      const { comp, term, direction, x, y } = hit;
      return [{ comp, term, direction, x, y, run, key: `${run}:${comp}.${term}:0` }];
    }
    const total = dense.at(-1).arc;
    // The index a given arc length before or after `i`.
    const along = (i, ds) => {
      let j = i;
      if (ds > 0) while (j < dense.length - 1 && dense[j].arc - dense[i].arc < ds) j++;
      else while (j > 0 && dense[i].arc - dense[j].arc < -ds) j--;
      return j;
    };
    const timed = dense.every((p) => Number.isFinite(p.t));
    const speedAt = (i) => {
      const a = along(i, -GRID / 2);
      const b = along(i, GRID / 2);
      return (dense[b].arc - dense[a].arc) / Math.max(1e-6, dense[b].t - dense[a].t);
    };
    let median = 0;
    if (timed) {
      const speeds = [];
      for (let i = 0; i < dense.length; i += 4) speeds.push(speedAt(i));
      speeds.sort((a, b) => a - b);
      median = speeds[speeds.length >> 1];
    }
    const deliberate = (c) => {
      if (c.d <= GRID / 2) return true;
      if (dense[c.i].arc <= GRID || total - dense[c.i].arc <= GRID) return true;
      const before = heading(dense[along(c.i, -GRID)], dense[c.i]);
      const after = heading(dense[c.i], dense[along(c.i, GRID)]);
      if (before && after && Math.acos(Math.max(-1, Math.min(1, before.x * after.x + before.y * after.y))) > 0.6) return true;
      return timed && median > 0 && speedAt(c.i) < 0.5 * median;
    };

    // Running back over the last terminal, the way the run came, releases it.
    const kept = [];
    for (const c of this._candidates(dense, run)) {
      if (this._dropped.has(c.key)) continue;
      const top = kept.at(-1);
      if (top && top.x === c.x && top.y === c.y && total - dense[c.i].arc >= GRID) {
        // A run's first pin has no way in: the way the run left it stands for it.
        const arrived = heading(dense[along(top.i, -GRID)], dense[top.i]) || heading(dense[top.i], dense[along(top.i, GRID)]);
        const left = heading(dense[c.i], dense[along(c.i, GRID)]);
        if (arrived && left && arrived.x * left.x + arrived.y * left.y < -0.5) {
          kept.pop();
          continue;
        }
      }
      kept.push(c);
    }

    // The cheapest explanation: which candidates the run meant.
    const n = kept.length;
    if (!n) return [];
    const strong = kept.map(deliberate);
    const keepCost = (k) => kept[k].d / kept[k].reach;
    const skipCost = (k) => (strong[k] ? SKIP_DELIBERATE : SKIP_PASSING + 0.6 * (1 - kept[k].d / kept[k].reach));
    const linkCost = (a, b) => {
      const p = kept[a];
      const q = kept[b];
      if (p.comp !== q.comp || p.term === q.term) return 0;
      const inward = heading(dense[p.i], dense[along(p.i, GRID)]);
      const outward = heading(dense[along(q.i, -GRID)], dense[q.i]);
      const through = inward && outward &&
        -(inward.x * p.outward.x + inward.y * p.outward.y) > 0.5 && outward.x * q.outward.x + outward.y * q.outward.y > 0.5;
      return through ? PART_THROUGH : PART_SKIM;
    };
    const skipped = [0];
    for (let k = 0; k < n; k++) skipped.push(skipped[k] + skipCost(k));
    const cost = new Array(n).fill(Infinity);
    const from = new Array(n).fill(-1);
    for (let k = 0; k < n; k++) {
      cost[k] = skipped[k] + keepCost(k);
      for (let j = 0; j < k; j++) {
        const c = cost[j] + skipped[k] - skipped[j + 1] + keepCost(k) + linkCost(j, k);
        if (c < cost[k]) {
          cost[k] = c;
          from[k] = j;
        }
      }
    }
    let best = 0;
    for (let k = 1; k < n; k++) {
      if (cost[k] + skipped[n] - skipped[k + 1] < cost[best] + skipped[n] - skipped[best + 1]) best = k;
    }
    const chosen = [];
    for (let k = best; k >= 0; k = from[k]) chosen.unshift(kept[k]);
    return chosen
      .filter((c, k) => k === 0 || c.x !== chosen[k - 1].x || c.y !== chosen[k - 1].y)
      .map(({ comp, term, direction, x, y, key }) => ({ comp, term, direction, x, y, run, key }));
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
