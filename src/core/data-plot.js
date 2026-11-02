/**
 * Data plots on the drawing: a plot box (`plot.kind` 'data', model.js
 * normalizeDataPlot) built from a text file's columns (csv-data.js), its
 * legend a column of labels beside it as the analysis plots have. The file
 * is read once; the design keeps the traces, never the file. Its axes, its
 * zoom, and its traces are edited here, for the commands and the plot's
 * settings window alike.
 */

import { TRACE_COLORS } from './analysis/signal-flow.js';
import { newFigureId, placeFigure, settlePlaced } from './figures.js';
import { GRID, snap } from './grid.js';
import { MAX_PLOT_EXTRA, PLOT_LEGEND_ROLE, PLOT_LEGEND_SAMPLE_ROOM, normalizePlot } from './model.js';
import { COLOR_PALETTE, colorToken } from './style.js';
import { MAX_DATA_TRACES, readTable, tableTraces } from './csv-data.js';

/** A new data plot's box, in cells. */
const BOX = { w: 18, h: 11 };

/** The plot `table`'s columns `y` against `x` make (null when they make no
 *  trace of two points), its axes named after the columns: one trace's own
 *  name on y, or none for several, which the legend names. */
export function dataPlot(table, { x = table.x, y = table.y, file = '', scale = table.scale } = {}) {
  const traces = tableTraces(table, x, y).map((trace, i) => ({ ...trace, color: TRACE_COLORS[i % TRACE_COLORS.length] }));
  return normalizePlot({
    kind: 'data',
    file,
    x: { label: x === null || x === undefined ? 'Row' : table.names[x], scale: scale?.x || 'linear' },
    y: { label: traces.length === 1 ? traces[0].label : '', scale: scale?.y || 'linear' },
    traces,
  });
}

/** A column named by its 1-based number or its name (any case), as an
 *  index; 'row' is the row number (null). */
export function columnIndex(table, name) {
  const text = String(name).trim();
  if (/^row$/i.test(text)) return null;
  if (/^\d+$/.test(text)) {
    const index = Number(text) - 1;
    if (index >= 0 && index < table.names.length) return index;
  }
  const index = table.names.findIndex((n) => n.toLowerCase() === text.toLowerCase());
  if (index >= 0) return index;
  throw new Error(`no column "${text}" (columns: ${table.names.map((n, i) => `${i + 1} ${n}`).join(', ')})`);
}

/** Read `text` as `options` say (csv-data.js readTable, columns by number
 *  or name) and make its plot. Throws when there is nothing to plot. */
export function dataPlotFromText(text, { file = '', x, y, xscale, yscale, ...read } = {}) {
  const table = readTable(text, read);
  const xi = x === undefined ? table.x : columnIndex(table, x);
  const yi = y === undefined ? table.y.filter((c) => c !== xi) : String(y).split(',').map((name) => columnIndex(table, name));
  if (!yi.length) throw new Error('no column of numbers to plot');
  if (yi.length > MAX_DATA_TRACES) throw new Error(`at most ${MAX_DATA_TRACES} traces`);
  const plot = dataPlot(table, { x: xi, y: yi, file, scale: { x: xscale || table.scale.x, y: yscale || table.scale.y } });
  if (!plot) throw new Error('the columns have no two rows of numbers to plot');
  return plot;
}

/**
 * Put `plot` on the drawing: a box packed clear of what is there
 * (figures.js) or at `at` (its top-left corner), drawn in black as a new
 * plot is, its legend beside it. Returns `{ box, legend }`; the browser
 * stacks the legend again once it has measured it.
 */
export function placeDataPlot(circuit, plot, { at = null } = {}) {
  const figure = { kind: 'plot', source: 'data', key: 'data', id: newFigureId(circuit) };
  const spot = at || placeFigure(circuit, 'plot', { size: { w: (BOX.w + 6) * GRID, h: BOX.h * GRID } });
  const x = snap(spot.x);
  const y = snap(spot.y);
  const box = circuit.addAnnotation('box', { x, y, end: { x: x + BOX.w * GRID, y: y + BOX.h * GRID }, plot, style: { lineStyle: 'solid', blackTraces: true }, figure });
  if (!at) settlePlaced(circuit, figure.id);
  const legend = writeLegend(circuit, box, box.plot.traces);
  return { box, legend };
}

/** A legend for `traces` beside `box`, one label under another, past the
 *  room the line samples take in black. */
function writeLegend(circuit, box, traces, at = null) {
  const frame = box.bbox();
  const left = at?.x ?? frame.x + frame.w + PLOT_LEGEND_SAMPLE_ROOM;
  let top = at?.y ?? frame.y;
  return traces.map((trace) => {
    const label = circuit.addLabel({ text: trace.label || ' ', parent: box.id, role: PLOT_LEGEND_ROLE, align: 'left', x: 0, y: 0, style: { color: trace.color } });
    const size = label.bbox();
    label.moveTo(snap(left + size.w / 2), snap(top + size.h / 2));
    top = label.bbox().y + label.bbox().h;
    return label;
  });
}

function dataPlotOf(box) {
  if (box?.plot?.kind !== 'data') throw new Error(`"${box?.id}" is not a data plot`);
  return box.plot;
}

/** Name an axis ('x' or 'y') of a data plot, or set its scale ('linear',
 *  'log'). A zoom the new scale cannot show (at or under zero on log) goes.
 *  Returns whether anything changed. */
export function setDataPlotAxis(box, axis, { label, scale } = {}) {
  const plot = dataPlotOf(box);
  if (axis !== 'x' && axis !== 'y') throw new Error('the axis is x or y');
  if (scale !== undefined && scale !== 'log' && scale !== 'linear') throw new Error('the scale is log or linear');
  const next = normalizePlot({ ...plot, [axis]: { ...plot[axis], ...(label !== undefined ? { label } : {}), ...(scale ? { scale } : {}) } });
  if (JSON.stringify(next) === JSON.stringify(plot)) return false;
  box.plot = next;
  return true;
}

/** Zoom a data plot's axis to [low, high] in its data's units, or with
 *  null fit it to the data. Returns whether it changed. */
export function setDataPlotView(box, axis, range) {
  const plot = dataPlotOf(box);
  if (axis !== 'x' && axis !== 'y') throw new Error('the axis is x or y');
  if (range && !(range.length === 2 && range.every(Number.isFinite) && range[0] < range[1])) throw new Error('a range is LOW HIGH, low under high');
  if (range && plot[axis].scale === 'log' && range[0] <= 0) throw new Error('a log axis shows only positive values');
  const view = { ...(plot.view || {}) };
  if (range) view[axis] = range;
  else delete view[axis];
  const next = normalizePlot({ ...plot, view });
  if (JSON.stringify(next) === JSON.stringify(plot)) return false;
  box.plot = next;
  return true;
}

/** Kinds of analysis plot a file's traces can be added to (`plot.extra`). */
const EXTRA_KINDS = new Set(['response', 'step', 'wave', 'swing', 'locus']);

/**
 * The traces a plot's editor changes: a data plot's own, or those added to
 * an analysis plot from files (`extra`, drawn over the analysis's), with
 * the index of the first one's legend entry and how many there may be.
 */
function editableTraces(box, circuit) {
  const plot = box?.plot;
  if (!plot) throw new Error(`"${box?.id}" is not a plot`);
  if (plot.kind === 'data') return { key: 'traces', traces: plot.traces, offset: 0, max: MAX_DATA_TRACES, min: 1 };
  if (!EXTRA_KINDS.has(plot.kind)) throw new Error(`"${box.id}" takes no traces from a file`);
  const traces = plot.extra || [];
  return { key: 'extra', traces, offset: circuit.plotLegendCurves(box).length - traces.length, max: MAX_PLOT_EXTRA, min: 0 };
}

/**
 * What a file's x and y mean on `plot`, for its traces to be read in the
 * plot's own units: `[{ key, text, scale }]` per axis, the first each one's
 * own. A response's x is an angular frequency (or f/fs), so a file in hertz
 * is scaled by 2π; its magnitude is in dB, so a plain ratio is taken
 * 20 log10.
 */
export function fileUnits(plot) {
  if (plot?.kind !== 'response' || plot.axis === 'normalized') return { x: [], y: [] };
  return {
    x: [{ key: 'rad/s', text: 'rad/s' }, { key: 'Hz', text: 'Hz (×2π)' }],
    y: plot.quantity === 'phase' ? [] : [{ key: 'dB', text: 'dB' }, { key: 'ratio', text: 'Ratio (20 log₁₀)' }],
  };
}

/** `traces`' points read as `units` say ({ x: 'Hz', y: 'ratio' }, fileUnits) in `plot`'s own units. */
export function inPlotUnits(plot, traces, units = {}) {
  const sx = units.x === 'Hz' ? 2 * Math.PI : 1;
  const ty = units.y === 'ratio' ? (v) => (v > 0 ? 20 * Math.log10(v) : NaN) : (v) => v;
  if (sx === 1 && units.y !== 'ratio') return traces;
  return traces.map((trace) => ({ ...trace, points: trace.points.map(([x, y]) => [x * sx, ty(y)]).filter(([, y]) => Number.isFinite(y)) }));
}

/** Whether `box` is a plot a file's traces can go on. */
export function takesFileTraces(box) {
  return box?.plot?.kind === 'data' || EXTRA_KINDS.has(box?.plot?.kind);
}

/** The legend entries a plot's editable traces have, after `offset`. */
const ownEntries = (circuit, box, { offset, traces }) => circuit.plotLegend(box).slice(offset, offset + traces.length);

/** Put `labels` last in the drawing's labels: the legend is read in their order. */
function putLast(circuit, labels) {
  for (const label of labels) {
    circuit.labels.delete(label.id);
    circuit.labels.set(label.id, label);
  }
}

/** Rename or recolor trace `index` (from 0) of a plot (a data plot's, or
 *  one added to an analysis plot), its legend entry with it; a color is one
 *  of the palette's (its name or value). Returns whether anything changed. */
export function setPlotTrace(circuit, box, index, { label, color } = {}) {
  const own = editableTraces(box, circuit);
  const trace = own.traces[index];
  if (!trace) throw new Error(`no trace ${index + 1} (the plot has ${own.traces.length})`);
  const token = color === undefined ? null : colorToken(color);
  if (color !== undefined && !token) throw new Error(`a color is one of ${Object.keys(COLOR_PALETTE).join(', ')}`);
  const next = { ...trace, ...(label !== undefined ? { label: String(label).slice(0, 400) } : {}), ...(token ? { color: COLOR_PALETTE[token] } : {}) };
  if (next.label === trace.label && next.color === trace.color) return false;
  box.plot = normalizePlot({ ...box.plot, [own.key]: own.traces.map((t, i) => (i === index ? next : t)) });
  const entry = ownEntries(circuit, box, own)[index];
  if (entry) {
    if (next.label !== trace.label) {
      // Its left edge stays beside the plot as its text grows or shrinks.
      const left = entry.bbox().x;
      entry.setText(next.label || ' ');
      const anchor = entry.anchorWorld();
      entry.moveTo(anchor.x + left - entry.bbox().x, anchor.y);
    }
    entry.style = { ...entry.style, color: next.color };
  }
  return true;
}

/** Move trace `from` (from 0) of a plot to position `to`: a later trace
 *  draws over an earlier one. Its legend entry moves with it, those
 *  entries stacked again in the new order from where they start. Returns
 *  whether it moved. */
export function movePlotTrace(circuit, box, from, to) {
  const own = editableTraces(box, circuit);
  const count = own.traces.length;
  for (const [n, i] of [['trace', from], ['position', to]]) if (!Number.isInteger(i) || i < 0 || i >= count) throw new Error(`no ${n} ${i + 1} (the plot has ${count})`);
  if (from === to) return false;
  const order = own.traces.map((_, i) => i);
  order.splice(to, 0, order.splice(from, 1)[0]);
  const legend = circuit.plotLegend(box);
  const entries = ownEntries(circuit, box, own);
  box.plot = normalizePlot({ ...box.plot, [own.key]: order.map((i) => own.traces[i]) });
  if (entries.length === count) {
    const left = Math.min(...entries.map((l) => l.bbox().x));
    let top = Math.min(...entries.map((l) => l.bbox().y));
    const moved = order.map((i) => entries[i]);
    putLast(circuit, [...moved, ...legend.slice(own.offset + count)]);
    for (const label of moved) {
      const size = label.bbox();
      label.moveTo(snap(left + size.w / 2), snap(top + size.h / 2));
      top = label.bbox().y + label.bbox().h;
    }
  }
  return true;
}

/** Take trace `index` (from 0) off a plot, and its legend entry. A data
 *  plot keeps one. */
export function removePlotTrace(circuit, box, index) {
  const own = editableTraces(box, circuit);
  if (!Number.isInteger(index) || index < 0 || index >= own.traces.length) throw new Error(`no trace ${index + 1} (the plot has ${own.traces.length})`);
  if (own.traces.length <= own.min) throw new Error('a plot keeps one trace at least');
  const entry = ownEntries(circuit, box, own)[index];
  if (entry) circuit.removeLabel(entry.id);
  box.plot = normalizePlot({ ...box.plot, [own.key]: own.traces.filter((_, i) => i !== index) });
}

/** The names of the files a plot's traces came from, each once. */
function joinFiles(...names) {
  const files = [...new Set(names.flatMap((name) => String(name || '').split(', ')).filter(Boolean))];
  return files.join(', ').slice(0, 200);
}

/** Add `traces` ({ label, points, color? }, in the plot's own units) to a
 *  data plot or an analysis plot, read from the file `file`, their legend
 *  entries under its others. A trace without a color takes one the plot
 *  does not use yet. Returns the new entries. */
export function appendPlotTraces(circuit, box, traces, { file = '' } = {}) {
  const own = editableTraces(box, circuit);
  const plot = box.plot;
  if (!traces.length) throw new Error('no trace to add');
  if (own.traces.length + traces.length > own.max) throw new Error(`a plot takes at most ${own.max} traces ${own.key === 'extra' ? 'from files ' : ''}(it has ${own.traces.length})`);
  const used = new Set([...(plot.traces || []), ...own.traces].map((t) => t.color).concat(plot.color || []));
  const added = traces.map((trace) => {
    const color = trace.color || TRACE_COLORS.find((c) => !used.has(c)) || TRACE_COLORS[0];
    used.add(color);
    return { label: trace.label, color, points: trace.points };
  });
  const next = normalizePlot({ ...plot, ...(own.key === 'traces' ? { file: joinFiles(plot.file, file) } : {}), [own.key]: [...own.traces, ...added] });
  if (!next || (next[own.key] || []).length !== own.traces.length + added.length) throw new Error('a trace to add has no two points to plot');
  const legend = circuit.plotLegend(box);
  const below = legend.length ? { x: Math.min(...legend.map((l) => l.bbox().x)), y: Math.max(...legend.map((l) => l.bbox().y + l.bbox().h)) } : null;
  box.plot = next;
  const entries = writeLegend(circuit, box, next[own.key].slice(own.traces.length), below);
  // Notes (an analysis plot's SNDR) stay after the curves' entries.
  putLast(circuit, legend.slice(own.offset + own.traces.length));
  return entries;
}

/** Replace a data plot's traces with `plot`'s (the file read again, or
 *  other columns), keeping its place, size, style, axes' names and scales,
 *  and zoom; its legend is written again where it was. */
export function replaceDataPlotTraces(circuit, box, plot) {
  const old = dataPlotOf(box);
  const legend = circuit.plotLegend(box);
  const at = legend.length ? { x: Math.min(...legend.map((l) => l.bbox().x)), y: Math.min(...legend.map((l) => l.bbox().y)) } : null;
  for (const label of legend) circuit.removeLabel(label.id);
  box.plot = normalizePlot({ ...old, file: plot.file || old.file, traces: plot.traces });
  return writeLegend(circuit, box, box.plot.traces, at);
}
