/**
 * Tidying: the safe repairs Design Check can offer for an issue, and the same
 * repairs applied to a selection (tidySelection). A net is re-laid out fresh
 * from its terminals, an off-grid part snaps back, and a label that sits on a
 * part's strokes or another label moves to the nearest clear spot -- a net
 * label along its own wire, a part's label near its part. Nothing here
 * changes connectivity.
 */

import { GRID, snap } from './grid.js';
import { applyTransform, rectsOverlap } from './geometry.js';
import { segThroughInterior } from './router.js';
import { hiddenSupplyBarLabels } from './supply-bars.js';

const SHAPES = new Set(['arrow', 'box', 'line']);

/** Labels whose text can collide: not shapes, not hidden bar labels. */
function textLabels(circuit) {
  const hidden = hiddenSupplyBarLabels(circuit);
  return [...circuit.labels.values()].filter((label) => !SHAPES.has(label.kind) && !hidden.has(label.id));
}

/** 0: clear; 1: only crosses a wire; 2: on a part's strokes or another label. */
function labelCrowding(circuit, label, others) {
  const rect = label.inkRect();
  for (const component of circuit.components.values()) {
    if (component.type !== 'solder' && component.inkTouches(rect)) return 2;
  }
  if (others.some((other) => other !== label && rectsOverlap(rect, other.inkRect()))) return 2;
  for (const net of circuit.nets.values()) {
    if (net.id === label.netId) continue;
    for (const path of net.paths()) {
      for (let i = 1; i < path.length; i++) if (segThroughInterior(path[i - 1], path[i], rect)) return 1;
    }
  }
  return 0;
}

function labelPlace(label) {
  return { offset: label.offset && { ...label.offset }, anchor: label.anchor && { ...label.anchor }, netSide: label.netSide };
}

function restorePlace(circuit, label, place) {
  label.offset = place.offset && { ...place.offset };
  label.anchor = place.anchor && { ...place.anchor };
  label.netSide = place.netSide;
  circuit.invalidateRoutingCache();
}

/** Where a label may go, nearest first: along its own wire (both sides) for
 *  a net label; around its part's own label slot for a part's label, so it
 *  never wanders off to label a neighbour; around where it is otherwise. */
function labelCandidates(circuit, label, reach) {
  const owner = label.owner && circuit.components.get(label.owner);
  const slot = owner?.def?.labelOffset;
  const here = slot ? applyTransform(owner.transform, slot.x, slot.y) : label.anchorWorld();
  const distance = (p) => Math.hypot(p.x - here.x, p.y - here.y);
  const out = [];
  if (label.netId) {
    const net = circuit.nets.get(label.netId);
    for (const path of net?.paths() || []) {
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1];
        const b = path[i];
        const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) / GRID;
        const sides = a.y === b.y ? ['above', 'below'] : a.x === b.x ? ['left', 'right'] : [];
        for (let k = 0; k <= steps; k++) {
          const point = { x: snap(a.x + ((b.x - a.x) * k) / steps), y: snap(a.y + ((b.y - a.y) * k) / steps) };
          if (distance(point) > reach * GRID) continue;
          for (const side of sides) out.push({ point, side });
        }
      }
    }
  } else {
    for (let dx = -reach; dx <= reach; dx++) {
      for (let dy = -reach; dy <= reach; dy++) out.push({ point: { x: snap(here.x) + dx * GRID, y: snap(here.y) + dy * GRID } });
    }
  }
  return out.sort((p, q) => distance(p.point) - distance(q.point));
}

/**
 * Move `label` to the nearest spot where its text touches no part and no
 * other label, preferring one that crosses no wire either. Returns whether it
 * moved; a label already clear stays put.
 */
export function placeLabelClear(circuit, label, { reach = null } = {}) {
  if (!label || SHAPES.has(label.kind) || label.role || label.parent) return false;
  const others = textLabels(circuit);
  const start = labelCrowding(circuit, label, others);
  if (start === 0) return false;
  const original = labelPlace(label);
  const limit = reach ?? (label.netId ? 8 : 4);
  let best = null;
  for (const candidate of labelCandidates(circuit, label, limit)) {
    try {
      if (candidate.side) label.netSide = candidate.side;
      label.moveTo(candidate.point.x, candidate.point.y);
    } catch {
      restorePlace(circuit, label, original);
      continue;
    }
    const crowding = labelCrowding(circuit, label, others);
    if (crowding < start && (!best || crowding < best.crowding)) best = { ...candidate, crowding, place: labelPlace(label) };
    restorePlace(circuit, label, original);
    if (best?.crowding === 0) break;
  }
  if (!best) return false;
  restorePlace(circuit, label, best.place);
  return true;
}

/** Lay managed `nets` out fresh from their terminals; a net that cannot be
 *  routed keeps its drawing. Protected (fixed) nets are left alone. Returns
 *  the ids rerouted. */
export function rerouteFresh(circuit, netIds) {
  const done = [];
  for (const id of netIds) {
    const net = circuit.nets.get(id);
    if (!net || net.routingMode === 'fixed' || net.terminals.length < 2) continue;
    const before = JSON.stringify(net.paths());
    if (circuit.rerouteNet(net, 'refresh') !== false && JSON.stringify(net.paths()) !== before) done.push(id);
  }
  if (done.length) circuit.syncJunctionSolders();
  return done;
}

/** Move a part whose origin is off the grid to the nearest grid point, its
 *  nets following. Returns whether it moved. */
export function snapComponentToGrid(circuit, refdes) {
  const component = circuit.components.get(refdes);
  if (!component) return false;
  const { x, y } = component.transform;
  if (snap(x) === x && snap(y) === y) return false;
  circuit.moveComponent(refdes, snap(x), snap(y));
  const nets = [...circuit.nets.values()].filter((net) => net.terminals.some((t) => t.comp === refdes)).map((net) => net.id);
  rerouteFresh(circuit, nets);
  return true;
}

function reroutable(circuit, ids) {
  return ids.filter((id) => {
    const net = circuit.nets.get(id);
    return net && net.routingMode !== 'fixed' && net.terminals.length >= 2;
  });
}

/**
 * The safe repair for one Design Check issue (an entry of evaluate().issues),
 * or null when fixing it needs a decision (a dangling pin, two parts on top
 * of each other). `{ label, apply(circuit) }`; apply returns whether it changed
 * anything.
 */
export function issueFix(circuit, issue) {
  switch (issue?.kind) {
    case 'wire-through-body':
    case 'managed-diagonal': {
      const ids = reroutable(circuit, [issue.netId]);
      return ids.length ? { label: 'Reroute', apply: (c) => rerouteFresh(c, ids).length > 0 } : null;
    }
    case 'cross-net-overlap': {
      // Re-lay the second net first: the one that ran onto the other.
      const ids = reroutable(circuit, [...(issue.netIds || [])].reverse());
      return ids.length ? { label: 'Reroute', apply: (c) => rerouteFresh(c, ids.slice(0, 1)).length > 0 || rerouteFresh(c, ids.slice(1)).length > 0 } : null;
    }
    case 'grid-violation':
      return issue.location === 'origin' && circuit.components.has(issue.refs?.[0])
        ? { label: 'Snap to grid', apply: (c) => snapComponentToGrid(c, issue.refs[0]) }
        : null;
    case 'label-component-overlap':
    case 'label-overlap': {
      const ids = issue.labelId ? [issue.labelId] : [...(issue.labelIds || [])].reverse();
      return ids.some((id) => circuit.labels.has(id))
        ? { label: 'Move label', apply: (c) => ids.some((id) => placeLabelClear(c, c.labels.get(id))) }
        : null;
    }
    default:
      return null;
  }
}

/** Apply every safe repair, re-checking after each (one repair can resolve
 *  or move others). Returns how many were applied. `evaluate` is passed in
 *  to keep this module free of the command language. */
export function fixAllIssues(circuit, evaluate) {
  let fixed = 0;
  const tried = new Set();
  for (let guard = 0; guard < 200; guard++) {
    const next = evaluate(circuit).issues
      .map((issue) => ({ issue, fix: issueFix(circuit, issue) }))
      .find(({ issue, fix }) => fix && !tried.has(issue.message));
    if (!next) break;
    // A repair that changes nothing is not offered again this round.
    if (next.fix.apply(circuit)) fixed++;
    else tried.add(next.issue.message);
  }
  return fixed;
}

/**
 * Tidy a selection in one go: lay its nets (and the nets its parts touch) out
 * fresh, then move any of its labels (the parts' own, the nets' labels, and
 * selected ones) that crowd a part or another label. Returns what changed.
 */
export function tidySelection(circuit, { refs = [], netIds = [], labelIds = [] } = {}) {
  const nets = new Set(netIds);
  for (const net of circuit.nets.values()) {
    if (net.terminals.some((t) => refs.includes(t.comp))) nets.add(net.id);
  }
  const rerouted = rerouteFresh(circuit, [...nets]);
  const labels = new Set(labelIds);
  for (const label of circuit.labels.values()) {
    if ((label.owner && refs.includes(label.owner)) || (label.netId && nets.has(label.netId))) labels.add(label.id);
  }
  const moved = [...labels].filter((id) => placeLabelClear(circuit, circuit.labels.get(id)));
  return { rerouted, moved };
}
