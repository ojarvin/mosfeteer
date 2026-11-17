/**
 * A plot on the drawing laid out from the spec its window shows
 * (plot-spec.js `plotSpec`): one layout for every kind -- responses,
 * steps and waveforms, swing, root locus, data -- as plain drawing items
 * (bode-figure.js's: lines, paths, dots, texts with `_{}`/`^{}` markup),
 * set as a journal figure: the axes left and below, numbered, their titles
 * outside the numbers, the curves cut to the pane. The view is the
 * window's (plot-scale.js `specView`), its y axis rounded out to its ticks,
 * or the one the plot was zoomed to (`plot.view`, in its data's units).
 *
 * Items carry their roles (render.js strokes them): axis, grid, minor,
 * tick, number, label, zero, band, marker, corner, curve, spectrum,
 * asymptote. A curve's path or dot also carries `color` and `trace`, the
 * index of its series' trace.
 */

import { axisTitles, clipToPane, frameAxes, framePane } from './bode-figure.js';
import { plotSpec } from './plot-spec.js';
import { axisTicks, logMinorGrid, niceStep, seriesPoints, specView, tickText, toU, toUY } from './plot-scale.js';

/** Whole multiples a stepped axis (dB, degrees) ticks in, as it crowds:
 *  20 dB then 40, 50, 80, 100; 45° then 90, 180; 10 dB then 20, 40. */
const STEP_MULTIPLES = [1, 2, 2.5, 4, 5, 10, 20, 50, 100];

/** Whether `value` is 1, 2 or 5 times a power of ten. */
const round125 = (value) => [1, 2, 5].some((m) => Math.abs(value / 10 ** Math.floor(Math.log10(value) + 1e-9) - m) < 1e-9);

/** An axis's ticks over `range` (u), about `target` of them: a log axis
 *  as plot-scale.js ticks it, which numbers each decade it can; a linear
 *  one with a `step` in whole multiples of it that fall on both its ends,
 *  so its numbers reach them. */
function figureTicks(scale, [low, high], target, step) {
  if (!step || scale !== 'linear') return axisTicks(scale, low, high, { target });
  const onEnds = (s) => [low, high].every((v) => Math.abs(v / s - Math.round(v / s)) < 1e-9);
  const choices = STEP_MULTIPLES.map((m) => m * step).filter((s, i) => (STEP_MULTIPLES[i] !== 2.5 || round125(s)) && (!Number.isInteger(step) || Number.isInteger(s)) && onEnds(s) && (high - low) / s >= 2);
  const every = choices.find((s) => (high - low) / s < target + 1) ?? choices.at(-1) ?? niceStep((high - low) / target);
  const ticks = [];
  for (let v = Math.ceil(low / every - 1e-9) * every; v <= high + every * 1e-9; v += every) ticks.push({ u: v + 0, text: tickText(v + 0, every), major: true });
  return ticks;
}

/** A series' role as the drawing strokes it. */
const ITEM_ROLE = { background: 'spectrum', band: 'band', asymptote: 'asymptote' };

/**
 * Lay out `plot` (an analysis plot or a data plot, as a plot annotation
 * keeps it) in a `width` x `height` box, its text `fontSize` tall; `right`
 * is the room right of the pane. Returns { width, height, items, pane,
 * ranges: { x, y } (u coordinates), toPx: { x(u), y(u) } }.
 */
export function plotFigure(plot, { width = 480, height = 260, fontSize = 11, right } = {}) {
  const spec = plotSpec(plot);
  const em = fontSize;
  const items = [];
  const pane = framePane(width, height, em, plot, right);
  const xs = spec.x.scale || 'linear';
  const ys = spec.y.scale || 'linear';
  // A zoomed plot keeps the limits it was annotated at; else it shows all
  // its data, a linear y axis without whole steps of its own (dB, degrees)
  // rounded out to its ticks.
  const fitted = specView(spec, pane);
  const zoom = plot.view || {};
  const xTarget = Math.max(2, Math.round(pane.w / ((xs === 'log' ? 3 : 6) * em)));
  const yTarget = Math.max(2, Math.round(pane.h / (3 * em)));
  const view = { x: zoom.x ? zoom.x.map((v) => toU(xs, v)) : fitted.x, y: zoom.y ? zoom.y.map((v) => toUY(ys, v)) : fitted.y };
  if (!zoom.y && !spec.equal && !spec.y.step && ys === 'linear') {
    const ticks = figureTicks(ys, view.y, yTarget, spec.y.step);
    const step = ticks.length > 1 ? ticks[1].u - ticks[0].u : 0;
    if (step > 0) view.y = [Math.floor(view.y[0] / step + 1e-9) * step + 0, Math.ceil(view.y[1] / step - 1e-9) * step + 0];
  }
  const X = (u) => pane.x + ((u - view.x[0]) / (view.x[1] - view.x[0] || 1)) * pane.w;
  const Y = (u) => pane.y + ((view.y[1] - u) / (view.y[1] - view.y[0] || 1)) * pane.h;
  const inX = (u) => u > view.x[0] + 1e-9 && u < view.x[1] - 1e-9;
  const inY = (u) => u > view.y[0] + 1e-9 && u < view.y[1] - 1e-9;
  const vertical = (u, role) => items.push({ type: 'line', x1: X(u), y1: pane.y, x2: X(u), y2: pane.y + pane.h, role });
  const horizontal = (u, role) => items.push({ type: 'line', x1: pane.x, y1: Y(u), x2: pane.x + pane.w, y2: Y(u), role });

  frameAxes(items, pane);
  // The grid: faint lines through each decade of a log axis, under the
  // numbered ones; numbers under the x axis and left of the y axis.
  // Zoomed in, an axis ticks what it shows rather than its whole steps.
  const xTicks = figureTicks(xs, view.x, xTarget, zoom.x ? null : spec.x.step);
  const yTicks = figureTicks(ys, view.y, yTarget, zoom.y ? null : spec.y.step);
  if (xs === 'log') for (const u of logMinorGrid(view.x[0], view.x[1], { ticks: xTicks.map((t) => t.u), length: pane.w, minDecade: 4 * em })) vertical(u, 'minor');
  if (ys === 'log') for (const u of logMinorGrid(view.y[0], view.y[1], { ticks: yTicks.map((t) => t.u), length: pane.h, minDecade: 3 * em })) horizontal(u, 'minor');
  for (const tick of xTicks) {
    vertical(tick.u, tick.major ? 'grid' : 'minor');
    items.push({ type: 'line', x1: X(tick.u), y1: pane.y + pane.h, x2: X(tick.u), y2: pane.y + pane.h - 0.36 * em, role: 'tick' });
    if (tick.major || xTicks.length <= 12) items.push({ type: 'text', x: X(tick.u), y: pane.y + pane.h + 1.3 * em, text: tick.text, anchor: 'middle', role: 'number' });
  }
  for (const tick of yTicks) {
    horizontal(tick.u, 'grid');
    items.push({ type: 'text', x: pane.x - 0.45 * em, y: Y(tick.u) + 0.36 * em, text: tick.text, anchor: 'end', role: 'number' });
  }
  for (const line of spec.hlines || []) {
    const u = toUY(ys, line.y);
    if (Number.isFinite(u) && inY(u)) horizontal(u, line.role || 'zero');
  }
  // Marked lines, named at the top inside the pane: left of the line in the
  // right half, else right of it; a name close to the one before a line lower.
  let previous = null;
  let row = 0;
  const marks = (spec.vlines || []).map((line) => ({ ...line, u: toU(xs, line.x) })).filter((line) => Number.isFinite(line.u) && inX(line.u)).sort((a, b) => a.u - b.u);
  for (const line of marks) {
    vertical(line.u, line.role || 'marker');
    if (!line.label) continue;
    const at = X(line.u);
    const right = at > pane.x + pane.w / 2;
    row = previous !== null && at - previous < 3 * em ? row + 1 : 0;
    previous = at;
    items.push({ type: 'text', x: at + (right ? -0.35 : 0.35) * em, y: pane.y + (1.2 + 1.2 * row) * em, text: line.label, anchor: right ? 'end' : 'start', role: line.role || 'marker' });
  }
  // The curves, cut to the pane; a value off the top (Infinity) runs up out
  // of it, and far values are pinned near it so their slope stays.
  const pin = (v, low, high) => Math.max(low - 4 * (high - low), Math.min(high + 4 * (high - low), v));
  const py = (u) => (u === Infinity ? pane.y - 4 * pane.h : pin(Y(u), pane.y, pane.y + pane.h));
  const curves = [];
  for (const series of spec.series) {
    const role = ITEM_ROLE[series.role] || 'curve';
    const own = series.trace !== undefined ? { color: series.color, trace: series.trace } : {};
    const points = seriesPoints(spec, series);
    if (series.dots) {
      points.forEach(([u, v], i) => {
        if (!Number.isFinite(v)) return;
        items.push({ type: 'dot', x: X(u), y: Y(v), r: 0.17 * em, opacity: 0.2 + 0.8 * (series.dots[i] ?? 1), role, ...own });
      });
      continue;
    }
    let current = [];
    const flush = () => {
      if (current.length > 1) curves.push({ type: 'path', points: current, role, ...own });
      current = [];
    };
    let last = null;
    for (const [u, v] of points) {
      if (v === null || Number.isNaN(v) || v === -Infinity) { flush(); last = null; continue; }
      const x = pin(X(u), pane.x, pane.x + pane.w);
      // A sampled series holds each value until the next sample.
      if (series.stairs && last !== null) current.push({ x, y: last });
      current.push({ x, y: py(v) });
      last = py(v);
    }
    flush();
  }
  items.push(...clipToPane(curves, pane).filter((item) => item.type !== 'path' || item.points.length > 1));
  const arm = 0.4 * em;
  for (const cross of spec.crosses || []) {
    const cx = X(toU(xs, cross.x));
    const cy = Y(toUY(ys, cross.y));
    if (cx < pane.x || cx > pane.x + pane.w || cy < pane.y || cy > pane.y + pane.h) continue;
    items.push({ type: 'line', x1: cx - arm, y1: cy - arm, x2: cx + arm, y2: cy + arm, role: 'marker' });
    items.push({ type: 'line', x1: cx - arm, y1: cy + arm, x2: cx + arm, y2: cy - arm, role: 'marker' });
  }
  (spec.notes || []).forEach((note, i) => items.push({ type: 'text', x: pane.x + 0.4 * em, y: pane.y + (0.9 + 1.2 * i) * em, text: note.text, anchor: 'start', role: note.role || 'label' }));
  axisTitles(items, pane, em, { x: spec.x.title ?? spec.x.label ?? '', y: spec.y.title ?? spec.y.label ?? '' });
  return { width, height, items: items.filter((item) => item.type !== 'dot' || clipToPane([item], pane).length), pane, ranges: { x: view.x, y: view.y }, toPx: { x: X, y: Y } };
}
