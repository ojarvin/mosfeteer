/**
 * Figures: what the tools put on the drawing -- an analysis's plots, its
 * equations as a table, the kT/C noise table, the small-signal model, the
 * timing diagram, the parts table. Each is one object however many labels
 * and parts draw it, known by its identity (`figure`, saved on every
 * member): { id, kind, source, key }. `kind` is what it is, `source` the
 * tool that made it (small-signal, signal-flow, switched-cap, sizing,
 * timing), and `key` what tells two of one tool's apart (a plot's quantity).
 *
 * A tool annotating again updates the figure it made rather than adding
 * one (chooseFigure): the selected one of that identity, else the only one,
 * else a new one, placed by its zone (figureSpot) -- tables and equations in
 * a column right of the circuit, the timing diagram, plots and models
 * below it. An updated figure keeps its place. Figures drawn before they
 * had an identity are known by what they carry: a box with a plot or a
 * parts table, the timing diagram's labels.
 */

import { GRID, ceilGrid, floorGrid } from './grid.js';

export const FIGURE_KINDS = Object.freeze(['plot', 'equations', 'noise', 'model', 'timing', 'table']);

/** Where each kind goes when first placed. */
const ZONES = { table: 'right', equations: 'right', noise: 'right', timing: 'below', plot: 'below', model: 'below' };

/** In a zone, figures go in this order (arrangeFigures). */
const ORDER = ['table', 'equations', 'noise', 'timing', 'model', 'plot'];

/** The gap from the circuit to its first figure, and between figures. */
const CLEARANCE = 3 * GRID;
const GAP = 2 * GRID;

const text = (value, max = 120) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null);

/** A figure identity as saved; null when unusable. */
export function normalizeFigure(value) {
  if (!value || typeof value !== 'object') return null;
  const id = text(value.id, 60);
  const kind = FIGURE_KINDS.includes(value.kind) ? value.kind : null;
  const source = text(value.source);
  if (!id || !kind || !source) return null;
  const key = text(value.key, 400);
  return { id, kind, source, ...(key ? { key } : {}) };
}

/** A figure id not used in `circuit` yet. */
export function newFigureId(circuit) {
  const used = new Set(listFigures(circuit).map((figure) => figure.id));
  let n = used.size + 1;
  while (used.has(`F${n}`)) n += 1;
  return `F${n}`;
}

/** A label's figure identity: its own, else what it carries (a plot or a
 *  parts table box, a timing diagram's label). */
function labelFigure(label) {
  if (label.figure) return label.figure;
  // A plot from before figures: any tool's that makes its kind.
  if (label.plot) return { id: label.id, kind: 'plot', source: null, key: plotKey(label.plot) };
  if (label.table) return { id: label.id, kind: 'table', source: 'sizing', ...(label.table.parts?.length ? { key: [...label.table.parts].sort().join(',') } : {}) };
  if (label.timing) return { id: 'timing', kind: 'timing', source: 'timing' };
  return null;
}

/** What tells two plots of one tool apart: their kind, quantity and role. */
export function plotKey(plot) {
  return [plot?.kind || '', plot?.quantity || '', plot?.role || ''].join(':');
}

/**
 * Every figure on the drawing: [{ id, kind, source, key, labels: [label],
 * components: [component] }]. A label belonging to another (a plot's
 * legend, `parent`) is in its figure.
 */
export function listFigures(circuit) {
  const figures = new Map();
  const add = (figure, member, list) => {
    if (!figures.has(figure.id)) figures.set(figure.id, { ...figure, labels: [], components: [] });
    figures.get(figure.id)[list].push(member);
  };
  for (const label of circuit.labels.values()) {
    const parent = label.parent ? circuit.labels.get(label.parent) : null;
    const figure = labelFigure(label) || (parent ? labelFigure(parent) : null);
    if (figure) add(figure, label, 'labels');
  }
  for (const component of circuit.components.values()) if (component.figure) add(component.figure, component, 'components');
  return [...figures.values()];
}

const matches = (figure, { kind, source, key }) => figure.kind === kind && (figure.source === null || figure.source === source)
  && (key === undefined || (figure.key || null) === (key || null));

/**
 * The figure an annotation of this identity updates: the selected one
 * (`selected`: label ids and part names), else the only one, else null --
 * a new one is placed.
 */
export function chooseFigure(circuit, identity, selected = []) {
  const candidates = listFigures(circuit).filter((figure) => matches(figure, identity));
  const picked = new Set(selected);
  const chosen = candidates.find((figure) => figure.labels.some((label) => picked.has(label.id) || (label.parent && picked.has(label.parent)))
    || figure.components.some((component) => picked.has(component.refdes)));
  return chosen || (candidates.length === 1 ? candidates[0] : null);
}

/** A figure's members' extent, { x, y, w, h }. */
export function figureBounds(circuit, figure) {
  const rects = [...figure.labels.map((label) => label.bbox()), ...figure.components.map((component) => component.bboxWorld())];
  const refs = new Set(figure.components.map((component) => component.refdes));
  if (!refs.size) return union(rects);
  // Its parts' own labels and its wires' labels too.
  const nets = new Set();
  for (const net of circuit.nets.values()) {
    if (!net.terminals.length || !net.terminals.every((terminal) => refs.has(terminal.comp))) continue;
    nets.add(net.id);
    const points = net.pathPoints();
    if (points.length) rects.push(rectOf(points));
  }
  for (const label of circuit.labels.values()) if (refs.has(label.owner) || nets.has(label.netId)) rects.push(label.bbox());
  return union(rects);
}

function rectOf(points) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

function union(rects) {
  if (!rects.length) return null;
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  return { x, y, w: Math.max(...rects.map((r) => r.x + r.w)) - x, h: Math.max(...rects.map((r) => r.y + r.h)) - y };
}

/** The circuit itself: everything drawn that is in no figure, nor a part
 *  only drawn (a model placed before figures had an identity). */
export function coreBounds(circuit, figures = listFigures(circuit)) {
  const labels = new Set(figures.flatMap((figure) => figure.labels));
  const parts = new Set(figures.flatMap((figure) => figure.components));
  const rects = [];
  for (const component of circuit.components.values()) {
    if (!parts.has(component) && !component.drawingOnly && component.type !== 'solder') rects.push(component.inkRectWorld());
  }
  const refs = new Set([...circuit.components.values()].filter((c) => !parts.has(c) && !c.drawingOnly).map((c) => c.refdes));
  for (const net of circuit.nets.values()) {
    if (net.terminals.length && !net.terminals.some((terminal) => refs.has(terminal.comp))) continue;
    const points = net.pathPoints();
    if (points.length) rects.push(rectOf(points));
  }
  for (const label of circuit.labels.values()) {
    if (labels.has(label) || (label.owner && !refs.has(label.owner))) continue;
    rects.push(label.inkRect());
  }
  return union(rects);
}

/** The zone a kind of figure goes in: 'right' or 'below'. */
export const figureZone = (kind) => ZONES[kind] || 'below';

/**
 * Where a new figure `size` ({ w, h }) of `kind` goes, its top-left corner:
 * right of the circuit, level with its top and under the figures already
 * there; or below the circuit and the figures already below it, at its
 * left edge. `figures` are those to keep clear of (all, by default).
 */
export function figureSpot(circuit, kind, { figures = listFigures(circuit) } = {}) {
  const core = coreBounds(circuit, listFigures(circuit)) || { x: 0, y: 0, w: 0, h: 0 };
  const zone = figureZone(kind);
  const placed = figures.filter((figure) => figureZone(figure.kind) === zone).map((figure) => figureBounds(circuit, figure)).filter(Boolean);
  if (zone === 'right') {
    const x = ceilGrid(core.x + core.w) + CLEARANCE;
    const column = placed.filter((r) => r.x + r.w > core.x + core.w);
    const y = column.length ? ceilGrid(Math.max(...column.map((r) => r.y + r.h))) + GAP : floorGrid(core.y);
    return { x, y };
  }
  const below = placed.filter((r) => r.y + r.h > core.y + core.h);
  const y = below.length ? ceilGrid(Math.max(...below.map((r) => r.y + r.h))) + GAP : ceilGrid(core.y + core.h) + CLEARANCE;
  return { x: floorGrid(core.x), y };
}

/** Take a figure off the drawing: its labels, its parts, and the wires
 *  between its parts alone. */
export function removeFigure(circuit, figure) {
  const refs = new Set(figure.components.map((component) => component.refdes));
  for (const net of [...circuit.nets.values()]) {
    if (net.terminals.length && net.terminals.every((terminal) => refs.has(terminal.comp))) circuit.removeNet(net);
  }
  for (const refdes of refs) if (circuit.components.has(refdes)) circuit.removeComponent(refdes);
  for (const label of figure.labels) if (circuit.labels.has(label.id)) circuit.removeLabel(label.id);
}

/** Move a figure's every member by (dx, dy): labels, parts, and the wires
 *  between its parts alone. */
export function moveFigure(circuit, figure, dx, dy) {
  if (!dx && !dy) return;
  const refs = new Set(figure.components.map((component) => component.refdes));
  for (const component of figure.components) {
    component.transform = { ...component.transform, x: component.transform.x + dx, y: component.transform.y + dy };
  }
  const shift = (point) => ({ ...point, x: point.x + dx, y: point.y + dy });
  for (const net of circuit.nets.values()) {
    if (!net.terminals.length || !net.terminals.every((terminal) => refs.has(terminal.comp))) continue;
    if (net.route) net.route = net.route.map(shift);
    if (net.branches) net.branches = net.branches.map((path) => path.map(shift));
    net.junctions = net.junctions.map(shift);
    for (const label of circuit.labels.values()) if (label.netId === net.id) label.anchor = shift(label.anchor);
  }
  // A shape moves the labels inside it (a plot's legend) with it.
  const shapes = new Set(figure.labels.filter((label) => label.kind !== 'label').map((label) => label.id));
  for (const label of figure.labels) {
    if (label.owner || label.netId || shapes.has(label.parent)) continue;
    if (label.kind === 'label') label.anchor = shift(label.anchor);
    else label.moveTo(label.anchor.x + dx, label.anchor.y + dy);
  }
  if (refs.size) {
    circuit.invalidateRoutingCache();
    circuit.syncJunctionSolders();
  }
}

/**
 * Every figure put where it would go if placed now, in order: the right
 * column (parts tables, equation tables, noise tables) and the rows below
 * (the timing diagram, models, plots), each kind in drawing order. Returns
 * how many moved.
 */
export function arrangeFigures(circuit) {
  const figures = listFigures(circuit).sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  const done = [];
  let moved = 0;
  for (const figure of figures) {
    const box = figureBounds(circuit, figure);
    if (!box) continue;
    const spot = figureSpot(circuit, figure.kind, { figures: done });
    // A timing diagram's waves are centered on the circuit, its names left of them.
    const x = figure.kind === 'timing' ? box.x + snapCenter(circuit, box) : spot.x;
    const dx = x - box.x;
    const dy = spot.y - box.y;
    if (dx || dy) {
      moveFigure(circuit, figure, dx, dy);
      moved += 1;
    }
    done.push(figure);
  }
  return moved;
}

/** How far a figure moves so it is centered under the circuit, on the grid. */
function snapCenter(circuit, box) {
  const core = coreBounds(circuit) || box;
  return Math.round((core.x + core.w / 2 - (box.x + box.w / 2)) / GRID) * GRID;
}
