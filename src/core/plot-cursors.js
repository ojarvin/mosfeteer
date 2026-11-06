/**
 * Markers on a plot (`plot.cursors`, set in its settings): a point on a
 * trace, reading its x and y there; a vertical line at an x, reading each
 * trace's y where it crosses; a horizontal line at a y, reading each
 * trace's x where it crosses. Their numbers go small beside what they
 * read, clear of one another (a marker's `values: false` leaves its out).
 * One reading and one layout for both renderers: the plot in a window
 * (web/plot-view.js) and the plot on the drawing (render.js).
 *
 * A marker: `{ kind: 'point', trace, x }` (`trace` a spec series' `trace`
 * id: the plot's own traces from 0, then those added from files),
 * `{ kind: 'vertical', x }`, `{ kind: 'horizontal', y }`, in the data's
 * own units, each with `values: false` when its numbers stay off.
 */

import { fromU, toU } from './plot-scale.js';
import { calculate } from './calculator.js';

export const MAX_PLOT_CURSORS = 8;
export const CURSOR_KINDS = ['point', 'vertical', 'horizontal'];

const precise = (v) => Number(v.toPrecision(9));

/** A plot's markers, checked: for a normalized plot to spread in. A plot
 *  from before markers had their own Values (`plot.cursorValues: false`)
 *  turns each one's numbers off. */
export function cursorsOf(plot) {
  const allOff = plot?.cursorValues === false;
  const cursors = (Array.isArray(plot?.cursors) ? plot.cursors : []).filter((c) => CURSOR_KINDS.includes(c?.kind)).slice(0, MAX_PLOT_CURSORS).flatMap((c) => {
    const off = allOff || c.values === false ? { values: false } : {};
    if (c.kind === 'horizontal') return Number.isFinite(c.y) ? [{ kind: 'horizontal', y: precise(c.y), ...off }] : [];
    if (!Number.isFinite(c.x)) return [];
    if (c.kind === 'vertical') return [{ kind: 'vertical', x: precise(c.x), ...off }];
    return Number.isInteger(c.trace) && c.trace >= 0 && c.trace < 64 ? [{ kind: 'point', trace: c.trace, x: precise(c.x), ...off }] : [];
  });
  return cursors.length ? { cursors } : {};
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

/** A typed marker place: a number or an expression the calculator takes
 *  (`1/64`, `2.7k/2.24M`); null when it is neither or not finite. */
export function cursorValue(text) {
  try {
    const value = Number(calculate(String(text ?? '')).value);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

/** A number as a marker shows it: four figures (`digits`). */
export function cursorNumber(value, digits = 4) {
  if (!Number.isFinite(value)) return '–';
  const magnitude = Math.abs(value);
  if (magnitude !== 0 && (magnitude < 1e-3 || magnitude >= 1e6)) return value.toExponential(3).replace(/\.?0+e/, 'e');
  return String(Number(value.toPrecision(digits)));
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

/** Whether the segment a-b passes through `box`. */
function segmentHitsBox(a, b, box) {
  const x1 = box.x + box.w;
  const y1 = box.y + box.h;
  if (Math.max(a.x, b.x) < box.x || Math.min(a.x, b.x) > x1 || Math.max(a.y, b.y) < box.y || Math.min(a.y, b.y) > y1) return false;
  // Clipped to the box's x span, the segment's y range meets the box's.
  const dx = b.x - a.x;
  const at = (x) => (dx ? a.y + ((x - a.x) / dx) * (b.y - a.y) : a.y);
  const lo = Math.max(box.x, Math.min(a.x, b.x));
  const hi = Math.min(x1, Math.max(a.x, b.x));
  const ys = dx ? [at(lo), at(hi)] : [a.y, b.y];
  return Math.max(...ys) >= box.y && Math.min(...ys) <= y1;
}

/**
 * Small texts placed beside their points, none over another or over a
 * point, inside `pane`, and as few as can be over the traces: `labels`
 * `[{ x, y, text }]` (px), `curves` the traces as px polylines. Each label
 * is tried up-right, down-right, up-left, and down-left of its point, then
 * a row further out at a time; the nearest spot over no trace wins, and a
 * spot over one trace costs as much as four rows further out. One with no
 * clear place takes its first inside the pane. `size` is the text's
 * height; widths are estimated. Returns `[{ x, y (baseline), anchor,
 * text, box, leader? }]`: a label moved out a row or more has a leader,
 * `{ x1, y1, x2, y2 }`, from its point to the nearest of its box.
 */
export function placeCursorLabels(labels, pane, { size = 10, gap = 3, curves = [] } = {}) {
  const placed = [];
  // In the math font a figure is half an em; markup (^{}) takes no room of
  // its own, and a superscript is two thirds the size.
  const width = (text) => {
    const sup = [...text.matchAll(/\^\{([^}]*)\}/g)].reduce((n, m) => n + m[1].length, 0);
    const base = text.replace(/\^\{[^}]*\}/g, '').length;
    return 0.52 * size * (base + 0.68 * sup);
  };
  const points = labels.map((l) => ({ x: l.x - gap, y: l.y - gap, w: 2 * gap, h: 2 * gap }));
  const overlaps = (b, o) => b.x < o.x + o.w && o.x < b.x + b.w && b.y < o.y + o.h && o.y < b.y + b.h;
  const clear = (b) => ![...placed.map((p) => p.box), ...points].some((o) => overlaps(b, o));
  const inside = (b) => b.x >= pane.x && b.y >= pane.y && b.x + b.w <= pane.x + pane.w && b.y + b.h <= pane.y + pane.h;
  const segments = curves.flatMap((line) => line.slice(1).map((b, i) => [line[i], b]));
  const crossings = (box) => {
    const near = { x: box.x - 1, y: box.y - 1, w: box.w + 2, h: box.h + 2 };
    let n = 0;
    for (const [a, b] of segments) if (segmentHitsBox(a, b, near)) n += 1;
    return n;
  };
  const ROWS = 5;
  for (const label of labels) {
    const w = width(label.text);
    const h = size;
    const spots = [];
    for (let row = 0; row < ROWS; row++) {
      const up = label.y - gap - h - row * (h + 1);
      const down = label.y + gap + row * (h + 1);
      for (const [x, y] of [[label.x + gap, up], [label.x + gap, down], [label.x - gap - w, up], [label.x - gap - w, down]]) spots.push({ x, y, w, h, row });
    }
    const boxes = spots.filter(inside);
    let best = null;
    for (const box of boxes) {
      if (best && box.row >= best.cost) break;
      if (!clear(box)) continue;
      const cost = box.row + 4 * crossings(box);
      if (!best || cost < best.cost) best = { box, cost };
    }
    const box = best?.box || boxes[0] || { x: Math.min(Math.max(pane.x, label.x + gap), pane.x + pane.w - w), y: Math.max(pane.y, label.y - gap - h), w, h };
    // Away from its point, a label shows which point is its.
    let leader;
    if (box.row > 0) {
      const to = { x: Math.max(box.x, Math.min(box.x + box.w, label.x)), y: Math.max(box.y, Math.min(box.y + box.h, label.y)) };
      const length = Math.hypot(to.x - label.x, to.y - label.y);
      if (length > 2 * gap) {
        const from = gap / length;
        leader = { x1: label.x + (to.x - label.x) * from, y1: label.y + (to.y - label.y) * from, x2: to.x, y2: to.y };
      }
    }
    placed.push({ x: box.x, y: box.y + 0.82 * h, anchor: 'start', text: label.text, box: { x: box.x, y: box.y, w: box.w, h: box.h }, ...(leader ? { leader } : {}) });
  }
  return placed;
}

/**
 * The markers as drawing items on a pane: `toPx` `{ x(u), y(v) }` places
 * a value, `pane` the plot's area. Returns `{ lines: [{ x1, y1, x2, y2 }],
 * dots: [{ x, y, color }], texts }` (placeCursorLabels's), the lines and
 * dots only those in the pane, the texts of a marker with `values: false`
 * left out, and all of them when `values` is false.
 */
export function cursorLayout(spec, { toPx, pane, size = 10, gap = 3, values = true, cursors = spec?.cursors || [] } = {}) {
  const lines = [];
  const dots = [];
  const labels = [];
  const within = (v, low, length) => v >= low - 0.5 && v <= low + length + 0.5;
  for (const reading of cursorReadings(spec, cursors)) {
    const shown = reading.cursor.values !== false;
    if (reading.kind === 'vertical') {
      const px = toPx.x(reading.u);
      if (!within(px, pane.x, pane.w)) continue;
      lines.push({ x1: px, y1: pane.y, x2: px, y2: pane.y + pane.h, index: reading.index });
      if (shown) labels.push({ x: px, y: pane.y + pane.h, text: reading.text });
    } else if (reading.kind === 'horizontal') {
      const py = toPx.y(reading.v);
      if (!within(py, pane.y, pane.h)) continue;
      lines.push({ x1: pane.x, y1: py, x2: pane.x + pane.w, y2: py, index: reading.index });
      if (shown) labels.push({ x: pane.x, y: py, text: reading.text });
    }
    for (const hit of reading.hits) {
      const x = toPx.x(hit.u);
      const y = toPx.y(hit.v);
      if (!within(x, pane.x, pane.w) || !within(y, pane.y, pane.h)) continue;
      dots.push({ x, y, color: hit.color, index: reading.index, point: reading.kind === 'point' });
      if (shown) labels.push({ x, y, text: hit.text });
    }
  }
  if (!values) return { lines, dots, texts: [] };
  // The traces as drawn, and the marker lines, for the numbers to keep off them.
  const curves = labels.length ? [
    ...cursorCurves(spec).map((curve) => curve.points.filter(([, v]) => v !== null).map(([u, v]) => ({ x: toPx.x(u), y: toPx.y(v) }))),
    ...lines.map((l) => [{ x: l.x1, y: l.y1 }, { x: l.x2, y: l.y2 }]),
  ] : [];
  return { lines, dots, texts: placeCursorLabels(labels, pane, { size, gap, curves }) };
}
