/**
 * A small-signal quantity as a Bode plot: its sketch at the Values (the
 * analysis window's sliders, `Circuit#analysisValues.bode`), and the
 * response plot the Plots window shows and an annotation draws. The window
 * (web/bode-ui.js) and `analyze bode` both build their plots here.
 *
 * Every g_m starts at one unit g, every r_o and resistor at g_m r_o units,
 * capacitors at one unit C (loads on the output at ten); a value scales any
 * of them. A_v, Z_in, and Z_out are drawn from the full model solved in
 * numbers at those values (a report's `numericModel`, engine.js
 * `numericSmallSignal`); the loop gain from its derived coefficients.
 */

import {
  DEFAULT_INTRINSIC_GAIN, DEFAULT_PARASITIC_RATIO, baseSymbols, bodeSketch, evaluateExpression, expressionSymbols, extendAsymptote, numericCoefficients,
  responseAt, sketchParameters, sketchValues, withDerivedValues,
} from './bode.js';
import { renderExpression } from './present.js';
import { negate } from './rational.js';
import { cornerNames } from '../bode-figure.js';

/** The quantities a trace can plot, by report key. */
export const BODE_QUANTITIES = {
  transfer: { name: 'Voltage gain', tex: 'A_{v}' },
  transimpedance: { name: 'Transimpedance', tex: 'Z_{m}' },
  transconductance: { name: 'Transconductance', tex: 'G_{m}' },
  currentGain: { name: 'Current gain', tex: 'A_{i}' },
  output: { name: 'Output impedance', tex: 'Z_{out}' },
  input: { name: 'Input impedance', tex: 'Z_{in}' },
  loop: { name: 'Loop gain', tex: 'T' },
};

// Solved in numbers from the exact model; the rest from their equations.
export const NUMERIC_KEYS = new Set(['transfer', 'transimpedance', 'transconductance', 'input', 'output']);

/** The Values a design's plots are drawn at (`analysisValues.bode`). */
export function bodeRatios(circuit) {
  const saved = circuit?.analysisValues?.bode;
  return {
    intrinsicGain: saved?.intrinsicGain || DEFAULT_INTRINSIC_GAIN,
    parasiticRatio: saved?.parasiticRatio || DEFAULT_PARASITIC_RATIO,
    multipliers: { ...(saved?.multipliers || {}) },
  };
}

/** Whether a design's plots draw their asymptotes (`windows.bode`). */
export const bodeAsymptotesShown = (circuit) => circuit?.windows?.bode?.asymptotes !== false;

function exactOf(report, key) {
  const exact = report?.reports?.[key]?.exact;
  return exact?.numeratorCoefficients && exact?.denominatorCoefficients ? exact : null;
}

/** The numbers model a trace is solved with, if any: the port quantities',
 *  or a loop gain's too large to keep its symbols. */
export function numericModelOf(report, key) {
  if (NUMERIC_KEYS.has(key)) return report.numericModel;
  if (key === 'loop' && report.loopNumericModel?.ok) return report.loopNumericModel;
  return null;
}

function outputComponents(circuit, report) {
  const netId = report?.outputPort?.netId;
  const net = netId && circuit?.nets.get(netId);
  return new Set(net ? net.terminals.map((terminal) => terminal.comp) : []);
}

/** A trace's parameters: every one its model stamps (each needs a value),
 *  and those the ports reach (the ones worth a slider). */
export function bodeParameters(circuit, { report, key }) {
  if (NUMERIC_KEYS.has(key) || numericModelOf(report, key)) {
    const model = numericModelOf(report, key);
    if (!model?.ok) return null;
    const all = sketchParameters(new Set(Object.keys(model.provenance)), model.provenance, { outputComponents: model.outputComponents });
    return { all, reached: all.filter((parameter) => model.reached.has(parameter.name)) };
  }
  // A loop gain solved at numbers: the parameters it was solved at.
  const loop = key === 'loop' ? report.reports?.loop : null;
  if (loop?.numeric && loop.parameters) {
    const all = sketchParameters(new Set(loop.parameters), loop.provenance || {}, { outputComponents: new Set(loop.outputComponents || []) });
    return { all, reached: all };
  }
  const exact = exactOf(report, key);
  if (!exact) return null;
  // A Miller capacitance (C_{M1,in}) is set by the values it is made of.
  const symbols = baseSymbols(new Set([...exact.numeratorCoefficients, ...exact.denominatorCoefficients]
    .flatMap(({ coefficient }) => [...expressionSymbols(coefficient)])), report.derivedSymbols);
  const all = sketchParameters(symbols, report.symbolProvenance || {}, { outputComponents: outputComponents(circuit, report) });
  return { all, reached: all };
}

const solved = new WeakMap(); // numericModel -> { key, result }
/** A report's numeric quantities at `values`: solved once per set of
 *  values, however often the plots redraw. */
export function numericAt(model, values) {
  const key = JSON.stringify(values);
  const memo = solved.get(model);
  if (memo?.key === key) return memo.result;
  const result = model.at(values);
  solved.set(model, { key, result });
  return result;
}

/** A trace ({ report, key }) at the Values `ratios`: { sketch, corners,
 *  values, response }, or null when it has nothing to plot (zero, or the
 *  same at every frequency). */
export function bodeSketchOf(circuit, trace, ratios) {
  const parameters = bodeParameters(circuit, trace);
  if (!parameters) return null;
  const values = withDerivedValues(sketchValues(parameters.all, ratios), trace.report.derivedSymbols);
  let sketch;
  let response;
  const model = numericModelOf(trace.report, trace.key);
  if (NUMERIC_KEYS.has(trace.key) || model) {
    const result = numericAt(model, values);
    const quantity = result.ok ? result.quantities[trace.key] : null;
    if (!quantity || quantity.zero || !(quantity.zeros.length || quantity.poles.length)) return null;
    sketch = bodeSketch(quantity.numerator, quantity.denominator, { roots: { zeros: quantity.zeros, poles: quantity.poles }, response: quantity.response });
    response = quantity.response;
  } else {
    const exact = exactOf(trace.report, trace.key);
    if (!exact || !(exact.numeratorDegree > 0 || exact.denominatorDegree > 0)) return null;
    const num = numericCoefficients(exact.numeratorCoefficients, values);
    const den = numericCoefficients(exact.denominatorCoefficients, values);
    sketch = bodeSketch(num, den);
    response = (omega) => responseAt(num, den, omega);
  }
  const corners = cornerNames(sketch.poles, sketch.zeros);
  // A corner whose factor is first order has its exact expression, when the
  // equations have it at the same place.
  const derived = trace.report.reports?.[trace.key] || {};
  const symbolic = [...(derived.poles || []).map((root) => ({ ...root, kind: 'pole' })),
    ...(derived.zeros || []).map((root) => ({ ...root, kind: 'zero' }))];
  for (const corner of corners) {
    for (const root of symbolic) {
      if (root.kind !== corner.kind || !root.root || root.order !== 1) continue;
      let value;
      try { value = evaluateExpression(root.root, values); } catch { continue; }
      if (Math.abs(Math.abs(value) - corner.w) <= 1e-6 * corner.w) {
        corner.tex = renderExpression(value < 0 ? negate(root.root) : root.root);
        break;
      }
    }
  }
  return { sketch, corners, values, response };
}

const POINTS_PER_DECADE = 40;

/** A sketch's straight-line magnitude or phase over `low`..`high` (decades
 *  of ω), as a response trace keeps it; the phase by as many turns as start
 *  it on the curve's `points`. */
function asymptoteOf(sketch, quantity, points, low, high) {
  const phase = quantity === 'phase';
  const line = extendAsymptote(phase
    ? (sketch.phaseAsymptote || []).map((p) => ({ w: p.w, value: p.phase }))
    : sketch.asymptote.map((p) => ({ w: p.w, value: p.db })), low, high);
  if (line.length < 2) return {};
  const turns = phase && Number.isFinite(points[0]?.db) ? Math.round((points[0].db - line[0].value) / 360) * 360 : 0;
  return { asymptote: line.map((p) => ({ f: p.w, db: p.value + turns })) };
}

/** The graph as a response plot (signal-flow.js `responsePlot`'s shape):
 *  what the Plots window and an annotation draw. Every sketch ({ trace:
 *  { label, color }, sketch, corners, response }) over the range they span
 *  together, each from its own exact response, and with `asymptotes` its
 *  straight-line asymptote run on over that range. */
export function bodeResponsePlot(sketches, quantity = 'magnitude', { asymptotes = true } = {}) {
  if (!sketches.length) return null;
  const low = Math.min(...sketches.map(({ sketch }) => sketch.range.low));
  const high = Math.max(low + 1, ...sketches.map(({ sketch }) => sketch.range.high));
  const grid = Array.from({ length: (high - low) * POINTS_PER_DECADE + 1 }, (_, i) => 10 ** (low + i / POINTS_PER_DECADE));
  // One trace: its corners marked, named as the window names them (four at
  // most, as a plot keeps); several traces' corners would be anyone's.
  const markers = sketches.length === 1
    ? sketches[0].corners.filter((corner) => corner.w >= 10 ** low && corner.w <= 10 ** high).slice(0, 4).map((corner) => ({ f: corner.w, label: corner.text }))
    : [];
  return {
    kind: 'response',
    axis: 'omega',
    range: { low, high },
    ...(markers.length ? { markers } : {}),
    ...(quantity === 'phase' ? { quantity: 'phase' } : {}),
    traces: sketches.map(({ trace, response, sketch }) => {
      let previous = null;
      const points = grid.map((f) => {
        const h = response(f);
        if (quantity !== 'phase') return { f, db: 20 * Math.log10(Math.hypot(h.re, h.im)) };
        // Unwrapped, as the sketch's own phase is.
        let phase = (Math.atan2(h.im, h.re) * 180) / Math.PI;
        if (previous !== null) {
          while (phase - previous > 180) phase -= 360;
          while (phase - previous < -180) phase += 360;
        }
        previous = phase;
        return { f, db: phase };
      });
      return { label: trace.label, color: trace.color, points, ...(asymptotes ? asymptoteOf(sketch, quantity, points, low, high) : {}) };
    }),
  };
}

/** A trace's label as the graph names it: A_v as V_out over V_in, an
 *  impedance by its port, the loop gain by where it is broken. */
export function bodeTraceLabel(report, key) {
  const nameOf = (port) => String(port?.name || port?.netId || '?');
  const input = nameOf(report.inputPort);
  const output = nameOf(report.outputPort);
  const element = report.reports?.loop?.element || '';
  return key === 'transfer' ? `\\frac{${output}}{${input}}`
    : key === 'output' ? `Z_{out}(${output})`
      : key === 'input' ? `Z_{in}(${input})`
        : key === 'loop' ? (report.reports?.loop?.infinite ? `\\beta_{${element}}` : element ? `T_{${element}}` : 'T')
          : BODE_QUANTITIES[key].tex;
}
