/**
 * The plots the analysis windows show, as one kind of interactive plot
 * (web/plot-view.js) describes them: the data in its own units, the axes'
 * scales and names, and the lines that mark things. The same data that a
 * plot annotation keeps (bode-figure.js lays that out for the drawing) is
 * turned into a spec here, so a window's plot and the drawing's agree.
 *
 * A spec: `{ key, title, x: { scale, label, range?, step? }, y: { ... },
 * equal?, series: [{ points: [[x, y]], color, role, stairs?, dots?, label }],
 * vlines: [{ x, role, label? }], hlines: [{ y, role, label? }],
 * crosses: [{ x, y }], notes: [{ text, role }] }`. Roles: curve, background,
 * asymptote, start (a run's starting point), band, marker, zero.
 */

import { plainTex, swingLimit } from './bode-figure.js';

/** 10^x, exact at whole powers (V8 before 12 gives 10 ** -4 as 0.00009999999999999999). */
const pow10 = (x) => (Number.isInteger(x) ? Number(`1e${x}`) : 10 ** x);

const finitePoints = (points) => points.filter(([x, y]) => Number.isFinite(x) && x > -Infinity && y !== undefined);

/** A trace's TeX label as a plot axis writes it: markup, not TeX (an axis
 *  sets sub- and superscripts only). \frac{V_{OUT}}{V_{IN}} reads
 *  V_{OUT}/V_{IN}; \beta reads β. */
export function axisName(tex) {
  const group = '((?:[^{}]|\\{[^{}]*\\})*)';
  return String(tex)
    .replace(new RegExp(`\\\\frac\\{${group}\\}\\{${group}\\}`, 'g'), '$1/$2')
    .replace(/\\beta/g, 'β');
}

/** A frequency response (signal-flow.js `responsePlot`). */
export function responseSpec(plot) {
  const phase = plot.quantity === 'phase';
  const name = plot.role === 'loop' ? 'T' : 'H';
  return {
    key: `response:${plot.role || ''}:${phase ? 'phase' : plot.units || 'db'}:${plot.axis}`,
    title: phase ? 'Phase responses' : 'Magnitude responses',
    x: { scale: 'log', label: plot.axis === 'normalized' ? 'f/f_{s}' : 'ω', range: [pow10(plot.range.low), pow10(plot.range.high)] },
    y: { scale: 'linear', label: phase ? `∠${name} (°)` : plot.units === 'dBFS' ? 'dBFS' : `|${name}| (dB)`, step: phase ? 45 : 20, floor: phase ? null : -400 },
    series: plot.traces.filter((trace) => !trace.hidden).map((trace) => ({
      label: trace.label,
      color: trace.color,
      role: trace.background ? 'background' : trace.start ? 'start' : 'curve',
      points: finitePoints(trace.points.filter((p) => p.f > 0).map((p) => [p.f, Number.isFinite(p.db) ? p.db : null])),
    })),
    vlines: [
      ...(plot.band || []).map((f) => ({ x: f, role: 'band' })),
      ...(plot.markers || []).filter((m) => m.f > 0).map((m) => ({ x: m.f, role: 'marker', label: m.label || '' })),
    ],
    hlines: phase ? [] : [{ y: 0, role: 'zero' }],
  };
}

/** Step responses (step.js `stepPlot`). */
export function stepSpec(plot) {
  return {
    key: `step:${plot.unit}`,
    title: 'Step responses',
    x: { scale: 'linear', label: plot.unit === 'n' ? 'n (t/T_{s})' : 't', range: [plot.range.low, plot.range.high] },
    y: { scale: 'linear', label: 'step response', include: [0] },
    series: plot.traces.map((trace) => ({
      label: trace.label,
      color: trace.color,
      role: 'curve',
      ...(trace.stairs ? { stairs: true } : {}),
      points: trace.points.filter((p) => Number.isFinite(p.y)).map((p) => [p.t, p.y]),
    })),
    vlines: [],
    hlines: [{ y: 0, role: 'zero' }],
  };
}

/** A spec's x range widened to hold a plot's added traces (`extra`). */
function withExtraRange(spec, plot) {
  if (!plot.extra || !spec.x.range) return spec;
  const log = spec.x.scale === 'log';
  const xs = plot.extra.flatMap((trace) => trace.points.map((p) => p[0])).filter((v) => Number.isFinite(v) && (!log || v > 0));
  if (!xs.length) return spec;
  return { ...spec, x: { ...spec.x, range: [Math.min(spec.x.range[0], ...xs), Math.max(spec.x.range[1], ...xs)] } };
}

/** A data plot (columns read from a file, core/data-plot.js), each axis
 *  linear or log as it says. */
export function dataSpec(plot) {
  return {
    key: `data:${plot.x.scale}:${plot.y.scale}`,
    title: 'Data',
    x: { scale: plot.x.scale, label: plot.x.label },
    y: { scale: plot.y.scale, label: plot.y.label },
    series: plot.traces.map((trace) => ({ label: trace.label, color: trace.color, role: 'curve', points: trace.points.map(([x, y]) => [x, y]) })),
    vlines: [],
    hlines: plot.y.scale === 'linear' ? [{ y: 0, role: 'zero' }] : [],
  };
}

/** Each net's peak against the input amplitude (the swing simulation). */
export function swingSpec(plot) {
  const limit = swingLimit(plot.traces);
  const limitText = limit && (limit.kind === 'full-scale'
    ? `${limit.label ? `${plainTex(limit.label)} ` : ''}full scale ${Number(limit.a.toFixed(1))} dBFS`
    : `runaway ${Number(limit.a.toFixed(2))} dBFS`);
  return {
    key: 'swing',
    title: 'Peak against input amplitude',
    x: { scale: 'linear', label: 'input (dBFS)', range: [plot.range.low, plot.range.high], step: 10 },
    y: { scale: 'linear', label: 'peak (dBFS)', step: 10, include: [-10, 10], ceiling: 40, floor: -200 },
    series: plot.traces.map((trace) => ({
      label: trace.label,
      color: trace.color,
      role: 'curve',
      points: trace.points.map((p) => [p.a, Number.isFinite(p.db) ? p.db : null]),
    })),
    vlines: limit ? [{ x: limit.a, role: 'marker', label: limitText }] : [],
    hlines: [{ y: 0, role: 'zero' }],
  };
}

/** A root locus (locus.js `locusPlot`): the complex plane at equal scales. */
export function locusSpec(plot) {
  const z = plot.variable === 'z';
  const near = (p) => !z || Math.hypot(p.re, p.im) <= 2.5;
  const number = (v) => String(Number(v.toPrecision(3)));
  const notes = [{ text: `${plot.parameter} ${number(plot.from)} … ${number(plot.to)}`, role: 'label' }];
  const crossings = plot.crossings || [];
  if (crossings.length) {
    const stableFrom = crossings.find((c) => c.becomes === 'stable');
    const unstableAt = crossings.find((c) => c.becomes === 'unstable' && (!stableFrom || c.k !== stableFrom.k));
    notes.push({
      role: 'marker',
      text: stableFrom && unstableAt
        ? `stable for ${plot.parameter} ${number(Math.min(stableFrom.k, unstableAt.k))} … ${number(Math.max(stableFrom.k, unstableAt.k))}`
        : stableFrom ? `stable from ${plot.parameter} = ${number(stableFrom.k)}` : `unstable from ${plot.parameter} = ${number(unstableAt.k)}`,
    });
  }
  const shown = plot.points.filter(near);
  const reach = z ? [-1.1, 1.1] : [0];
  return {
    key: `locus:${plot.variable}`,
    title: 'Root locus',
    equal: true,
    x: { scale: 'linear', label: z ? 'Re z' : 'Re s', include: reach },
    y: { scale: 'linear', label: z ? 'Im z' : 'Im s', include: z ? [-1.1, 1.1] : [], symmetric: true },
    series: [
      ...(z ? [{ role: 'band', points: Array.from({ length: 97 }, (_, i) => [Math.cos((i * Math.PI) / 48), Math.sin((i * Math.PI) / 48)]), parametric: true }] : []),
      { label: plot.label, color: plot.color, role: 'curve', dots: shown.map((p) => p.t), points: shown.map((p) => [p.re, p.im]) },
    ],
    vlines: z ? [] : [{ x: 0, role: 'band' }],
    hlines: [{ y: 0, role: 'zero' }],
    crosses: plot.current.map((p) => ({ x: p.re, y: p.im })),
    notes,
  };
}

/**
 * A Bode sketch (bode.js `bodeSketch`) as two plots sharing their
 * frequency axis: the magnitude with its straight-line asymptotes and the
 * marked corners, and the phase. `corners`: `[{ w, text }]`.
 */
export function bodeSpecs(sketch, { corners = [], quantity = 'A_{v}', unityText = 'ω_{u}' } = {}) {
  const range = [pow10(sketch.range.low), pow10(sketch.range.high)];
  const marks = corners.filter((c) => c.w > 0).map((c) => ({ x: c.w, role: 'corner', label: c.text }));
  if (sketch.unityGain) marks.push({ x: sketch.unityGain.w, role: 'corner', label: unityText });
  return {
    magnitude: {
      key: 'bode:magnitude',
      title: 'Magnitude',
      x: { scale: 'log', label: 'ω (g/C)', range },
      y: { scale: 'linear', label: `|${quantity}| (dB)`, step: 20, floor: -400 },
      series: [
        { role: 'asymptote', points: sketch.asymptote.map((p) => [p.w, p.db]) },
        { role: 'curve', label: quantity, points: sketch.points.map((p) => [p.w, p.db]) },
      ],
      vlines: marks,
      hlines: [{ y: 0, role: 'zero' }],
    },
    phase: {
      key: 'bode:phase',
      title: 'Phase',
      x: { scale: 'log', label: 'ω (g/C)', range },
      y: { scale: 'linear', label: `∠${quantity} (°)`, step: 90 },
      series: [{ role: 'curve', label: quantity, points: sketch.points.map((p) => [p.w, p.phase]) }],
      vlines: marks.map((mark) => ({ ...mark, label: '' })),
      hlines: [-360, -180, 0, 180].map((y) => ({ y, role: 'zero' })),
    },
  };
}

/**
 * Waveforms in time (the time-domain plot): each net's samples against the
 * sample index n, or time t in units of T_s. `traces`: `[{ label, color,
 * values, stairs }]`; `start` is the first sample's n.
 */
export function waveSpec(traces, { start = 0, label = 'n' } = {}) {
  return {
    key: 'scope',
    title: 'Waveforms',
    x: { scale: 'linear', label },
    y: { scale: 'linear', label: 'value' },
    series: traces.map((trace) => ({
      label: trace.label,
      color: trace.color,
      role: 'curve',
      stairs: trace.stairs !== false,
      points: Array.from(trace.values, (v, i) => [start + i, Number.isFinite(v) ? v : null]),
    })),
    vlines: [],
    hlines: [{ y: 0, role: 'zero' }],
  };
}

/** The spec of any plot on the drawing that a window shows: an analysis
 *  plot with the traces added to it from files over its own, or a data
 *  plot. Null for a Bode sketch, which windows show as two plots. */
export function plotSpec(plot) {
  const spec = plot.kind === 'data' ? dataSpec(plot)
    : plot.kind === 'response' ? responseSpec(plot)
    : plot.kind === 'step' || plot.kind === 'wave' ? stepSpec(plot)
    : plot.kind === 'swing' ? swingSpec(plot)
    : plot.kind === 'locus' ? locusSpec(plot)
    : null;
  if (!spec || !plot.extra) return spec;
  const parametric = plot.kind === 'locus' ? { parametric: true } : {};
  return { ...withExtraRange(spec, plot), series: [...spec.series, ...plot.extra.map((trace) => ({ label: trace.label, color: trace.color, role: 'curve', points: trace.points.map(([x, y]) => [x, y]), ...parametric }))] };
}
