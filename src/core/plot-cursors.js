/**
 * Markers on a plot (`plot.cursors`, set in its settings): a point on a
 * trace, reading its x and y there; a vertical line at an x, reading each
 * trace's y where it crosses; a horizontal line at a y, reading each
 * trace's x where it crosses. Their numbers go small beside what they
 * read, clear of one another (`plot.cursorValues: false` leaves them out).
 * One reading and one layout for both renderers: the plot in a window
 * (web/plot-view.js) and the plot on the drawing (render.js).
 *
 * A marker: `{ kind: 'point', trace, x }` (`trace` a spec series' `trace`
 * id: the plot's own traces from 0, then those added from files),
 * `{ kind: 'vertical', x }`, `{ kind: 'horizontal', y }`, in the data's
 * own units.
 */

import { fromU, toU } from './plot-scale.js';

export const MAX_PLOT_CURSORS = 8;
export const CURSOR_KINDS = ['point', 'vertical', 'horizontal'];

const precise = (v) => Number(v.toPrecision(9));

/** A plot's markers, checked, and whether their numbers show: for a
 *  normalized plot to spread in. */
export function cursorsOf(plot) {
  const cursors = (Array.isArray(plot?.cursors) ? plot.cursors : []).filter((c) => CURSOR_KINDS.includes(c?.kind)).slice(0, MAX_PLOT_CURSORS).flatMap((c) => {
    if (c.kind === 'horizontal') return Number.isFinite(c.y) ? [{ kind: 'horizontal', y: precise(c.y) }] : [];
    if (!Number.isFinite(c.x)) return [];
    if (c.kind === 'vertical') return [{ kind: 'vertical', x: precise(c.x) }];
    return Number.isInteger(c.trace) && c.trace >= 0 && c.trace < 64 ? [{ kind: 'point', trace: c.trace, x: precise(c.x) }] : [];
  });
  return { ...(cursors.length ? { cursors } : {}), ...(plot?.cursorValues === false ? { cursorValues: false } : {}) };
}

/** Point markers moved with their traces: `order` the old indices of the
 *  traces from `base` on, in their new order (one left out is gone, and so
 *  are its markers). */
export function remapCursorTraces(plot, base, order) {
  if (!plot.cursors) return plot;
  const cursors = plot.cursors.flatMap((c) => {
    if (c.kind !== 'point' || c.trace < base) return [c];
    const at = order.indexOf(c.trace - base);
    return at < 0 ? [] : [{ ...c, trace: base + at }];
  });
  const { cursors: _old, ...rest } = plot;
  return cursors.length ? { ...rest, cursors } : rest;
}

/** The curves a marker reads: a spec's series that are a y for each x
 *  (not a locus's dots, not the unit circle), in u (plot-scale.js). */
export function cursorCurves(spec) {
  const xs = spec?.x?.scale || 'linear';
  const ys = spec?.y?.scale || 'linear';
  return (spec?.series || [])
    .filter((s) => s.trace !== undefined && !s.parametric && !s.dots && s.role !== 'band')
    .map((s) => ({
      trace: s.trace,
      color: s.color || null,
      label: s.label || '',
      stairs: !!s.stairs,
      points: s.points.map(([x, y]) => [toU(xs, x), y === null || y === undefined ? null : toU(ys, y)])
        .filter(([u, v]) => Number.isFinite(u) && (v === null || Number.isFinite(v))),
    }))
    .filter((c) => c.points.length > 1);
}

/** A curve's value (u) at `u`, straight between its points (held, for
 *  stairs); the first where it passes `u` more than once; null off it. */
export function curveAt(curve, u) {
  const { points, stairs } = curve;
  for (let i = 1; i < points.length; i++) {
    const [a0, a1] = points[i - 1];
    const [b0, b1] = points[i];
    if (a1 === null || b1 === null || u < Math.min(a0, b0) || u > Math.max(a0, b0)) continue;
    if (stairs) return u === b0 ? b1 : a1;
    return a0 === b0 ? a1 : a1 + ((u - a0) / (b0 - a0)) * (b1 - a1);
  }
  return null;
}

/** Where a curve crosses the value `v` (u): a few x's (u), in its order. */
export function curveCrossings(curve, v, max = 3) {
  const out = [];
  const { points, stairs } = curve;
  for (let i = 1; i < points.length && out.length < max; i++) {
    const [a0, a1] = points[i - 1];
    const [b0, b1] = points[i];
    if (a1 === null || b1 === null || (a1 - v) * (b1 - v) > 0 || (a1 === b1 && a1 !== v)) continue;
    const u = stairs ? (a1 === v ? a0 : b0) : a1 === b1 ? a0 : a0 + ((v - a1) / (b1 - a1)) * (b0 - a0);
    if (!out.some((w) => Math.abs(w - u) <= 1e-12 * Math.max(1, Math.abs(u)))) out.push(u);
  }
  return out;
}

/** A number as a marker shows it: four figures. */
export function cursorNumber(value) {
  if (!Number.isFinite(value)) return '–';
  const magnitude = Math.abs(value);
  if (magnitude !== 0 && (magnitude < 1e-3 || magnitude >= 1e6)) return value.toExponential(3).replace(/\.?0+e/, 'e');
  return String(Number(value.toPrecision(4)));
}

/** A number as a marker's label writes it, an exponent as a power of
 *  ten in plot markup: 6.152·10^{-6}, as the axis does. */
export function cursorLabel(value) {
  const text = cursorNumber(value);
  const match = text.match(/^(-?[\d.]+)e([-+]?\d+)$/);
  return match ? `${match[1]}·10^{${Number(match[2])}}` : text;
}

/** The curve nearest a point (u, v) as `toPx` places them, read at u:
 *  `{ trace, v }`, or null where no curve passes u. */
export function nearestCurve(curves, u, py, toPx) {
  let best = null;
  for (const curve of curves) {
    const v = curveAt(curve, u);
    if (v === null) continue;
    const d = Math.abs(toPx.y(v) - py);
    if (!best || d < best.d) best = { trace: curve.trace, v, d };
  }
  return best && { trace: best.trace, v: best.v };
}

/**
 * What `cursors` read on `spec`: `[{ cursor, index, kind, u?, v?, color?,
 * hits: [{ u, v, color, text }], text? }]` -- a point's hit its x and y,
 * a line's each trace it crosses with the other value, and the line's own
 * value as `text`. A point on no trace, or off its trace, reads nothing.
 */
export function cursorReadings(spec, cursors = spec?.cursors || []) {
  const xs = spec?.x?.scale || 'linear';
  const ys = spec?.y?.scale || 'linear';
  const curves = cursorCurves(spec);
  const x = (u) => cursorLabel(fromU(xs, u));
  const y = (v) => cursorLabel(fromU(ys, v));
  return cursors.flatMap((cursor, index) => {
    if (cursor.kind === 'point') {
      const curve = curves.find((c) => c.trace === cursor.trace);
      const u = toU(xs, cursor.x);
      const v = curve && Number.isFinite(u) ? curveAt(curve, u) : null;
      if (v === null) return [];
      return [{ cursor, index, kind: 'point', u, v, color: curve.color, hits: [{ u, v, color: curve.color, text: `${x(u)}, ${y(v)}` }] }];
    }
    if (cursor.kind === 'vertical') {
      const u = toU(xs, cursor.x);
      if (!Number.isFinite(u)) return [];
      const hits = curves.map((c) => ({ c, v: curveAt(c, u) })).filter(({ v }) => v !== null).map(({ c, v }) => ({ u, v, color: c.color, text: y(v) }));
      return [{ cursor, index, kind: 'vertical', u, hits, text: x(u) }];
    }
    const v = toU(ys, cursor.y);
    if (!Number.isFinite(v)) return [];
    const hits = curves.flatMap((c) => curveCrossings(c, v).map((u) => ({ u, v, color: c.color, text: x(u) })));
    return [{ cursor, index, kind: 'horizontal', v, hits, text: y(v) }];
  });
}

/**
 * Small texts placed beside their points, none over another or over a
 * point, inside `pane`: `labels` `[{ x, y, text }]` (px), each tried
 * up-right, down-right, up-left, down-left of its point, then further up
 * and down; one with no clear place takes its first inside the pane.
 * `size` is the text's height; widths are estimated. Returns `[{ x, y
 * (baseline), anchor, text, box }]`.
 */
export function placeCursorLabels(labels, pane, { size = 10, gap = 3 } = {}) {
  const placed = [];
  // Plot markup (^{}) takes no room of its own; a superscript is smaller.
  const width = (text) => 0.58 * size * text.replace(/\^\{([^}]*)\}/g, (m, sup) => sup.slice(0, Math.ceil(0.7 * sup.length))).length;
  const points = labels.map((l) => ({ x: l.x - gap, y: l.y - gap, w: 2 * gap, h: 2 * gap }));
  const clear = (b) => ![...placed.map((p) => p.box), ...points].some((o) => b.x < o.x + o.w && o.x < b.x + b.w && b.y < o.y + o.h && o.y < b.y + b.h);
  const inside = (b) => b.x >= pane.x && b.y >= pane.y && b.x + b.w <= pane.x + pane.w && b.y + b.h <= pane.y + pane.h;
  for (const label of labels) {
    const w = width(label.text);
    const h = size;
    const spots = [];
    for (let row = 0; row < 5; row++) {
      const up = label.y - gap - h - row * (h + 1);
      const down = label.y + gap + row * (h + 1);
      spots.push([label.x + gap, up], [label.x + gap, down], [label.x - gap - w, up], [label.x - gap - w, down]);
    }
    const boxes = spots.map(([x, y]) => ({ x, y, w, h })).filter(inside);
    const box = boxes.find(clear) || boxes[0] || { x: Math.min(Math.max(pane.x, label.x + gap), pane.x + pane.w - w), y: Math.max(pane.y, label.y - gap - h), w, h };
    placed.push({ x: box.x, y: box.y + 0.82 * h, anchor: 'start', text: label.text, box });
  }
  return placed;
}

/**
 * The markers as drawing items on a pane: `toPx` `{ x(u), y(v) }` places
 * a value, `pane` the plot's area. Returns `{ lines: [{ x1, y1, x2, y2 }],
 * dots: [{ x, y, color }], texts }` (placeCursorLabels's), the lines and
 * dots only those in the pane, the texts left out when `values` is false.
 */
export function cursorLayout(spec, { toPx, pane, size = 10, values = spec?.cursorValues !== false, cursors = spec?.cursors || [] } = {}) {
  const lines = [];
  const dots = [];
  const labels = [];
  const within = (v, low, length) => v >= low - 0.5 && v <= low + length + 0.5;
  for (const reading of cursorReadings(spec, cursors)) {
    if (reading.kind === 'vertical') {
      const px = toPx.x(reading.u);
      if (!within(px, pane.x, pane.w)) continue;
      lines.push({ x1: px, y1: pane.y, x2: px, y2: pane.y + pane.h, index: reading.index });
      labels.push({ x: px, y: pane.y + pane.h, text: reading.text });
    } else if (reading.kind === 'horizontal') {
      const py = toPx.y(reading.v);
      if (!within(py, pane.y, pane.h)) continue;
      lines.push({ x1: pane.x, y1: py, x2: pane.x + pane.w, y2: py, index: reading.index });
      labels.push({ x: pane.x, y: py, text: reading.text });
    }
    for (const hit of reading.hits) {
      const x = toPx.x(hit.u);
      const y = toPx.y(hit.v);
      if (!within(x, pane.x, pane.w) || !within(y, pane.y, pane.h)) continue;
      dots.push({ x, y, color: hit.color, index: reading.index, point: reading.kind === 'point' });
      labels.push({ x, y, text: hit.text });
    }
  }
  return { lines, dots, texts: values ? placeCursorLabels(labels, pane, { size }) : [] };
}
