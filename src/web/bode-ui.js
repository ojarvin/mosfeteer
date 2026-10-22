/**
 * The small-signal analysis's Bode plots, laid out as the signal-flow
 * analysis lays out its own: the graph in the Plots window (plots-window.js,
 * Shift+W), its traces kept across derives so responses -- a gain and a
 * supply's way to the output, say -- can be set side by side, and the
 * numbers they are drawn at under **Values** in the analysis window, a
 * slider and a field for each.
 *
 * Every g_m starts at one unit g, every r_o and resistor at g_m r_o units,
 * capacitors at one unit C (loads on the output at ten); a value scales any
 * of them. A_v, Z_in, and Z_out are drawn from the full model solved in
 * numbers at those values (a report's `numericModel`, engine.js
 * `numericSmallSignal`): the plot is the deliverable, so it does not wait
 * on the symbolic solve, fail with it, or take its approximations. The
 * loop gain is drawn from its derived coefficients.
 */

import { PER_DECADE } from './e-series.js';
import {
  DEFAULT_INTRINSIC_GAIN, DEFAULT_PARASITIC_RATIO, baseSymbols, bodeSketch, evaluateExpression, expressionSymbols, numericCoefficients,
  responseAt, sketchParameters, sketchValues, withDerivedValues,
} from '../core/analysis/bode.js';
import { TRACE_COLORS } from '../core/analysis/signal-flow.js';
import { renderExpression } from '../core/analysis/present.js';
import { negate } from '../core/analysis/rational.js';
import { cornerNames } from '../core/bode-figure.js';
import { axisName, bodeSpecs, responseSpec } from '../core/plot-spec.js';
import { createPlotView, linkPlots } from './plot-view.js';
import { valueRow as sharedValueRow } from './value-row.js';
import { texToMathML } from '../core/render.js';
import { element as el } from './dom.js';
import { editor } from './editor-state.js';
import { markSettingsChanged, onDocumentShown, render } from './main.js';
import { logLine } from './status-bar-ui.js';
import { installPlotsWindow, offerPlots, plotsShown } from './plots-window.js';
import { placeResponsePlot } from './signal-flow-ui.js';
import { registerAnnotations } from './annotate-menu.js';

const QUANTITIES = {
  transfer: { name: 'Voltage gain', tex: 'A_{v}' },
  transimpedance: { name: 'Transimpedance', tex: 'Z_{m}' },
  transconductance: { name: 'Transconductance', tex: 'G_{m}' },
  currentGain: { name: 'Current gain', tex: 'A_{i}' },
  output: { name: 'Output impedance', tex: 'Z_{out}' },
  input: { name: 'Input impedance', tex: 'Z_{in}' },
  loop: { name: 'Loop gain', tex: 'T' },
};
// Solved in numbers from the exact model; the rest from their equations.
const NUMERIC_KEYS = new Set(['transfer', 'transimpedance', 'transconductance', 'input', 'output']);
// The form's transfer functions (A_v, Z_m, G_m, A_i) as the graph's quantities.
const TRANSFER_KEYS = { Av: 'transfer', Zm: 'transimpedance', Gm: 'transconductance', Ai: 'currentGain' };

/** The transfer functions a derive asked for, as quantities, in the form's
 *  order; the voltage gain when it asked for none. */
function requestedKeys(report) {
  const names = Array.isArray(report?.transferFunctions) ? report.transferFunctions : ['Av'];
  const keys = names.map((name) => TRANSFER_KEYS[name]).filter(Boolean);
  return keys.length ? keys : ['transfer'];
}
const KIND_ORDER = ['transconductance', 'resistance', 'capacitance', 'inductance', 'other'];

/**
 * The graph's traces, kept across derives: { id, key (a QUANTITIES key),
 * label (TeX), color, report (the derive it came from), on }. The latest
 * report is the one the Add buttons offer quantities from.
 */
let traces = [];
let latest = null;

/** The values the plots are drawn at (Circuit#analysisValues.bode). */
const ratios = { intrinsicGain: DEFAULT_INTRINSIC_GAIN, parasiticRatio: DEFAULT_PARASITIC_RATIO, multipliers: {} };

function loadRatios() {
  const saved = editor.circuit.analysisValues?.bode;
  ratios.intrinsicGain = saved?.intrinsicGain || DEFAULT_INTRINSIC_GAIN;
  ratios.parasiticRatio = saved?.parasiticRatio || DEFAULT_PARASITIC_RATIO;
  ratios.multipliers = { ...(saved?.multipliers || {}) };
}

let saveFrame = 0;
/** Keep the values with the document, once a frame while a slider moves. */
function saveRatios() {
  if (saveFrame) return;
  saveFrame = requestAnimationFrame(() => {
    saveFrame = 0;
    const defaults = ratios.intrinsicGain === DEFAULT_INTRINSIC_GAIN && ratios.parasiticRatio === DEFAULT_PARASITIC_RATIO && !Object.keys(ratios.multipliers).length;
    editor.circuit.analysisValues.bode = defaults ? null : { intrinsicGain: ratios.intrinsicGain, parasiticRatio: ratios.parasiticRatio, multipliers: { ...ratios.multipliers } };
    markSettingsChanged();
  });
}

/** A number as a reader wants it: 3 significant figures, powers of ten when
 *  it is very large or small. */
function formatNumber(value) {
  if (!Number.isFinite(value)) return String(value);
  const magnitude = Math.abs(value);
  if (magnitude !== 0 && (magnitude < 1e-2 || magnitude >= 1e4)) {
    let exponent = Math.floor(Math.log10(magnitude));
    let mantissa = Number((value / 10 ** exponent).toPrecision(2));
    // 9.98 rounds to 10: that is the next power.
    if (Math.abs(mantissa) >= 10) {
      mantissa /= 10;
      exponent += 1;
    }
    return `${mantissa}·10^{${exponent}}`;
  }
  return String(Number(value.toPrecision(3)));
}

function mathElement(tex, tag = 'span') {
  const element = document.createElement(tag);
  element.className = 'bode-math';
  element.innerHTML = texToMathML(tex);
  return element;
}

// ----- the model ---------------------------------------------------------------------

function exactOf(report, key) {
  const exact = report?.reports?.[key]?.exact;
  return exact?.numeratorCoefficients && exact?.denominatorCoefficients ? exact : null;
}

/** A trace's parameters: every one its model stamps (each needs a value),
 *  and those the ports reach (the ones worth a slider). */
function parametersOf(trace) {
  const { report, key } = trace;
  if (NUMERIC_KEYS.has(key)) {
    const model = report.numericModel;
    if (!model?.ok) return null;
    const all = sketchParameters(new Set(Object.keys(model.provenance)), model.provenance, { outputComponents: model.outputComponents });
    return { all, reached: all.filter((parameter) => model.reached.has(parameter.name)) };
  }
  const exact = exactOf(report, key);
  if (!exact) return null;
  // A Miller capacitance (C_{M1,in}) is set by the values it is made of.
  const symbols = baseSymbols(new Set([...exact.numeratorCoefficients, ...exact.denominatorCoefficients]
    .flatMap(({ coefficient }) => [...expressionSymbols(coefficient)])), report.derivedSymbols);
  const all = sketchParameters(symbols, report.symbolProvenance || {}, { outputComponents: outputComponents(report) });
  return { all, reached: all };
}

function outputComponents(report) {
  const netId = report?.outputPort?.netId;
  const net = netId && editor.circuit.nets.get(netId);
  return new Set(net ? net.terminals.map((terminal) => terminal.comp) : []);
}

const solved = new WeakMap(); // numericModel -> { key, result }
/** A report's numeric quantities at `values`: solved once per set of
 *  values, however often the plots redraw. */
function numericAt(model, values) {
  const key = JSON.stringify(values);
  const memo = solved.get(model);
  if (memo?.key === key) return memo.result;
  const result = model.at(values);
  solved.set(model, { key, result });
  return result;
}

/** A trace at the current values: { sketch, corners, values } or null when
 *  it has nothing to plot (zero, or the same at every frequency). */
function sketchOf(trace) {
  const parameters = parametersOf(trace);
  if (!parameters) return null;
  const values = withDerivedValues(sketchValues(parameters.all, ratios), trace.report.derivedSymbols);
  let sketch;
  let response;
  if (NUMERIC_KEYS.has(trace.key)) {
    const result = numericAt(trace.report.numericModel, values);
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

/** Whether `key` of a report has anything to plot. */
function plottable(report, key) {
  if (!report) return false;
  return !!sketchOf({ report, key });
}

// ----- traces -------------------------------------------------------------------------

/** A net's name for a trace's label, as signal flow writes its ratios. */
const nameOf = (port) => String(port?.name || port?.netId || '?');

function traceOf(report, key) {
  const input = nameOf(report.inputPort);
  const output = nameOf(report.outputPort);
  const element = report.reports?.loop?.element || report.analysisOptions?.loopElement || '';
  const label = key === 'transfer' ? `\\frac{${output}}{${input}}`
    : key === 'output' ? `Z_{out}(${output})`
      : key === 'input' ? `Z_{in}(${input})`
        : key === 'loop' ? (report.reports?.loop?.infinite ? `\\beta_{${element}}` : `T_{${element}}`)
          : QUANTITIES[key].tex;
  // One trace per quantity between the same nets: a newer derive replaces it.
  return { id: `${key}\n${input}\n${output}\n${key === 'loop' ? element : ''}`, key, label, report, on: true };
}

function addTrace(report, key) {
  const fresh = traceOf(report, key);
  const old = traces.find((trace) => trace.id === fresh.id);
  if (old) {
    old.report = report;
    old.label = fresh.label;
    return;
  }
  const used = new Set(traces.map((trace) => trace.color));
  fresh.color = TRACE_COLORS.find((color) => !used.has(color)) || TRACE_COLORS[traces.length % TRACE_COLORS.length];
  traces.push(fresh);
}

const shownTraces = () => traces.filter((trace) => trace.on);

// ----- the Plots window ------------------------------------------------------------------

let plotsEl = null;
// Magnitude over phase, one frequency axis: the two plots pan and zoom
// along x together, and only the lower one numbers it.
let graphs = null;
function stackedGraphs() {
  if (!graphs) {
    graphs = {
      magnitude: createPlotView({ height: 200, aspect: 0.42, xAxis: false, className: 'bode-magnitude' }),
      phase: createPlotView({ height: 140, aspect: 0.3, className: 'bode-phase' }),
    };
    linkPlots(graphs.magnitude, graphs.phase);
  }
  return graphs;
}


/** The sketches of the shown traces, at the current values. */
function shownSketches() {
  return shownTraces().map((trace) => ({ trace, ...(sketchOf(trace) || {}) })).filter((entry) => entry.sketch);
}

const POINTS_PER_DECADE = 40;

/** The graph as a response plot (signal-flow.js `responsePlot`'s shape):
 *  what the Plots window and an annotation draw. Every trace over the range
 *  they span together, each from its own exact response. */
function responsePlotOf(sketches, quantity = 'magnitude') {
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
    traces: sketches.map(({ trace, response }) => {
      let previous = null;
      return {
        label: trace.label,
        color: trace.color,
        points: grid.map((f) => {
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
        }),
      };
    }),
  };
}

/** One trace shown: its textbook sketch, asymptote and corners marked;
 *  several: their curves together. */
function graphSpec(sketches, quantity) {
  if (sketches.length === 1) {
    const [{ trace, sketch, corners }] = sketches;
    const spec = bodeSpecs(sketch, { corners, quantity: axisName(trace.label), ...(trace.key === 'loop' ? { unityText: 'ω_{c}' } : {}) })[quantity];
    return { ...spec, key: `bode:${quantity}:${trace.id}`, series: spec.series.map((series) => (series.role === 'curve' ? { ...series, color: trace.color } : series)) };
  }
  const spec = responseSpec(responsePlotOf(sketches, quantity));
  return { ...spec, key: `bode:${quantity}:traces`, x: { ...spec.x, label: 'ω (g/C)' }, series: spec.series.map((series) => (series.label ? { ...series, label: axisName(series.label) } : series)) };
}

/** A slider is being moved: the corner lists keep their height till it is let go. */
let sliding = false;

function renderPlots() {
  if (!plotsEl) return;
  const head = plotsEl.querySelector('.bode-plots-head');
  const host = plotsEl.querySelector('.bode-plots-graph');
  const empty = plotsEl.querySelector('.bode-plots-empty');
  const list = plotsEl.querySelector('.bode-corners');
  empty.hidden = traces.length > 0;
  head.hidden = !traces.length && !latest;
  head.replaceChildren(addButtons());
  if (sliding) list.style.minHeight = `${Math.max(parseFloat(list.style.minHeight) || 0, list.offsetHeight)}px`;
  list.replaceChildren();
  const sketches = shownSketches();
  // The plots stay in place while they redraw (a zoomed view stays too).
  const { magnitude, phase } = stackedGraphs();
  if (sketches.length) {
    if (magnitude.el.parentNode !== host) host.replaceChildren(magnitude.el, phase.el);
    magnitude.set(graphSpec(sketches, 'magnitude'));
    phase.set(graphSpec(sketches, 'phase'));
  } else {
    host.replaceChildren(el('p', { class: 'field-hint', text: traces.length ? 'Check a trace below to plot it.' : '' }));
  }
  renderLegend();
  for (const entry of sketches) appendCorners(list, entry, sketches.length > 1);
}

/** The latest derive's quantities, each a switch: pressed while its trace
 *  is on the graph, pressed again to take it off. */
function addButtons() {
  const row = el('div', { class: 'bode-add', role: 'group', 'aria-label': 'On the graph' });
  if (!latest) return row;
  // The transfer functions asked for, the voltage gain (always solved), the
  // ports' impedances, the loop gain.
  for (const key of [...new Set([...requestedKeys(latest), 'transfer', 'output', 'input', 'loop'])]) {
    if (!plottable(latest, key)) continue;
    const id = traceOf(latest, key).id;
    const on = traces.some((trace) => trace.id === id);
    row.append(el('button', {
      type: 'button',
      class: 'bode-add-toggle',
      text: QUANTITIES[key].name,
      'aria-pressed': String(on),
      title: on ? 'On the graph: press to take it off' : `Put the last Derive's ${QUANTITIES[key].name.toLowerCase()} on the graph`,
      onclick: () => {
        if (on) traces = traces.filter((trace) => trace.id !== id);
        else addTrace(latest, key);
        renderValues();
        renderPlots();
      },
    }));
  }
  return row;
}

function renderLegend() {
  const legend = plotsEl.querySelector('.bode-legend');
  legend.replaceChildren();
  for (const trace of traces) {
    const check = el('input', { type: 'checkbox', 'aria-label': 'Show this trace' });
    check.checked = trace.on;
    check.addEventListener('change', () => { trace.on = check.checked; renderPlots(); });
    const math = el('span', { class: 'signal-flow-legend-math' });
    math.innerHTML = texToMathML(trace.label);
    math.style.color = trace.color;
    const remove = el('button', { type: 'button', class: 'signal-flow-legend-remove', 'aria-label': 'Remove this trace', title: 'Remove this trace from the graph', text: '×', onclick: () => { traces = traces.filter((t) => t !== trace); renderValues(); renderPlots(); } });
    legend.append(el('div', { class: 'signal-flow-legend-row' }, [check, el('span', { class: 'signal-flow-swatch', style: `background:${trace.color}` }), math, remove]));
  }
  const actions = plotsEl.querySelector('.bode-plots-actions');
  actions.hidden = !traces.length;
  actions.replaceChildren(
    el('button', { type: 'button', text: 'Clear graph', onclick: () => { traces = []; renderValues(); renderPlots(); } }),
    el('button', { type: 'button', text: 'Annotate graph', title: 'Annotate the graph', disabled: !shownTraces().length, onclick: () => annotateGraph() }),
    el('label', { class: 'bode-phase-toggle' }, [
      Object.assign(el('input', { type: 'checkbox', 'aria-label': 'Annotate the phase too' }), { checked: withPhase, onchange: (ev) => { withPhase = ev.target.checked; } }),
      ' with phase',
    ]),
  );
}

/** A trace's corners, its unity-gain or crossover, and what it was solved by. */
function appendCorners(list, { trace, sketch, corners }, named) {
  if (named) {
    const head = el('li', { class: 'bode-corners-trace' });
    head.append(mathElement(trace.label));
    head.firstChild.style.color = trace.color;
    list.append(head);
  }
  for (const corner of corners) {
    const item = el('li');
    const where = `${formatNumber(corner.w)}\\,g/C`;
    const name = corner.text.replace('ω', '\\omega');
    item.append(mathElement(corner.tex ? `${name} = ${corner.tex} \\approx ${where}` : `${name} \\approx ${where}`));
    if (corner.rightHalf) item.append(' (right half-plane)');
    if (Math.abs(corner.root.im) > 0) item.append(` (complex pair, Q = ${formatNumber(corner.w / (2 * Math.abs(corner.root.re)))})`);
    list.append(item);
  }
  if (sketch.canceled) {
    list.append(el('li', { class: 'bode-canceled', text: `${sketch.canceled} pole–zero pair${sketch.canceled === 1 ? '' : 's'} of the exact solution cancel exactly and are left out` }));
  }
  if (trace.key === 'loop' && !trace.report.reports?.loop?.infinite) {
    const item = el('li');
    if (sketch.unityGain) {
      let phase = sketch.unityGain.phase % 360;
      if (phase > 0) phase -= 360;
      const margin = 180 + phase;
      item.append(mathElement(`\\omega_{c} \\approx ${formatNumber(sketch.unityGain.w)}\\,g/C,\\ \\text{phase margin } ${Math.round(margin)}\\text{°}`));
      if (margin < 0) item.classList.add('analysis-error');
    } else {
      item.textContent = 'No crossover: |T| does not pass 1 at these values.';
    }
    list.append(item);
    // Too large for every symbol, the loop was solved at these values' numbers.
    if (trace.report.reports?.loop?.numeric) list.append(el('li', { class: 'bode-canceled', text: 'Too large to solve with every symbol: T was solved at the values as they were at its Derive; derive again after changing one.' }));
  }
  if (sketch.unityGain && trace.key === 'transfer') {
    list.append(el('li', {}, [mathElement(`\\omega_{u} \\approx ${formatNumber(sketch.unityGain.w)}\\,g/C,\\ \\text{phase there } ${Math.round(sketch.unityGain.phase)}\\text{°}`)]));
  }
}

// Annotate graph puts the phase on the drawing too, as a plot of its own.
let withPhase = false;

/** The graph on the drawing: its magnitude, and with `phase` its phase. */
function annotateGraph({ phase = withPhase, magnitude = true } = {}) {
  const sketches = shownSketches();
  const traces = sketches.map(({ trace }) => trace);
  for (const quantity of [...(magnitude ? ['magnitude'] : []), ...(phase ? ['phase'] : [])]) {
    const plot = responsePlotOf(sketches, quantity);
    if (plot) placeResponsePlot(plot, traces, { source: 'small-signal' });
  }
}


// ----- Values, in the analysis window ------------------------------------------------------

let valuesEl = null;
let shownRows = '';

/** One value's row, as a signal-flow coefficient's: its name, a slider
 *  through the E24 steps, and a field for any positive number. */
/** A Values row (value-row.js), its components emphasized while hovered. */
function valueRow({ components = [], ...options }) {
  const row = sharedValueRow({
    ...options,
    className: 'bode-value',
    onSlide: (taken) => {
      sliding = taken;
      if (taken) return;
      const list = plotsEl?.querySelector('.bode-corners');
      if (list) list.style.minHeight = '';
    },
  });
  if (components.length) {
    row.addEventListener('pointerenter', () => emphasize(components));
    row.addEventListener('pointerleave', () => emphasize([]));
  }
  return row;
}

function emphasize(components) {
  const next = components.filter(Boolean);
  if (next.join(' ') === editor.equationEmphasis.join(' ')) return;
  editor.equationEmphasis = next;
  render();
}

/** Every parameter the graph's traces reach, each once. */
function graphParameters() {
  const byName = new Map();
  for (const trace of traces) for (const parameter of parametersOf(trace)?.reached || []) if (!byName.has(parameter.name)) byName.set(parameter.name, parameter);
  return [...byName.values()];
}

/** The Values rows: rebuilt only when the parameters change, so a slider
 *  being dragged is never replaced under the pointer. */
function renderValues({ force = false } = {}) {
  if (!valuesEl) return;
  const parameters = graphParameters();
  valuesEl.hidden = !traces.length;
  const parasitic = parameters.some((parameter) => parameter.parasitic);
  const own = parameters.filter((parameter) => !parameter.parasitic)
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  const key = `${parasitic}\n${own.map((parameter) => parameter.name).join('\n')}`;
  const rows = valuesEl.querySelector('.bode-value-rows');
  if (!force && key === shownRows && rows.children.length) return;
  shownRows = key;
  const changed = () => { saveRatios(); renderPlots(); };
  rows.replaceChildren(
    valueRow({
      name: 'Intrinsic gain g_m r_o', tex: 'g_{m} r_{o}', value: ratios.intrinsicGain, min: 0, max: 4 * PER_DECADE,
      title: 'r_o in units of 1/g',
      onValue: (value) => { ratios.intrinsicGain = value; changed(); },
    }),
    ...(parasitic ? [valueRow({
      name: 'Parasitic capacitance', tex: 'C_{par}/C', value: ratios.parasiticRatio, min: -2 * PER_DECADE, max: PER_DECADE,
      title: 'Every MOS C_gs and C_gd, in units of C',
      onValue: (value) => { ratios.parasiticRatio = value; changed(); },
    })] : []),
    ...own.map((parameter) => valueRow({
      name: parameter.name,
      tex: `${parameter.tex}\\ \\times`,
      value: ratios.multipliers[parameter.name] ?? 1,
      min: -3 * PER_DECADE,
      max: 3 * PER_DECADE,
      components: [parameter.component],
      title: parameter.load ? 'A load on the output: starts at 10 units' : '',
      onValue: (value) => {
        if (value === 1) delete ratios.multipliers[parameter.name];
        else ratios.multipliers[parameter.name] = value;
        changed();
      },
    })),
  );
}

// ----- the analysis window's side ------------------------------------------------------

/**
 * A new report: its gain (and its loop gain, if asked for) joins the graph,
 * beside what is there, and the Plots window opens unless it was closed
 * since. Returns whether anything of it can be plotted.
 */
export function renderBode(report) {
  if (report && report !== latest) {
    latest = report;
    loadRatios();
    // The first transfer function asked for goes on the graph (the voltage
    // gain when none can be plotted: a current into a gate), with the loop gain.
    const first = [...requestedKeys(report), 'transfer'].find((key) => plottable(report, key));
    for (const key of [first, 'loop']) if (key && plottable(report, key)) addTrace(report, key);
    renderValues({ force: true });
    renderPlots();
    if (traces.length) offerPlots();
  } else if (!report) {
    latest = null;
    renderPlots();
  }
  return traces.length > 0;
}

/** The values came back from undo or redo: draw the plots at them again. */
export function bodeSettingsRestored() {
  loadRatios();
  renderValues({ force: true });
  renderPlots();
}

/** Another document: none of the last one's traces. */
function clearBode() {
  traces = [];
  latest = null;
  renderValues({ force: true });
  renderPlots();
}

/** The Values in the analysis window, and the circuit's view in the Plots
 *  window. */
export function installBodeUi() {
  // The graph, in the analysis window's Annotate menu.
  registerAnnotations('circuit', () => [
    { label: 'Bode magnitude', identity: { kind: 'plot', source: 'small-signal', key: /^response::/ }, available: shownTraces().length > 0, run: () => annotateGraph({ phase: false }) },
    { label: 'Bode phase', identity: { kind: 'plot', source: 'small-signal', key: /^response:phase:/ }, available: shownTraces().length > 0, run: () => annotateGraph({ phase: true, magnitude: false }) },
  ]);
  const result = document.getElementById('analysis-result');
  if (result && !document.getElementById('analysis-values')) {
    valuesEl = el('fieldset', { id: 'analysis-values', class: 'analysis-approximations bode-values', hidden: true }, [
      el('legend', { text: 'Values' }),
      el('div', { class: 'bode-value-rows' }),
      el('p', { class: 'field-hint', text: 'The plots use these values with the exact model; the equations stay symbolic. gm starts at one unit g, capacitors at one unit C (output loads at 10), ro and resistors at gm·ro; frequency is in g/C.' }),
      el('div', { class: 'bode-values-actions' }, [
        el('button', {
          type: 'button',
          text: 'Reset values',
          onclick: () => {
            Object.assign(ratios, { intrinsicGain: DEFAULT_INTRINSIC_GAIN, parasiticRatio: DEFAULT_PARASITIC_RATIO, multipliers: {} });
            editor.circuit.analysisValues.bode = null;
            markSettingsChanged();
            renderValues({ force: true });
            renderPlots();
          },
        }),
      ]),
    ]);
    result.after(valuesEl);
  }
  plotsEl = el('div', { class: 'bode-plots-view' }, [
    el('p', { class: 'field-hint bode-plots-empty', text: 'Derive in the analysis window (Shift+S) to plot its gain here.' }),
    el('div', { class: 'signal-flow-graph-head bode-plots-head' }),
    el('div', { class: 'bode-plots-graph' }),
    el('div', { class: 'signal-flow-legend bode-legend' }),
    el('div', { class: 'signal-flow-graph-actions bode-plots-actions', hidden: true }),
    el('ul', { class: 'bode-corners' }),
  ]);
  installPlotsWindow({ mode: 'circuit', view: plotsEl, shown: renderPlots });
  onDocumentShown(clearBode);
}

/** For tests and the console: what the graph holds. */
export function bodeSnapshot() {
  return {
    traces: traces.map((trace) => ({ id: trace.id, key: trace.key, label: trace.label, color: trace.color, on: trace.on })),
    values: { ...ratios, multipliers: { ...ratios.multipliers } },
    plotsShown: plotsShown(),
    // The magnitude's and the phase's x view: one axis, so always the same.
    xRanges: graphs ? [graphs.magnitude.xRange(), graphs.phase.xRange()] : null,
  };
}
