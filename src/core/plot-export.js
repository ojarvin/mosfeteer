/**
 * Any plot on the drawing as columns of numbers, and those as CSV: the
 * numbers the plot keeps (model.js normalizePlot), as it keeps them -- an
 * analysis's samples rounded, a data plot's thinned -- never sampled again.
 *
 * `plotSeries(plot)` gives each curve as `{ name, columns, rows }`: its
 * column names, x first, and its rows of numbers (null for a gap).
 * `plotCsv(plot, options)` joins the curves chosen: one x column when they
 * share their x values, else each curve's own columns side by side.
 */

import { plainTex } from './bode-figure.js';
import { axisName } from './plot-spec.js';

/** A TeX or markup name as a CSV heading reads it: V_{OUT}/V_{IN} is V_OUT/V_IN. */
export function plainName(text) {
  return axisName(plainTex(text || ''))
    .replace(/([_^])\{([^{}]*)\}/g, (_, mark, inner) => `${mark}${inner}`)
    .replace(/\\([a-zA-Z]+)/g, '$1')
    .trim();
}

const named = (trace, index, fallback = 'Trace') => plainName(trace.label) || `${fallback} ${index + 1}`;

/** Each curve of `plot` as `{ name, columns, rows }`: its own, then
 *  the traces added to it from files. */
export function plotSeries(plot) {
  const own = ownSeries(plot);
  if (!own.length || !plot.extra) return own;
  // An added trace's y is in the plot's own units: its curves' heading's.
  const unit = plot.kind === 'response' ? (plot.quantity === 'phase' ? ' (°)' : plot.units === 'dBFS' ? ' (dBFS)' : ' (dB)') : plot.kind === 'swing' ? ' (dBFS)' : '';
  return [...own, ...plot.extra.map((trace, i) => {
    const name = named(trace, i, 'Added');
    return { name, columns: plot.kind === 'locus' ? ['Re', 'Im'] : [own[0].columns[0], `${name}${unit}`], rows: trace.points.map(([x, y]) => [x, y]) };
  })];
}

function ownSeries(plot) {
  if (!plot) return [];
  if (plot.kind === 'data') {
    const x = plainName(plot.x.label) || 'x';
    return plot.traces.map((trace, i) => ({ name: named(trace, i), columns: [x, named(trace, i)], rows: trace.points.map(([px, py]) => [px, py]) }));
  }
  if (plot.kind === 'response') {
    const x = plot.axis === 'normalized' ? 'f/fs' : 'ω (rad/s)';
    const y = plot.quantity === 'phase' ? 'phase (°)' : plot.units === 'dBFS' ? 'dBFS' : 'dB';
    return plot.traces.map((trace, i) => {
      const name = trace.background ? (plainName(trace.label) || 'Spectrum') : named(trace, i);
      return { name, columns: [x, `${name} (${y})`], rows: trace.points.map((p) => [p.f, p.db]) };
    });
  }
  if (plot.kind === 'step' || plot.kind === 'wave') {
    const x = plot.unit === 'n' ? 'n' : 't (s)';
    return plot.traces.map((trace, i) => ({ name: named(trace, i), columns: [x, named(trace, i)], rows: trace.points.map((p) => [p.t, p.y]) }));
  }
  if (plot.kind === 'swing') {
    return plot.traces.map((trace, i) => ({ name: named(trace, i), columns: ['input (dBFS)', `${named(trace, i)} (dBFS)`], rows: trace.points.map((p) => [p.a, p.db]) }));
  }
  if (plot.kind === 'locus') {
    const name = plainName(plot.label) || 'Root locus';
    // `t` runs from the sweep's start (0) to its end (1).
    return [{ name, columns: ['Re', 'Im', `${plainName(plot.parameter) || 'k'} sweep (0 to 1)`], rows: plot.points.map((p) => [p.re, p.im, p.t]) }];
  }
  // A Bode sketch: magnitude and phase, and its straight-line asymptote.
  const quantity = plainName(plot.quantity) || 'A';
  return [
    { name: `|${quantity}|`, columns: ['ω (rad/s)', `|${quantity}| (dB)`, `∠${quantity} (°)`], rows: plot.points.map((p) => [p.w, p.db, p.phase]) },
    ...(plot.asymptote?.length ? [{ name: 'Asymptote', columns: ['ω (rad/s)', 'Asymptote (dB)'], rows: plot.asymptote.map((p) => [p.w, p.db]) }] : []),
  ];
}

const sameX = (series) => series.every((s) => s.rows.length === series[0].rows.length && s.rows.every((row, i) => row[0] === series[0].rows[i][0]));

/**
 * The curves `series` (plotSeries's, those to export) as a table:
 * `{ header, rows }`. Curves on the same x values share one x column;
 * otherwise each brings its own columns, a shorter one's rows left empty.
 */
export function seriesTable(series) {
  if (!series.length) return { header: [], rows: [] };
  if (series.length > 1 && sameX(series)) {
    return {
      header: [series[0].columns[0], ...series.flatMap((s) => s.columns.slice(1))],
      rows: series[0].rows.map((row, i) => [row[0], ...series.flatMap((s) => s.rows[i].slice(1))]),
    };
  }
  const length = Math.max(...series.map((s) => s.rows.length));
  return {
    header: series.flatMap((s) => (series.length > 1 ? s.columns.map((c, k) => (k ? c : `${c} [${s.name}]`)) : s.columns)),
    rows: Array.from({ length }, (_, i) => series.flatMap((s) => s.rows[i] || s.columns.map(() => null))),
  };
}

/** A CSV cell: quoted when it holds the separator, a quote, or a line break. */
function cell(value, { separator, decimal }) {
  if (value === null || value === undefined || (typeof value === 'number' && !Number.isFinite(value))) return '';
  let text = String(value);
  if (typeof value === 'number' && decimal === ',') text = text.replace('.', ',');
  return text.includes(separator) || /["\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * `plot` as CSV text: the curves `traces` (indices into plotSeries, all by
 * default), separated by `separator` (',' ';' or tab) with `decimal` '.'
 * or ','. A comma separator with decimal commas is refused: they would read
 * as cells.
 */
export function plotCsv(plot, { traces = null, separator = ',', decimal = '.' } = {}) {
  if (![',', ';', '\t'].includes(separator)) throw new Error('the separator is a comma, a semicolon, or a tab');
  if (decimal !== '.' && decimal !== ',') throw new Error('the decimal sign is a point or a comma');
  if (separator === ',' && decimal === ',') throw new Error('decimal commas need a semicolon or tab separator');
  const all = plotSeries(plot);
  const picked = traces === null ? all : traces.map((i) => {
    if (!all[i]) throw new Error(`no trace ${i + 1} (the plot has ${all.length})`);
    return all[i];
  });
  if (!picked.length) throw new Error('no trace to export');
  const { header, rows } = seriesTable(picked);
  const format = { separator, decimal };
  return [header, ...rows].map((row) => row.map((value) => cell(value, format)).join(separator)).join('\n') + '\n';
}
