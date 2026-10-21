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
 * else a new one. A new one is packed with the figures packing placed
 * before (placeFigure): the layout of them all whose drawing is smallest,
 * clear of the circuit and of every figure, tables and equations by
 * preference right of the circuit, the timing diagram, plots and models
 * under it. A figure moved by hand stays where it was put; an updated one
 * keeps its place. Figures drawn before they
 * had an identity are known by what they carry: a box with a plot or a
 * parts table, the timing diagram's labels.
 */

import { GRID, ceilGrid, floorGrid } from './grid.js';

export const FIGURE_KINDS = Object.freeze(['plot', 'equations', 'noise', 'model', 'timing', 'table']);

/** Where each kind would rather go: right of the circuit, or under it. */
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
  // Where packing put it: a figure still there is packing's to move.
  const placed = Number.isFinite(value.placed?.x) && Number.isFinite(value.placed?.y) ? { x: value.placed.x, y: value.placed.y } : null;
  return { id, kind, source, ...(key ? { key } : {}), ...(placed ? { placed } : {}) };
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
  // A figure's own wires (a model's), and their names, are not the circuit.
  const theirs = new Set();
  for (const net of circuit.nets.values()) {
    if (net.terminals.length && !net.terminals.some((terminal) => refs.has(terminal.comp))) { theirs.add(net.id); continue; }
    const points = net.pathPoints();
    if (points.length) rects.push(rectOf(points));
  }
  for (const label of circuit.labels.values()) {
    if (labels.has(label) || (label.owner && !refs.has(label.owner)) || theirs.has(label.netId)) continue;
    rects.push(label.inkRect());
  }
  return union(rects);
}

/** The zone a kind of figure goes in: 'right' or 'below'. */
export const figureZone = (kind) => ZONES[kind] || 'below';

/** Two rects closer than `gap` on both axes. */
const crowds = (a, b, gap) => a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

/** A figure's top-left corner as drawn. */
function cornerOf(circuit, figure) {
  const box = figureBounds(circuit, figure);
  return box && { x: box.x, y: box.y };
}

/** Where a figure stands, by a point a label measured again never moves:
 *  its first part's origin, its box's corner, else its label's corner. */
function standOf(circuit, figure) {
  const [part] = [...figure.components].sort((a, b) => a.refdes.localeCompare(b.refdes));
  if (part) return { x: part.transform.x, y: part.transform.y };
  const shape = figure.labels.find((label) => label.kind !== 'label');
  if (shape) return { x: shape.anchor.x, y: shape.anchor.y };
  return cornerOf(circuit, figure);
}

/** Whether packing placed a figure where it is: moved by hand, it stays. */
export function packed(circuit, figure) {
  const at = figure.placed;
  const stand = standOf(circuit, figure);
  return !!at && !!stand && at.x === stand.x && at.y === stand.y;
}

/** Remember where figure `id` is now as packing's place for it. */
export function settlePlaced(circuit, id) {
  const figure = listFigures(circuit).find((candidate) => candidate.id === id);
  const corner = figure && standOf(circuit, figure);
  if (!corner) return;
  for (const member of [...figure.labels, ...figure.components]) {
    if (member.figure?.id === id) member.figure = { ...member.figure, placed: corner };
  }
}

/** The kind's own place, for a figure `w` wide: a table right of the
 *  circuit at its top, the timing diagram centered under it, the rest under
 *  it at its left edge. */
function anchorFor(kind, base, w) {
  if (figureZone(kind) === 'right') return { x: ceilGrid(base.x + base.w) + CLEARANCE, y: floorGrid(base.y) };
  const x = kind === 'timing' ? Math.max(floorGrid(base.x), Math.round((base.x + base.w / 2 - w / 2) / GRID) * GRID) : floorGrid(base.x);
  return { x, y: ceilGrid(base.y + base.h) + CLEARANCE };
}

/**
 * The best spot for one figure among `rects` (figures already placed) and
 * the circuit `core`: clear of the circuit by CLEARANCE and of each figure
 * by GAP, never left of or above the circuit; of the kind's own place and
 * every edge of what is there, the cheapest (layoutCost).
 */
function bestSpot(core, rects, kind, size) {
  const w = Math.max(GRID, size.w || 0);
  const h = Math.max(GRID, size.h || 0);
  const base = core || rects[0] || { x: 0, y: 0, w: 0, h: 0 };
  const anchor = anchorFor(kind, base, w);
  const xs = new Set([anchor.x]);
  const ys = new Set([anchor.y]);
  for (const r of rects) {
    xs.add(floorGrid(r.x)).add(ceilGrid(r.x + r.w) + GAP);
    ys.add(floorGrid(r.y)).add(ceilGrid(r.y + r.h) + GAP);
  }
  if (core) {
    xs.add(floorGrid(core.x)).add(ceilGrid(core.x + core.w) + CLEARANCE);
    ys.add(floorGrid(core.y)).add(ceilGrid(core.y + core.h) + CLEARANCE);
  }
  const before = union([...(core ? [core] : []), ...rects]);
  const free = (spot) => (!core || !crowds(spot, core, CLEARANCE - 1)) && rects.every((r) => !crowds(spot, r, GAP - 1));
  let best = null;
  for (const x of xs) {
    if (core && x < floorGrid(core.x)) continue;
    for (const y of ys) {
      if (core && y < floorGrid(core.y)) continue;
      const spot = { x, y, w, h };
      if (!free(spot)) continue;
      const after = before ? union([before, spot]) : spot;
      const cost = layoutCost(after, Math.abs(x - anchor.x) + Math.abs(y - anchor.y), base);
      if (!best || cost < best.cost) best = { ...spot, cost };
    }
  }
  // Below everything there is always room.
  return best || { x: anchor.x, y: before ? ceilGrid(before.y + before.h) + GAP : anchor.y, w, h };
}

/**
 * What a layout costs: the drawing's area, a little more for each figure
 * away from its kind's own place -- a third more for one a circuit's size
 * away -- so a table goes right of the circuit and a model under it unless
 * elsewhere the drawing is clearly smaller.
 */
function layoutCost(box, distance, base) {
  return box.w * box.h * (1 + (0.3 * distance) / Math.max(4 * GRID, base.w + base.h));
}

/** The orders to try packing `items` in: every one for a few, else some
 *  that tend to pack well (the kinds' own order, largest first, tallest,
 *  widest). */
function packingOrders(items) {
  if (items.length <= 5) {
    const all = [];
    const permute = (rest, done) => {
      if (!rest.length) { all.push(done); return; }
      rest.forEach((item, index) => permute([...rest.slice(0, index), ...rest.slice(index + 1)], [...done, item]));
    };
    permute(items, []);
    return all;
  }
  const by = (score) => [...items].sort((a, b) => score(b) - score(a));
  return [
    [...items].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind)),
    by((item) => item.size.w * item.size.h), by((item) => item.size.h), by((item) => item.size.w),
  ];
}

/**
 * Pack figures as one: the circuit and the figures moved by hand (or given
 * no place by packing) stay; the figures packing placed, and a new one
 * (`kind`, `size`), are packed again around them, trying several orders,
 * keeping the layout whose drawing is smallest. So what is placed first
 * never leaves the next nowhere good to go. The figures packing moves are
 * moved here; returns the new one's top-left corner (or null without one).
 * `except` names a figure to leave out (the new one, drawn already);
 * `all` packs every figure, those moved by hand too (Arrange).
 */
export function placeFigure(circuit, kind = null, { size = { w: 0, h: 0 }, except = null, all = false } = {}) {
  const figures = listFigures(circuit).filter((figure) => figure.id !== except);
  const core = coreBounds(circuit, listFigures(circuit));
  const movable = figures.filter((figure) => all || packed(circuit, figure));
  const fixed = figures.filter((figure) => !movable.includes(figure)).map((figure) => figureBounds(circuit, figure)).filter(Boolean);
  const items = movable.map((figure) => ({ id: figure.id, kind: figure.kind, figure, size: figureBounds(circuit, figure) })).filter((item) => item.size);
  if (kind) items.push({ id: null, kind, size });
  if (!items.length) return null;
  let best = null;
  for (const order of packingOrders(items)) {
    const rects = [...fixed];
    const spots = new Map();
    let distance = 0;
    for (const item of order) {
      const spot = bestSpot(core, rects, item.kind, item.size);
      rects.push(spot);
      spots.set(item, spot);
      const anchor = anchorFor(item.kind, core || spot, spot.w);
      distance += Math.abs(spot.x - anchor.x) + Math.abs(spot.y - anchor.y);
    }
    const box = union([...(core ? [core] : []), ...rects]);
    const cost = layoutCost(box, distance, core || box);
    if (!best || cost < best.cost) best = { cost, spots };
  }
  let corner = null;
  for (const [item, spot] of best.spots) {
    if (!item.figure) { corner = { x: spot.x, y: spot.y }; continue; }
    const box = figureBounds(circuit, item.figure);
    moveFigure(circuit, item.figure, spot.x - box.x, spot.y - box.y);
    settlePlaced(circuit, item.id);
  }
  return corner;
}

/** The figures packing placed, packed again (a figure grew or went). */
export const repackFigures = (circuit, { except = null } = {}) => placeFigure(circuit, null, { except });

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
 * Every figure packed again as if placed now -- those moved by hand too --
 * as one: the layout of them all whose drawing is smallest (placeFigure).
 * Returns how many moved.
 */
export function arrangeFigures(circuit) {
  const before = new Map(listFigures(circuit).map((figure) => [figure.id, cornerOf(circuit, figure)]));
  placeFigure(circuit, null, { all: true });
  return listFigures(circuit).filter((figure) => {
    const was = before.get(figure.id);
    const now = cornerOf(circuit, figure);
    return was && now && (was.x !== now.x || was.y !== now.y);
  }).length;
}
