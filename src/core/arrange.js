/**
 * Arrange parts like an earlier drawing of their topology. The topology
 * recognizer (topology-match.js) finds where else the selected parts are
 * drawn with the same connections: elsewhere in the same design, in the
 * other designs of the workspace, or in the built-in drawings
 * (arrange-builtins.js). Each distinct way they are drawn is a candidate;
 * applying one gives the parts the places and turns they have there, their
 * own labels the places they have there, and the wires among them the
 * wires drawn there. Wires to the rest of the drawing keep their far side
 * and join the arranged parts by a fresh leg.
 *
 * What is learnt is only what is drawn: the candidates come from the
 * designs themselves, the open one first and then the others by when they
 * were last saved, so a drawing changed by hand is the next one offered.
 */

import { applyTransform, rectsOverlap, segmentCrossesRect } from './geometry.js';
import { GRID, snap } from './grid.js';
import { smartRoute } from './router.js';
import { captureComponentTerminalPositions, componentTerminalMoves } from './part-moves.js';
import { findTopology, wiresJoining } from './topology-match.js';

/** How far (in cells) an arrangement may shift from where the parts are to
 *  keep clear of the rest of the drawing. */
const CLEAR_REACH = 16;

const pointKey = (p) => `${p.x},${p.y}`;

/** A transform's linear part, as the images of the unit vectors. */
function orientation(t) {
  const o = applyTransform({ ...t, x: 0, y: 0 }, 0, 0);
  const a = applyTransform({ ...t, x: 0, y: 0 }, 1, 0);
  const b = applyTransform({ ...t, x: 0, y: 0 }, 0, 1);
  return `${a.x - o.x},${a.y - o.y},${b.x - o.x},${b.y - o.y}`;
}

function ownedLabels(circuit) {
  const byOwner = new Map();
  for (const label of circuit.labels.values()) {
    if (!label.owner) continue;
    if (!byOwner.has(label.owner)) byOwner.set(label.owner, []);
    byOwner.get(label.owner).push(label);
  }
  return byOwner;
}

/** A pin's net in `circuit`, or null. */
function pinNets(circuit) {
  const nets = new Map();
  for (const net of circuit.nets.values()) {
    for (const t of net.terminals) if (!nets.has(`${t.comp}.${t.term}`)) nets.set(`${t.comp}.${t.term}`, net);
  }
  return nets;
}

/**
 * How a match draws the parts `refs`: `{ parts, labels, nets, offset, cost }`.
 * `parts` maps each part to its transform there, `labels` each part to its
 * own labels' `{ role, offset, align }` there, and `nets` lists each net of
 * `circuit` the parts touch with its pins among them and the wires joining
 * those pins there (null when the wires there do not join them). All in the
 * source's coordinates; `offset` moves them onto the parts where they are,
 * and `cost` is how far the parts would then move.
 */
function drawingOf(circuit, refs, source, match, context) {
  const parts = new Map();
  const labels = new Map();
  const sourceLabels = context.labelsOf(source);
  for (const ref of refs) {
    const { refdes, swapped } = match.parts.get(ref);
    const t = source.components.get(refdes).transform;
    parts.set(ref, { ...t, rotation: swapped ? (t.rotation + 180) % 360 : t.rotation });
    labels.set(ref, (sourceLabels.get(refdes) || []).map((label) => ({
      role: label.role || null,
      offset: label.offset ? (swapped ? { x: -label.offset.x || 0, y: -label.offset.y || 0 } : { ...label.offset }) : null,
      align: label.align,
    })));
  }
  const pinOf = (ref, term) => {
    const { refdes, swapped } = match.parts.get(ref);
    const component = source.components.get(refdes);
    const names = component.terminalDefs.map((d) => d.name);
    const mapped = swapped ? names[1 - names.indexOf(term)] : term;
    return { refdes, term: mapped, point: component.terminalWorld(mapped) };
  };
  const sourceNets = context.netsOf(source);
  const nets = [];
  const wanted = new Set(refs);
  for (const net of context.targetNets) {
    const pins = net.terminals.filter((t) => wanted.has(t.comp));
    const images = pins.map((t) => pinOf(t.comp, t.term));
    const there = sourceNets.get(`${images[0].refdes}.${images[0].term}`);
    const paths = there ? wiresJoining(there.paths(), images.map((p) => p.point)) : (pins.length > 1 ? null : []);
    nets.push({ id: net.id, pins, external: pins.length < net.terminals.length, paths });
  }
  // The shift that best lays the drawing over the parts where they are.
  let dx = 0;
  let dy = 0;
  for (const ref of refs) {
    const now = circuit.components.get(ref).transform;
    dx += now.x - parts.get(ref).x;
    dy += now.y - parts.get(ref).y;
  }
  const offset = { x: snap(dx / refs.length), y: snap(dy / refs.length) };
  let cost = 0;
  for (const ref of refs) {
    const now = circuit.components.get(ref).transform;
    const t = parts.get(ref);
    cost += Math.hypot(now.x - t.x - offset.x, now.y - t.y - offset.y);
  }
  return { parts, labels, nets, offset, cost };
}

/** What a drawing looks like, wherever it is: two drawings with one key
 *  draw the parts alike. */
function drawingKey(refs, drawing) {
  const base = drawing.parts.get(refs[0]);
  const rel = (p) => `${p.x - base.x},${p.y - base.y}`;
  const parts = refs.map((ref) => {
    const t = drawing.parts.get(ref);
    const labels = drawing.labels.get(ref)
      .map((l) => `${l.role || ''}:${l.offset ? pointKey(l.offset) : ''}:${l.align}`).sort().join('/');
    return `${ref}@${rel(t)}#${orientation(t)}[${labels}]`;
  });
  const nets = drawing.nets.map((net) => {
    if (!net.paths) return '?';
    const steps = [];
    for (const path of net.paths) {
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1];
        const b = path[i];
        if (a.x !== b.x && a.y !== b.y) { steps.push([rel(a), rel(b)].sort().join('-')); continue; }
        const n = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) / GRID;
        const sx = Math.sign(b.x - a.x) * GRID;
        const sy = Math.sign(b.y - a.y) * GRID;
        for (let k = 0; k < n; k++) {
          const p = { x: a.x + k * sx, y: a.y + k * sy };
          const q = { x: p.x + sx, y: p.y + sy };
          steps.push([rel(p), rel(q)].sort().join('-'));
        }
      }
    }
    return [...new Set(steps)].sort().join(' ');
  });
  return `${parts.join(';')}|${nets.join('|')}`;
}

function searchContext(circuit, refs) {
  const labelCache = new Map();
  const netCache = new Map();
  const wanted = new Set(refs);
  return {
    labelsOf: (c) => { if (!labelCache.has(c)) labelCache.set(c, ownedLabels(c)); return labelCache.get(c); },
    netsOf: (c) => { if (!netCache.has(c)) netCache.set(c, pinNets(c)); return netCache.get(c); },
    targetNets: [...circuit.nets.values()].filter((net) => net.terminals.some((t) => wanted.has(t.comp))),
  };
}

/** The parts of `refs` that arrange: every part but solder dots, in name order. */
export function arrangeableRefs(circuit, refs) {
  return [...new Set(refs)].filter((ref) => {
    const c = circuit.components.get(ref);
    return c && c.type !== 'solder';
  }).sort();
}

/**
 * The ways the parts `refs` of `circuit` are drawn elsewhere, best first:
 * `{ candidates, alike }`, each candidate `{ key, source, parts, count,
 * drawing }`, and `alike` the number of drawings that draw them as they are. `sources` lists
 * `{ circuit, name, path?, time?, builtIn? }` in the order to prefer them
 * (`circuit` itself among them for the open design, searched outside
 * `refs`). `parts` names the parts there, `count` how many drawings
 * (anywhere) draw them so; a way drawn like the parts already are is left
 * out. At most `limit`.
 */
export function arrangementCandidates(circuit, refs, sources, { limit = 9 } = {}) {
  const parts = arrangeableRefs(circuit, refs);
  if (parts.length < 2) return { candidates: [], alike: 0 };
  const context = searchContext(circuit, parts);
  const identity = { parts: new Map(parts.map((ref) => [ref, { refdes: ref, swapped: false }])) };
  const current = drawingKey(parts, drawingOf(circuit, parts, circuit, identity, context));
  const byKey = new Map();
  let alike = 0;
  for (const source of sources) {
    const matches = findTopology(circuit, parts, source.circuit, { exclude: source.circuit === circuit ? parts : [] });
    // One drawing per set of parts there: of the ways to map onto them (a
    // pair maps either way round), the one that moves the parts least.
    const best = new Map();
    for (const match of matches) {
      const image = [...match.parts.values()].map((p) => p.refdes).sort().join(',');
      const drawing = drawingOf(circuit, parts, source.circuit, match, context);
      const known = best.get(image);
      if (!known || drawing.cost < known.drawing.cost) best.set(image, { match, drawing });
    }
    const ranked = [...best.values()].sort((a, b) => a.drawing.cost - b.drawing.cost);
    for (const { match, drawing } of ranked) {
      const key = drawingKey(parts, drawing);
      if (key === current) { alike += 1; continue; }
      const known = byKey.get(key);
      if (known) { known.count += 1; continue; }
      byKey.set(key, {
        key,
        source: { name: source.name, path: source.path || null, builtIn: !!source.builtIn, current: source.circuit === circuit },
        sourceCircuit: source.circuit,
        parts: parts.map((ref) => match.parts.get(ref).refdes),
        count: 1,
        drawing,
      });
    }
  }
  return { candidates: [...byKey.values()].slice(0, limit), alike };
}

/** Every grid point along a set of polylines. */
function gridPoints(paths) {
  const out = new Map();
  for (const path of paths) {
    if (path.length === 1) out.set(pointKey(path[0]), path[0]);
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      const n = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) / GRID;
      if (a.x !== b.x && a.y !== b.y) { out.set(pointKey(a), a); out.set(pointKey(b), b); continue; }
      for (let k = 0; k <= n; k++) {
        const p = { x: a.x + Math.sign(b.x - a.x) * GRID * k, y: a.y + Math.sign(b.y - a.y) * GRID * k };
        out.set(pointKey(p), p);
      }
    }
  }
  return [...out.values()];
}

const shifted = (paths, d) => paths.map((path) => path.map((p) => ({ x: p.x + d.x, y: p.y + d.y })));

/** Within this many cells of where the parts are, the drawing goes where
 *  most of its wires to the rest of the drawing run straight. */
const ALIGN_REACH = 4;

/** The shift near `offset` at which the drawing keeps clear of the rest:
 *  no body on another, no pin on another part's pin, no wire through
 *  another body. Close by, the one that lines up the most pins with where
 *  their nets go on (`far`: `{ pins, points }` per net to the rest), so
 *  those legs run straight; else the nearest. Null when none is within
 *  reach. */
function clearOffset(circuit, refs, drawing, far = []) {
  const moving = new Set(refs);
  const others = [...circuit.components.values()].filter((c) => c.type !== 'solder' && !moving.has(c.refdes));
  const otherBodies = others.map((c) => c.bboxWorld());
  const otherPins = new Set(others.flatMap((c) => c.worldTerminals().map(pointKey)));
  const saved = new Map(refs.map((ref) => [ref, circuit.components.get(ref).transform]));
  // Each pin of a net to the rest at no shift, and where that net goes on.
  const reaches = far.flatMap(({ pins, points }) => pins.map((t) => {
    const c = circuit.components.get(t.comp);
    const p = applyTransform(drawing.parts.get(t.comp), c.localTerminal(t.term).x, c.localTerminal(t.term).y);
    return { p, points };
  }));
  const aligned = (d) => reaches.filter(({ p, points }) => points.some((q) => q.x === p.x + d.x || q.y === p.y + d.y)).length;
  const fits = (d) => {
    try {
      for (const ref of refs) {
        const t = drawing.parts.get(ref);
        circuit.components.get(ref).transform = { ...t, x: t.x + d.x, y: t.y + d.y };
      }
      for (const ref of refs) {
        const c = circuit.components.get(ref);
        const body = c.bboxWorld();
        if (otherBodies.some((r) => rectsOverlap(body, r))) return false;
        if (c.worldTerminals().some((p) => otherPins.has(pointKey(p)))) return false;
      }
      for (const net of drawing.nets) {
        for (const path of shifted(net.paths || [], d)) {
          for (let i = 1; i < path.length; i++) {
            if (otherBodies.some((r) => segmentCrossesRect(path[i - 1], path[i], r))) return false;
          }
        }
      }
      return true;
    } finally {
      for (const [ref, t] of saved) circuit.components.get(ref).transform = t;
    }
  };
  const tries = [];
  for (let x = -CLEAR_REACH; x <= CLEAR_REACH; x++) {
    for (let y = -CLEAR_REACH; y <= CLEAR_REACH; y++) tries.push({ x, y });
  }
  tries.sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y) || a.y - b.y || a.x - b.x);
  const at = (step) => ({ x: drawing.offset.x + step.x * GRID, y: drawing.offset.y + step.y * GRID });
  let best = null;
  for (const step of tries) {
    const near = Math.max(Math.abs(step.x), Math.abs(step.y)) <= ALIGN_REACH;
    if (!near && best) return best.d;
    const d = at(step);
    if (!fits(d)) continue;
    if (!near) return d;
    const score = aligned(d);
    if (!best || score > best.score) best = { d, score };
  }
  return best?.d || null;
}

/** The wire from one set of points to another that a net needs to join
 *  them, shortest first among the nearest pairs; null when none routes. */
function joiningLeg(circuit, net, from, to) {
  const env = circuit._routingEnv(net.id);
  const pairs = [];
  for (const a of from) for (const b of to) pairs.push({ a, b, d: Math.abs(a.x - b.x) + Math.abs(a.y - b.y) });
  pairs.sort((u, v) => u.d - v.d);
  for (const { a, b } of pairs.slice(0, 24)) {
    const leg = smartRoute(a, b, env);
    if (leg && leg.length >= 2) return leg;
  }
  return null;
}

/** The part of a net still drawn to pins other than `refs`' (wires pruned
 *  back from the parts that move), as polylines; the pins' points when the
 *  net has just one there. */
function farSide(circuit, net, refs) {
  const moving = new Set(refs);
  const points = net.terminals.filter((t) => !moving.has(t.comp))
    .map((t) => circuit.components.get(t.comp)?.terminalWorld(t.term)).filter(Boolean);
  if (!points.length) return null;
  const paths = wiresJoining(net.paths(), points);
  return { points, paths: paths || null };
}

/**
 * Draw the parts `refs` of `circuit` as `candidate` (one of arrangementCandidates')
 * does: their places and turns, their own labels' places, and the wires
 * among them. Each net to the rest of the drawing keeps its wires there and
 * joins the parts by a fresh leg; one that cannot is routed as a move
 * would. Throws, leaving the circuit as it was, when the drawing finds no
 * clear place or a net cannot be routed.
 */
export function applyArrangement(circuit, refs, candidate) {
  const parts = arrangeableRefs(circuit, refs);
  const { drawing } = candidate;
  if (parts.length !== drawing.parts.size || parts.some((ref) => !drawing.parts.has(ref))) {
    throw new Error('the parts changed since the drawing was found');
  }
  const far = new Map(drawing.nets.filter((n) => n.external).map((n) => [n.id, farSide(circuit, circuit.nets.get(n.id), parts)]));
  const reach = drawing.nets.filter((n) => far.get(n.id)).map((n) => {
    const side = far.get(n.id);
    return { pins: n.pins, points: side.paths?.length ? side.paths.flat() : side.points };
  });
  const offset = clearOffset(circuit, parts, drawing, reach);
  if (!offset) throw new Error('no clear place for the parts drawn this way');
  const saved = {
    transforms: new Map(parts.map((ref) => [ref, { ...circuit.components.get(ref).transform }])),
    labels: [...circuit.labels.values()].filter((l) => parts.includes(l.owner)).map((l) => ({ label: l, offset: l.offset && { ...l.offset }, align: l.align })),
    topology: circuit._snapshotNetTopology(),
    components: new Map(circuit.components),
  };
  const restore = () => {
    circuit.components.clear();
    for (const [ref, component] of saved.components) circuit.components.set(ref, component);
    for (const [ref, t] of saved.transforms) circuit.components.get(ref).transform = t;
    for (const { label, offset: o, align } of saved.labels) { label.offset = o; label.align = align; }
    circuit._restoreNetTopology(saved.topology);
    circuit.invalidateRoutingCache();
  };
  try {
    const before = captureComponentTerminalPositions(circuit, parts);
    for (const ref of parts) {
      const t = drawing.parts.get(ref);
      circuit.components.get(ref).transform = { ...t, x: t.x + offset.x, y: t.y + offset.y };
    }
    const owned = ownedLabels(circuit);
    for (const ref of parts) {
      const there = drawing.labels.get(ref);
      for (const label of owned.get(ref) || []) {
        const like = there.find((l) => l.role === (label.role || null));
        if (!like) continue;
        if (like.offset) label.offset = { ...like.offset };
        label.align = like.align;
      }
    }
    circuit.invalidateRoutingCache();
    const moves = componentTerminalMoves(circuit, parts, before);
    const followMove = (net) => {
      const original = saved.topology.nets.find((n) => n.id === net.id);
      net.allowDiagonal = original.allowDiagonal;
      net.route = original.route ? original.route.map((p) => ({ ...p })) : null;
      net.branches = original.branches ? original.branches.map((b) => b.map((p) => ({ ...p }))) : null;
      net.junctions = original.junctions.map((p) => ({ ...p }));
      if (circuit.rerouteNet(net, moves) === false) throw new Error(`unable to route ${net.name || net.id} to the arranged parts`);
    };
    for (const planned of drawing.nets) {
      const net = circuit.nets.get(planned.id);
      if (!net) continue;
      const inside = planned.paths ? shifted(planned.paths, offset) : null;
      if (!inside || planned.pins.length < 2 && !planned.external) {
        followMove(net);
        continue;
      }
      let paths = inside;
      if (planned.external) {
        const outside = far.get(net.id);
        if (!outside?.paths) { followMove(net); continue; }
        const pinPoints = planned.pins.map((t) => circuit.components.get(t.comp).terminalWorld(t.term));
        const from = inside.length ? gridPoints(inside) : pinPoints;
        const to = outside.paths.length ? gridPoints(outside.paths) : outside.points;
        const leg = joiningLeg(circuit, net, from, to);
        if (!leg) { followMove(net); continue; }
        paths = [...inside, ...outside.paths, leg];
      }
      circuit._installLiteralPaths(net, paths);
      if (!circuit._pathsConnectedToTerminals(net)) { followMove(net); continue; }
      circuit._repairNetLabels(net);
    }
    circuit.reconnectCoincidentNets();
    circuit.syncJunctionSolders();
    circuit.invalidateRoutingCache();
  } catch (error) {
    restore();
    throw error;
  }
  return { offset };
}
