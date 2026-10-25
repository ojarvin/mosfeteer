/**
 * The symmetry axis: while one is held, an edit on one side of it is made
 * on the other side too, mirrored. Nothing remembers which part is whose
 * twin: two parts are twins when one is drawn where the other's mirror
 * image is (same type, mirrored place and turn), so an edit is mirrored by
 * comparing the drawing before it with the drawing after it
 * (`mirrorEdit`):
 *
 * - a part added gets a twin, unless it sits on the axis or one is there;
 * - a part moved, turned, or mirrored has its twin follow, mirrored;
 * - a part removed takes its twin with it;
 * - a wire drawn is drawn again, mirrored, from and to the twins of what it
 *   joins, unless it is its own mirror image (a wire across the axis).
 *
 * Wires deleted and labels are left to the hand. An axis is
 * `{ operation, pin }`: 'mirrorX' about the vertical line through `pin`,
 * 'mirrorY' about the horizontal one.
 */

import { GRID } from './grid.js';
import { applyTransform } from './geometry.js';
import { transformComponentWorld } from './model.js';
import { captureComponentTerminalPositions, captureNetTerminalPositions, componentTerminalMoves, rerouteTouchedNets } from './part-moves.js';

const key = (p) => `${p.x},${p.y}`;

/** A point's mirror image. */
export function mirrorPoint(p, axis) {
  return axis.operation === 'mirrorX' ? { x: 2 * axis.pin.x - p.x, y: p.y } : { x: p.x, y: 2 * axis.pin.y - p.y };
}

/** A part's transform mirrored about the axis. */
export function mirrorTransform(t, axis) {
  return transformComponentWorld(t, axis.pin, axis.operation);
}

/** The images of the unit vectors under a transform: equal for two
 *  transforms that turn a symbol the same way. */
function turn(t) {
  const o = applyTransform({ ...t, x: 0, y: 0 }, 0, 0);
  const a = applyTransform({ ...t, x: 0, y: 0 }, 1, 0);
  const b = applyTransform({ ...t, x: 0, y: 0 }, 0, 1);
  return `${a.x - o.x},${a.y - o.y},${b.x - o.x},${b.y - o.y}`;
}

const sameTransform = (a, b) => a.x === b.x && a.y === b.y && turn(a) === turn(b);

/** Whether a part sits on the axis: its mirror image is in its own place. */
function onAxis(component, axis) {
  const t = mirrorTransform(component.transform, axis);
  return t.x === component.transform.x && t.y === component.transform.y;
}

/**
 * Each part's twin about the axis: a Map from a part to the part of its
 * type drawn as its mirror image, or to itself when it sits on the axis.
 * Parts with neither are left out. Solder dots are not parts.
 */
export function twins(circuit, axis) {
  const map = new Map();
  const byPlace = new Map();
  for (const c of circuit.components.values()) {
    if (c.type === 'solder') continue;
    const k = `${c.type}@${key(c.transform)}`;
    if (!byPlace.has(k)) byPlace.set(k, []);
    byPlace.get(k).push(c);
  }
  for (const c of circuit.components.values()) {
    if (c.type === 'solder') continue;
    if (onAxis(c, axis)) { map.set(c.refdes, c.refdes); continue; }
    const image = mirrorTransform(c.transform, axis);
    const twin = (byPlace.get(`${c.type}@${key(image)}`) || []).find((other) => sameTransform(other.transform, image));
    if (twin) map.set(c.refdes, twin.refdes);
  }
  return map;
}

/** Each grid step a circuit's wires take, as `a-b` keys (ends sorted). */
function wireSteps(circuit) {
  const steps = new Map();
  for (const net of circuit.nets.values()) {
    for (const path of net.paths()) {
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1];
        const b = path[i];
        if (a.x !== b.x && a.y !== b.y) { steps.set([key(a), key(b)].sort().join('-'), { a, b, net: net.id }); continue; }
        const n = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) / GRID;
        const sx = Math.sign(b.x - a.x) * GRID;
        const sy = Math.sign(b.y - a.y) * GRID;
        for (let k = 0; k < n; k++) {
          const p = { x: a.x + k * sx, y: a.y + k * sy };
          const q = { x: p.x + sx, y: p.y + sy };
          steps.set([key(p), key(q)].sort().join('-'), { a: p, b: q, net: net.id });
        }
      }
    }
  }
  return steps;
}

/** The new wire, as polylines from end to end: the steps there now and not
 *  before, cut at every end, joint, and corner-free run between. */
function drawnRuns(before, after, skipNets) {
  const old = wireSteps(before);
  const added = [...wireSteps(after)].filter(([k, step]) => !old.has(k) && !skipNets.has(step.net)).map(([, step]) => step);
  const next = new Map();
  const link = (p, q) => {
    if (!next.has(key(p))) next.set(key(p), { point: p, to: [] });
    next.get(key(p)).to.push(q);
  };
  for (const { a, b } of added) { link(a, b); link(b, a); }
  // Points where a run stops: an end, or a joint of three or more.
  const stop = (k) => next.get(k).to.length !== 2;
  const walked = new Set();
  const edge = (p, q) => [key(p), key(q)].sort().join('|');
  const runs = [];
  const walk = (from, first) => {
    const run = [from];
    let previous = from;
    let current = first;
    walked.add(edge(from, first));
    while (true) {
      run.push(current);
      if (stop(key(current))) break;
      const onward = next.get(key(current)).to.find((p) => key(p) !== key(previous) && !walked.has(edge(current, p)));
      if (!onward) break;
      walked.add(edge(current, onward));
      previous = current;
      current = onward;
    }
    runs.push(run);
  };
  for (const { point, to } of next.values()) {
    if (!stop(key(point))) continue;
    for (const q of to) if (!walked.has(edge(point, q))) walk(point, q);
  }
  // A loop with no end or joint on it.
  for (const { point, to } of next.values()) {
    for (const q of to) if (!walked.has(edge(point, q))) walk(point, q);
  }
  return runs;
}

/** A polyline without the points where it runs straight on. */
function corners(run) {
  const out = [run[0]];
  for (let i = 1; i < run.length - 1; i++) {
    const a = out.at(-1);
    const b = run[i];
    const c = run[i + 1];
    if ((b.x - a.x) * (c.y - b.y) !== (b.y - a.y) * (c.x - b.x)) out.push(b);
  }
  out.push(run.at(-1));
  return out;
}

/** The pin at a point, as `REF.TERM`, or null. */
function pinAt(circuit, p) {
  for (const c of circuit.components.values()) {
    if (c.type === 'solder') continue;
    for (const t of c.worldTerminals()) if (t.x === p.x && t.y === p.y) return `${c.refdes}.${t.name}`;
  }
  return null;
}

/**
 * Make on the other side of `axis` what the edit from `before` (a copy of
 * the circuit as it was) to `circuit` (as it is) made on one side. Returns
 * `{ added, moved, removed, wires }`, the parts and runs made, moved, and
 * removed on the other side. Changes `circuit`; a mirrored wire or move
 * that cannot be made is left out, and the rest stands.
 */
export function mirrorEdit(before, circuit, axis) {
  const done = { added: [], moved: [], removed: [], wires: 0 };
  const was = twins(before, axis);
  const changed = new Set();
  // Parts removed take their twins.
  for (const ref of before.components.keys()) {
    if (circuit.components.has(ref) || before.components.get(ref).type === 'solder') continue;
    const twin = was.get(ref);
    if (!twin || twin === ref || !circuit.components.has(twin)) continue;
    circuit.removeComponent(twin);
    done.removed.push(twin);
  }
  // Parts moved, turned, or mirrored: their twins follow, unless the edit
  // changed the twin too (a pair moved together).
  const movedRefs = [...circuit.components.values()].filter((c) => {
    const old = before.components.get(c.refdes);
    return old && c.type !== 'solder' && !sameTransform(old.transform, c.transform);
  }).map((c) => c.refdes);
  for (const ref of movedRefs) changed.add(ref);
  const followers = [];
  for (const ref of movedRefs) {
    const twin = was.get(ref);
    if (!twin || twin === ref || changed.has(twin) || !circuit.components.has(twin)) continue;
    followers.push([twin, mirrorTransform(circuit.components.get(ref).transform, axis)]);
  }
  if (followers.length) {
    const refs = followers.map(([twin]) => twin);
    const beforeComponents = captureComponentTerminalPositions(circuit, refs);
    const beforeTerminals = captureNetTerminalPositions(circuit, refs);
    const saved = new Map(refs.map((ref) => [ref, { ...circuit.components.get(ref).transform }]));
    for (const [twin, t] of followers) circuit.components.get(twin).transform = t;
    circuit.invalidateRoutingCache();
    if (rerouteTouchedNets(circuit, refs, null, { fresh: true, beforeTerminals, terminalMoves: componentTerminalMoves(circuit, refs, beforeComponents) }) !== null) {
      // The twins cannot follow: they stay where they were.
      for (const [ref, t] of saved) circuit.components.get(ref).transform = t;
      circuit.invalidateRoutingCache();
    } else {
      done.moved.push(...refs);
      for (const ref of refs) changed.add(ref);
    }
  }
  // Parts added get twins.
  const now = twins(circuit, axis);
  const added = [...circuit.components.values()].filter((c) => c.type !== 'solder' && !before.components.has(c.refdes));
  for (const c of added) {
    if (now.has(c.refdes)) continue;
    const t = mirrorTransform(c.transform, axis);
    const twin = circuit.addComponent(c.type, {
      x: t.x, y: t.y, rotation: t.rotation, mirrorX: t.mirrorX, mirrorY: t.mirrorY,
      ...(c.value !== undefined ? { value: c.value } : {}),
      ...(c.size ? { size: { ...c.size } } : {}),
      ...(c.blockSize ? { blockSize: { ...c.blockSize } } : {}),
    });
    now.set(c.refdes, twin.refdes);
    now.set(twin.refdes, c.refdes);
    done.added.push(twin.refdes);
  }
  // Wires drawn are drawn again, mirrored. The wires of parts that moved
  // were rerouted, not drawn, and an edit that removed parts drew none
  // (what is left of their wires is laid again).
  const removedAny = [...before.components.values()].some((c) => c.type !== 'solder' && !circuit.components.has(c.refdes));
  const skip = new Set(removedAny ? circuit.nets.keys() : []);
  for (const ref of changed) {
    for (const net of circuit.nets.values()) if (net.terminals.some((t) => t.comp === ref)) skip.add(net.id);
  }
  const present = () => wireSteps(circuit);
  for (const run of drawnRuns(before, circuit, skip)) {
    const path = corners(run);
    const image = path.map((p) => mirrorPoint(p, axis));
    const steps = present();
    const imageSteps = image.slice(1).map((b, i) => [key(image[i]), key(b)].sort().join('-'));
    // Its own mirror image (across the axis), or there already.
    const own = new Set(path.slice(1).map((b, i) => [key(path[i]), key(b)].sort().join('-')));
    if (imageSteps.every((s) => own.has(s))) continue;
    if (imageSteps.every((s) => steps.has(s))) continue;
    const [start, ...rest] = image;
    const end = rest.pop();
    try {
      const pin = pinAt(circuit, start);
      const otherPin = pinAt(circuit, end);
      if (pin) circuit.wireTo(pin, end, rest);
      else if (otherPin) circuit.wireTo(otherPin, start, [...rest].reverse());
      else circuit.wirePointTo(start, end, rest);
      done.wires += 1;
    } catch {
      // A mirrored wire that cannot be drawn is left to the hand.
    }
  }
  if (done.added.length || done.moved.length || done.removed.length || done.wires) {
    circuit.reconnectCoincidentNets();
    circuit.syncJunctionSolders();
  }
  return done;
}
