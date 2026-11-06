/**
 * The analysis window's signal-flow mode (core/analysis/signal-flow.js): for a
 * block diagram rather than a circuit. A switch at the top of the window
 * chooses the mode -- a drawing of signal-flow parts and no devices opens in
 * it -- and this mode has its own fields, results, and actions, so the
 * small-signal form is untouched by it.
 *
 * The user picks the output signal and sets every source -- an input port or
 * any wire nothing drives -- to input, zero, or a constant. Derive shows each
 * input's transfer function to the output and its poles and zeros. The plots
 * are in a window of their own (plots-window.js), a view per tab: numeric
 * results go onto one graph of magnitude, phase, or step responses, a color
 * per trace, kept across derives so responses can be compared; then the root
 * locus, the swing, the loop gain (offered only for a diagram with feedback),
 * and the nets in time (time-plot.js). Annotate graph puts a graph on the
 * drawing with its legend, Annotate equations the equations, and Annotate
 * coefficients the coefficients' numbers as a table.
 */

import { MUTED_TRACE_COLOR, TRACE_COLORS, ditherSymbols, outputChoices, analyzeSignalFlow, bandEdges, bandSqnr, complexText, diagramSymbols, hasSignalFlow, loopBreakSignals, loopGain, loopMargins, responseCurve, transferTex, numericRootsOf, responsePlot, resultSymbols, sampledEquation, signalFlowGraph, withCoefficients } from '../core/analysis/signal-flow.js';
import { symbolText } from '../core/analysis/present.js';
import { linkMakesCycle, parseCoefficientLink, parseCoefficientNumber, parseCoefficientVectors, resolveCoefficients } from '../core/analysis/coefficient-links.js';
import { PER_DECADE, indexE24, stepE24 } from './e-series.js';
import { locusSpec, responseSpec, stepSpec, swingSpec } from '../core/plot-spec.js';
import { createPlotView, linkPlots } from './plot-view.js';
import { arriving } from './motion.js';
import { installTimePlot, runTime, timeChanged, timePlotUpdate, timeSection } from './time-plot.js';
import { installPlotsWindow, offerPlots, plotsBusy, plotsShown, setPlotsMode, showPlots } from './plots-window.js';
import { afterPaint } from './busy-indicator.js';
import { stepPlot } from '../core/analysis/step.js';
import { locusPlot, locusSteps, rootLocus } from '../core/analysis/locus.js';
import { dbfsOffset, dbfsSpectrum, inBand, plotSpectrum } from '../core/analysis/spectrum.js';
import { prepareSimulation, sweepAmplitudes } from '../core/analysis/simulate.js';
import { PLOT_LEGEND_ROLE, PLOT_LEGEND_SAMPLE_ROOM, normalizePlot, parseLabelRuns } from '../core/model.js';
import { PLOT_BOX, replaceDataPlotTraces } from '../core/data-plot.js';
import { texToMathML } from '../core/render.js';
import { GRID, snap } from '../core/grid.js';
import { chooseFigure, newFigureId, placeFigure, plotKey, settlePlaced } from '../core/figures.js';
import { annotateMathFigure, writeMathFigure } from './figure-annotate.js';
import { registerAnnotations, setAnnotationMode } from './annotate-menu.js';
import { editor } from './editor-state.js';
import { analysisDialog } from './elements.js';
import { alignLabelColumn, commit, markSettingsChanged, onDocumentShown, render, revisionCurrent, selectedLabels, setLabelSelection, setSelection } from './main.js';
import { logLine } from './status-bar-ui.js';
import { buttonIcon } from './icons.js';
import { optimizeSection, renderOptimize, resetOptimize } from './optimize-ui.js';
import { swingTestFrequency } from '../core/analysis/optimize.js';
import { fractionText } from '../core/analysis/rounding.js';
import { normalizeBand } from '../core/analysis/optimize-setup.js';
import { element as el, mathSpan, onFieldCommit } from './dom.js';
import { netPicker } from './net-picker.js';
import { deriving } from './analysis-busy.js';
import { startWorker } from './worker-thread.js';
import { differing, differingNames, heldName, heldNumber, holdButton, holdKey, liveName, saveHolds, savedHolds, traceLegendRow } from './trace-hold.js';
import { installSweepPlot, showSweep, sweepPlotUpdate, sweepSection } from './sweep-plot.js';
import { simulatedSpectrum } from '../core/analysis/spectrum-run.js';

// Devices the small-signal analysis models: a drawing with any opens in it.
const CIRCUIT_TYPES = /^(nmos|pmos|nmosb|pmosb|npn|pnp|resistor|capacitor|inductor|current_source|voltage_source|vccs|vcvs|impedance|opamp|opamp_diff|opamp_diff_cmfb|gm|gm_cmfb|diode)$/;

let mode = null; // 'circuit' | 'signal-flow' | a registered mode; chosen per opening unless switched
let chosenThisSession = false;
// The mode's settings, kept in the document so it reopens as it was left:
// the output, each source's mode (source id -> 'input' | 'zero' |
// { constant }), and the swing's source and frequency.
const flow = () => (editor.circuit.analysisValues.flow ||= { output: '', sources: {}, swingInput: '', swingFrequency: '' });
let latest = null;
// The graph's traces, kept across derives: { id, label (TeX), color, value, variable, on }.
// A held one (`held: { values, base, key }`) is a copy worked out at the
// numbers it was held at; it stays while the sliders move the live one.
let traces = [];
// Held traces and spectra are saved with the design (trace-hold.js): a
// held spectrum is its record, { key, kind: 'spectrum', points, values,
// amplitude, color, on }; a held trace is made from its record as the trace
// it was held from comes back.
const holds = () => savedHolds('signal-flow');
const heldSpectraList = () => holds().filter((record) => record.kind === 'spectrum');
/** The held records changed (a hold, a removal, a box ticked): saved. */
const holdsChanged = (records = holds()) => saveHolds('signal-flow', records);
// Whether the live simulated spectrum is drawn (its legend row's box): hidden, it still runs.
let liveSpectrumOn = true;
// Numbers for the symbols in the results (a_1, k), 1 until set: the graph and
// the numeric poles and zeros use them. Kept in the document, so a drawing
// opens with the numbers it was left at.
const coefficients = () => editor.circuit.analysisValues.coefficients;
// Linked coefficients (c_1 = b_1) and every coefficient's number through them.
const links = () => (editor.circuit.analysisValues.links ||= {});
// Every symbol the diagram reads has a number: one never set shows 1 on its
// slider, so it is 1 here too (a fresh diagram simulates and optimizes as shown).
let symbolDefaults = { circuit: null, revision: -1, values: {} };
function defaultCoefficients() {
  if (symbolDefaults.circuit !== editor.circuit || symbolDefaults.revision !== editor.modelRevision) {
    symbolDefaults = { circuit: editor.circuit, revision: editor.modelRevision, values: Object.fromEntries(diagramSymbols(editor.circuit).map((name) => [name, 1])) };
  }
  return symbolDefaults.values;
}
const resolved = () => resolveCoefficients({ ...defaultCoefficients(), ...coefficients() }, links());
// Coefficients written as fractions m/n (rounded, or typed so): their text.
const fractions = () => (editor.circuit.analysisValues.fractions ||= {});
/** A coefficient as written: its fraction, else its number. */
const coefficientText = (name, value) => fractions()[name] || String(value);
let modeBar = null;
let section = null;
let plots = null; // the Plots window's content (plots-window.js)
let actions = null; // this mode's buttons, in the window's own footer
let derivedRevision = -1;


// The window's plots (plot-view.js), kept across redraws so a zoomed view
// stays zoomed while the numbers change.
const plotViews = {};
function plotView(name) {
  if (!plotViews[name]) {
    // Wider window, taller plot; the loop's phase a shorter band under its magnitude.
    plotViews[name] = createPlotView(name === 'loop-phase' ? { height: 150, aspect: 0.38 } : { aspect: 0.6 });
    if (name === 'loop-phase') linkPlots(plotView('loop-magnitude'), plotViews[name]);
  }
  return plotViews[name];
}

/** A graph's spec; a response redraws its curves for a zoomed range
 *  (`detailed(range)` returns the plot sampled there). */
function graphSpec(plot, detailed = null) {
  if (plot.kind === 'step') return stepSpec(plot);
  const spec = responseSpec(plot);
  if (detailed) spec.refine = (range) => { const close = detailed(range); return close ? responseSpec(close).series : null; };
  return spec;
}

function circuitParts() {
  return [...editor.circuit.components.values()].filter((component) => CIRCUIT_TYPES.test(component.type)).length;
}

// Modes of their own beside these two, each from its module
// (switched-cap-ui.js): { mode, label, hint, title, section, actions,
// suggested(circuit), shown() }.
const extraModes = [];

/** Add a mode to the window: its button on the mode bar, its section after
 *  the others, its buttons in the footer. */
export function registerAnalysisMode(spec) {
  extraModes.push(spec);
  modeBar.append(el('button', { type: 'button', 'data-mode': spec.mode, text: spec.label, title: spec.hint, onclick: () => setMode(spec.mode, { user: true }) }));
  const after = extraModes.length > 1 ? extraModes.at(-2).section : section;
  after.after(spec.section);
  for (const button of spec.actions) if (button.dataset.icon && !button.querySelector('.button-icon')) button.prepend(buttonIcon(button.dataset.icon));
  document.getElementById('analysis-submit')?.before(...spec.actions);
  setMode(mode || 'circuit');
}

/** The mode a drawing opens in: a registered mode's when it suits the
 *  drawing (an SC circuit), signal flow when it has signal-flow parts and no
 *  devices, else the circuit's. */
function suggestedMode() {
  const fitting = extraModes.find((spec) => spec.suggested?.(editor.circuit));
  if (fitting) return fitting.mode;
  return hasSignalFlow(editor.circuit) && !circuitParts() ? 'signal-flow' : 'circuit';
}

function circuitChildren() {
  const scroll = analysisDialog.querySelector('.analysis-scroll');
  const own = new Set([modeBar, section, ...extraModes.map((spec) => spec.section)]);
  return [...scroll.children].filter((child) => !own.has(child));
}

function setMode(next, { user = false } = {}) {
  mode = next;
  if (user) chosenThisSession = true;
  const flow = mode === 'signal-flow';
  const extra = extraModes.find((spec) => spec.mode === mode) || null;
  const circuit = !flow && !extra;
  for (const child of circuitChildren()) child.classList.toggle('analysis-mode-hidden', !circuit);
  // One footer: Plots, every mode's, then the circuit's buttons there, or
  // this mode's.
  for (const id of ['analysis-submit']) document.getElementById(id)?.classList.toggle('analysis-mode-hidden', !circuit);
  for (const button of actions) button.classList.toggle('analysis-mode-hidden', !flow);
  section.hidden = !flow;
  for (const spec of extraModes) {
    spec.section.hidden = spec !== extra;
    for (const button of spec.actions) button.classList.toggle('analysis-mode-hidden', spec !== extra);
  }
  for (const button of modeBar.querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
  const title = document.getElementById('analysis-dialog-title');
  if (title) title.textContent = extra ? extra.title : flow ? 'Signal-flow analysis' : 'Small-signal analysis';
  setPlotsMode(extra ? extra.mode : flow ? 'signal-flow' : 'circuit');
  if (flow) {
    fillForm();
    renderPlots();
  }
  if (extra) extra.shown();
}

// ----- the form -------------------------------------------------------------------------

/**
 * Every way between continuous time (s) and sampled time (z) the diagram
 * offers, folded under the intro: what the sampler is (no hold), what makes
 * a DAC (any H(s) block reading a sampled signal, its H(s) the pulse), the
 * presets, and that nothing is converted by a transform.
 */
function domainsGuide() {
  const line = (parts) => {
    const p = el('p', { class: 'field-hint' });
    for (const part of parts) {
      if (typeof part === 'string') p.append(part);
      else {
        // In the run of the text; a pulse (a fraction) on a line of its own.
        p.append(mathSpan(part.tex, 'signal-flow-guide-math', part.display));
      }
    }
    return p;
  };
  const tex = (value) => ({ tex: value });
  const shown = (value) => ({ tex: value, display: true });
  return el('details', { class: 'signal-flow-paste-box signal-flow-guide' }, [
    el('summary', { text: 'Between s and z: samplers and DACs' }),
    el('div', { class: 'signal-flow-guide-head', text: 's to z: the sampler, only' }),
    line(['An ideal sampler reads the signal just before each ', tex('t = nT'), ' and passes on ', tex('x[n]'), '. It has no hold and no anti-aliasing (not a sample-and-hold or ZOH). Its value is the period ', tex('T'), '; put an H(s) block before it to filter.']),
    el('div', { class: 'signal-flow-guide-head', text: 'z to s: any H(s) block reading a sampled signal is a DAC' }),
    line(['Each sample enters as an impulse ', tex('x[n]\\,\\delta(t - nT)'), ', so the H(s) is the DAC pulse. Presets:']),
    line(['DAC (NRZ), held a whole period:', shown('\\frac{1 - e^{-sT}}{s}')]),
    line(['DAC (RZ), held half a period:', shown('\\frac{1 - e^{-sT/2}}{s}')]),
    line(['Type any other pulse into an H(s) block. With excess loop delay (or a delay block before the DAC):', shown('e^{-sT_d}\\,\\frac{1 - e^{-sT}}{s}')]),
    line(['A hold into an integrator, in one block:', shown('\\frac{1 - e^{-sT}}{s^2}')]),
    line(['A sample-and-hold is a sampler, then an NRZ DAC.']),
    el('div', { class: 'signal-flow-guide-head', text: 'No transform is applied' }),
    line(['A continuous path from a DAC to a sampler is sampled exactly (its pulse response at each ', tex('t = nT'), '), with no bilinear, matched-z, or other approximation. To design in z, draw ', tex('H(z)'), ' blocks; ', tex('z^{-1}'), ' is the Delay z^-1 preset.']),
  ]);
}

function fillForm() {
  const { signals, sources, issues } = signalFlowGraph(editor.circuit);
  const output = section.querySelector('#signal-flow-output');
  // The likeliest output first (a port's, a sampled one with a sampler), an
  // unnamed wire shown with the pin driving it.
  const names = outputChoices(editor.circuit);
  output.replaceChildren(...names.map(({ key, label }) => el('option', { value: key, text: label })));
  if (names.some(({ key }) => key === flow().output)) output.value = flow().output;
  // A first default is no edit; replacing a saved output (its signal gone) is.
  if (flow().output !== output.value) {
    const had = flow().output;
    flow().output = output.value;
    if (had) markSettingsChanged();
  }

  const table = section.querySelector('.signal-flow-sources');
  table.replaceChildren();
  if (!sources.length) table.append(el('p', { class: 'field-hint', text: 'No sources yet. A source is an input port or a named wire nothing drives.' }));
  // Every source starts as an input: each gets its own transfer function
  // (superposition holds the others at zero for it).
  for (const source of sources) {
    // A dither or tone source is an aggressor, not the signal: zero unless set to input.
    const value = flow().sources[source.id] ?? (source.dither ? 'zero' : 'input');
    flow().sources[source.id] = value;
    const kind = typeof value === 'object' ? 'constant' : value;
    const select = el('select', { 'aria-label': `${source.name}: input, zero, or constant` }, [
      el('option', { value: 'input', text: 'Input' }), el('option', { value: 'zero', text: 'Zero' }), el('option', { value: 'constant', text: 'Constant' }),
    ]);
    select.value = kind;
    const constant = el('input', { type: 'text', class: 'signal-flow-constant', placeholder: 'a or 0.5', 'aria-label': `${source.name} constant`, value: typeof value === 'object' ? value.constant : '' });
    constant.hidden = kind !== 'constant';
    const save = () => {
      constant.hidden = select.value !== 'constant';
      flow().sources[source.id] = select.value === 'constant' ? { constant: constant.value.trim() || '1' } : select.value;
      markSettingsChanged();
    };
    select.addEventListener('change', save);
    onFieldCommit(constant, save);
    const name = el('span', { class: 'signal-flow-source-name', text: source.name });
    // A quantizer's error source: E_{QZ1}, as math.
    if (source.quantizer) { name.innerHTML = texToMathML(source.name); name.title = `${source.id}'s quantization error (its linear model: a gain of 1 plus this)`; }
    if (source.dither) { name.innerHTML = texToMathML(source.name); name.title = source.tone ? `${source.id}'s tone: as an input here; the simulations draw its sine` : `${source.id}'s dither: as an input here; the simulations draw its numbers`; }
    table.append(el('div', { class: 'signal-flow-source' }, [name, select, constant]));
  }
  const problems = section.querySelector('.signal-flow-issues');
  problems.replaceChildren(...issues.map((issue) => el('p', { class: 'analysis-error', text: issue.message })));
  problems.hidden = !issues.length;
  section.querySelector('.signal-flow-stale').hidden = !latest || revisionCurrent(derivedRevision);
  section.querySelector('.signal-flow-band-host').replaceChildren(bandControls());
  fillSwingSources(sources);
  renderOptimize();
  timeChanged();
}

/**
 * The results belong to the document they were derived in: another one
 * shown (onDocumentShown; not an undo, which keeps the windows' state)
 * starts with none -- no traces, results, locus, loop, spectrum, swing, or
 * optimizer results. Traces of two diagrams are often named alike
 * (OUT/E_QZ1), so another's kept would be drawn at this one's numbers.
 */
function clearResults() {
  for (const view of Object.values(plotViews)) view.set(null);
  traces = [];
  liveSpectrumOn = true;
  latest = null;
  locus = null;
  loop = null;
  spectrum = null;
  swingRun++; // a sweep still running stops
  spectrumRun++; // and a spectrum waiting to run
  for (const key of ['swing', 'spectrum']) plotsBusy.set(key, false);
  swing = null;
  swingShown = null;
  resetOptimize();
  renderSwing();
  renderLocus();
  renderCoefficients({ force: true });
  renderResults();
  renderPlots();
}

// ----- root locus: the poles as one coefficient sweeps ----------------------------------

let locus = null; // { plot, entryIndex, name }
let locusRun = 0;

function locusSection() {
  return el('div', { class: 'signal-flow-locus', hidden: true }, [
    el('p', { class: 'field-hint signal-flow-locus-empty', text: 'Derive first. The locus follows a result\'s poles as one coefficient sweeps.' }),
    el('div', { class: 'signal-flow-swing-controls' }, [
      el('label', { text: 'Poles of' }), el('select', { class: 'signal-flow-locus-entry', 'aria-label': 'Result' }),
      el('label', { text: 'as' }), el('select', { class: 'signal-flow-locus-name', 'aria-label': 'Coefficient to sweep', onchange: () => fillLocusRange() }),
      el('label', { text: 'from' }), el('input', { type: 'text', class: 'signal-flow-locus-range signal-flow-locus-from', 'aria-label': 'Sweep from' }),
      el('label', { text: 'to' }), el('input', { type: 'text', class: 'signal-flow-locus-range signal-flow-locus-to', 'aria-label': 'Sweep to' }),
      el('button', { type: 'button', text: 'Sweep', onclick: () => runLocus() }),
    ]),
    el('p', { class: 'field-hint signal-flow-locus-status', 'aria-live': 'polite' }),
    el('div', { class: 'signal-flow-locus-plot' }),
  ]);
}

/** The results and coefficients to choose from, after each derive. */
function fillLocus() {
  const host = plots.querySelector('.signal-flow-locus');
  const ready = latest?.ok && latest.entries.length && currentSymbols().length;
  host.querySelector('.signal-flow-locus-empty').hidden = !!ready;
  for (const part of host.querySelectorAll('.signal-flow-swing-controls, .signal-flow-locus-status, .signal-flow-locus-plot')) part.hidden = !ready;
  if (!ready) return;
  const entrySelect = host.querySelector('.signal-flow-locus-entry');
  const previous = entrySelect.value;
  entrySelect.replaceChildren(...latest.entries.map((entry, i) => el('option', { value: String(i), text: `from ${String(entry.inputName).replace(/[{}]/g, '')}` })));
  if ([...entrySelect.options].some((o) => o.value === previous)) entrySelect.value = previous;
  const nameSelect = host.querySelector('.signal-flow-locus-name');
  const name = nameSelect.value;
  nameSelect.replaceChildren(...currentSymbols().map((symbol) => el('option', { value: symbol, text: symbol })));
  if (currentSymbols().includes(name)) nameSelect.value = name;
  else fillLocusRange();
}

/** A decade either side of the coefficient's number. */
function fillLocusRange() {
  const host = plots.querySelector('.signal-flow-locus');
  const name = host.querySelector('.signal-flow-locus-name').value;
  const value = resolved()[name] ?? 1;
  const base = value || 1;
  host.querySelector('.signal-flow-locus-from').value = String(Number((base / 10).toPrecision(3)));
  host.querySelector('.signal-flow-locus-to').value = String(Number((base * 10).toPrecision(3)));
}

/** Sweep, a few steps a frame, then draw. */
function runLocus() {
  const host = plots.querySelector('.signal-flow-locus');
  const status = host.querySelector('.signal-flow-locus-status');
  const entry = latest?.entries?.[Number(host.querySelector('.signal-flow-locus-entry').value)];
  const name = host.querySelector('.signal-flow-locus-name').value;
  const from = fraction(host.querySelector('.signal-flow-locus-from').value);
  const to = fraction(host.querySelector('.signal-flow-locus-to').value);
  const ks = locusSteps(from, to);
  if (!entry || !name || !ks.length || Math.sign(from) !== Math.sign(to)) {
    status.textContent = 'Pick a result, a coefficient, and a range of one sign.';
    return;
  }
  const evaluate = locusEvaluator(entry, name);
  const run = ++locusRun;
  let index = 0;
  const step = () => {
    if (run !== locusRun) return;
    const started = performance.now();
    while (index < ks.length && performance.now() - started < 30) evaluate(ks[index++]);
    if (index < ks.length) {
      status.textContent = `Sweeping ${name}... ${index} of ${ks.length}`;
      requestAnimationFrame(step);
      return;
    }
    const current = resolved()[name] ?? 1;
    const result = rootLocus(evaluate, { ks, current });
    if (!result) {
      status.textContent = 'This result has no numeric poles (a delay, or a continuous input through a sampler).';
      locus = null;
    } else {
      locus = { plot: { ...locusPlot(result, { parameter: symbolText(name), label: entry.label, color: TRACE_COLORS[0] }), source: name } };
      status.textContent = result.crossings.length
        ? `${result.crossings.map((c, i) => `${i ? 'then ' : ''}${c.becomes} at ${name} = ${Number(c.k.toPrecision(3))}`).join(', ').replace(/^./, (m) => m.toUpperCase())}.`
        : `${unstableNow(result) ? 'Unstable' : 'Stable'} across the whole sweep, ${from} to ${to}.`;
    }
    renderLocus();
  };
  step();
}

/** A result at each value k of one coefficient (the rest at their numbers,
 *  what links to it following), cached. */
function locusEvaluator(entry, name) {
  const valuesAt = (k) => {
    const own = { ...coefficients(), [name]: k };
    const numbers = resolveCoefficients(own, Object.fromEntries(Object.entries(links()).filter(([key]) => key !== name)));
    const values = {};
    for (const symbol of resultSymbols(entry.value, latest.variable)) values[symbol] = numbers[symbol] ?? 1;
    return values;
  };
  const cache = new Map();
  return (k) => {
    if (!cache.has(k)) cache.set(k, withCoefficients(entry.value, valuesAt(k)));
    return cache.get(k);
  };
}

/** The whole locus at once (updating a plot on the drawing). */
function computeLocus(entry, name, from, to) {
  const ks = locusSteps(from, to);
  if (!ks.length) return null;
  return rootLocus(locusEvaluator(entry, name), { ks, current: resolved()[name] ?? 1 });
}

const unstableNow = (result) => result.steps[0].poles.some((p) => (result.variable === 'z' ? Math.hypot(p.re, p.im) > 1 + 1e-9 : p.re > 1e-9));

function renderLocus() {
  const host = plots.querySelector('.signal-flow-locus-plot');
  host.replaceChildren();
  if (!locus?.plot) return;
  const view = plotView('locus');
  host.append(view.el);
  view.set(locusSpec(locus.plot));
  host.append(el('div', { class: 'signal-flow-graph-actions' }, [
    el('button', { type: 'button', text: 'Annotate', title: 'Put the locus on the drawing', onclick: () => placePlot(locus.plot, [{ label: locus.plot.label, color: locus.plot.color }]) }),
  ]));
}

// ----- loop gain: T at a broken signal --------------------------------------------------

let loop = null; // { key, result }

function loopSection() {
  return el('div', { class: 'signal-flow-loop', hidden: true }, [
    el('div', { class: 'signal-flow-swing-controls' }, [
      el('label', { text: 'Break the loop at' }),
      el('select', { class: 'signal-flow-loop-signal', 'aria-label': 'Signal to break the loop at', onchange: (ev) => { flow().loopAt = ev.target.value; markSettingsChanged(); loop = null; renderLoop(); } }),
    ]),
    el('p', { class: 'field-hint', text: 'T is minus what returns for 1 injected at the break, all sources at zero. A quantizer\'s NTF is then 1/(1 + T).' }),
    el('div', { class: 'signal-flow-loop-body' }),
  ]);
}

/** The signals a loop can be broken at (signal-flow.js loopBreakSignals). */
const loopSignals = () => loopBreakSignals(editor.circuit);

function renderLoop() {
  const host = plots.querySelector('.signal-flow-loop');
  const select = host.querySelector('.signal-flow-loop-signal');
  const body = host.querySelector('.signal-flow-loop-body');
  const candidates = loopSignals();
  select.replaceChildren(...candidates.map((s) => el('option', { value: s.key, text: String(s.display).replace(/[{}]/g, '') })));
  if (candidates.some((s) => s.key === flow().loopAt)) select.value = flow().loopAt;
  body.replaceChildren();
  if (!candidates.length) { body.append(el('p', { class: 'field-hint', text: 'No loop to break: no signal is driven by a part.' })); return; }
  const key = select.value;
  if (!loop || loop.key !== key || loop.circuit !== editor.circuit || loop.revision !== editor.modelRevision) {
    const numbers = resolved();
    const values = Object.fromEntries(diagramSymbols(editor.circuit).map((name) => [name, numbers[name] ?? 1]));
    loop = { key, circuit: editor.circuit, revision: editor.modelRevision, result: loopGain(editor.circuit, { breakAt: key, values }) };
  }
  const data = loopData(key, loop.result);
  const result = loop.result;
  if (!result.ok) { body.append(el('p', { class: 'analysis-error', text: result.error })); return; }
  body.append(mathRow(data.symbolic ? 'Loop gain' : 'Loop gain, at the coefficients above', data.equation));
  if (!data.t) { body.append(el('p', { class: 'field-hint', text: 'This loop gain has no numbers to plot.' })); return; }
  const { margins } = data;
  const unit = data.curve?.axis === 'normalized' ? 'f/fs' : 'ω';
  const number = (v) => String(Number(v.toPrecision(3)));
  const summary = !margins?.crossover
    ? 'No crossover: |T| never passes 1 in this range.'
    : `Crossover at ${unit} = ${number(margins.crossover)}: phase margin ${margins.phaseMargin.toFixed(1)}°${margins.gainMargin !== null ? `, gain margin ${margins.gainMargin.toFixed(1)} dB` : ''}.`;
  body.append(el('p', { class: `field-hint${margins?.phaseMargin !== null && margins?.phaseMargin < 0 ? ' analysis-error' : ''}`, text: summary }));
  const detailed = (quantity, extra) => (range) => {
    const close = responsePlot([data.trace], data.result.variable, { sAxis: sAxisSetting(), quantity, detail: range });
    return close && { ...close, ...extra };
  };
  if (data.magnitude) {
    const view = plotView('loop-magnitude');
    body.append(view.el);
    view.set(graphSpec(data.annotated, detailed('magnitude', { markers: data.markers, role: 'loop' })));
  }
  if (data.phase) {
    const markers = data.markers.map((m) => ({ f: m.f, label: '' }));
    const view = plotView('loop-phase');
    body.append(view.el);
    view.set(graphSpec({ ...data.phase, role: 'loop', markers }, detailed('phase', { role: 'loop', markers })));
  }
  body.append(el('div', { class: 'signal-flow-graph-actions' }, [
    el('button', { type: 'button', text: 'Annotate', title: 'Put the loop gain\'s magnitude, its crossover and margin marked, on the drawing', disabled: !data.magnitude, onclick: () => placePlot(data.annotated, data.shown, { view: plotViews['loop-magnitude']?.zoom() }) }),
  ]));
}

/**
 * The loop gain at signal `key` at the coefficients' numbers: its equation,
 * T, its curve and margins, its magnitude and phase plots, and the plot to
 * annotate (remembering its signal). Null when the loop does not solve.
 */
function loopData(key, result) {
  if (!key) return null;
  if (!result) {
    const numbers = resolved();
    const values = Object.fromEntries(diagramSymbols(editor.circuit).map((name) => [name, numbers[name] ?? 1]));
    result = loopGain(editor.circuit, { breakAt: key, values });
  }
  if (!result.ok) return null;
  const t = result.value?.kind === 'sampled' ? result.value.at(valuesFor(result.value, result.variable)) : numeric(result.value, result.variable);
  const symbolic = result.value?.kind !== 'sampled';
  const equation = `T(${result.variable}) = ${transferTex(symbolic ? result.value : t, result.variable, symbolic ? {} : { digits: 4 })}`;
  if (!t) return { result, symbolic, equation, t: null };
  const curve = responseCurve(t, result.variable, { sAxis: result.variable === 'z' ? 'normalized' : sAxisSetting() });
  const margins = loopMargins(curve);
  const markers = margins?.crossover ? [{ f: margins.crossover, label: `PM ${margins.phaseMargin.toFixed(0)}°` }] : [];
  const trace = { label: 'T', color: TRACE_COLORS[0], value: t, variable: result.variable };
  const magnitude = responsePlot([trace], result.variable, { sAxis: sAxisSetting() });
  const phase = responsePlot([trace], result.variable, { sAxis: sAxisSetting(), quantity: 'phase' });
  return {
    result, symbolic, equation, t, curve, margins, markers, magnitude, phase, trace,
    annotated: magnitude ? { ...magnitude, markers, role: 'loop', source: key } : null,
    shown: [{ label: `T_{${String(result.signal).replace(/[{}]/g, '')}}`, color: TRACE_COLORS[0] }],
  };
}

// ----- swing: each net's peak against the input amplitude ------------------------------

// The last sweep: { signals, fullScale, frequency, points: [{ a, peaks, tone, overloaded }] }.
let swing = null;
let swingRun = 0; // a sweep in progress stops when a newer one starts
let swingShown = null; // keys of the nets on the plot
let swingTimer = 0;
const swingColors = new Map();
const SWING_TONE = '\u0000tone';

function swingSection() {
  const source = el('select', { class: 'signal-flow-swing-source', 'aria-label': 'Source the sine drives', onchange: (ev) => { flow().swingInput = ev.target.value; markSettingsChanged(); } });
  const frequency = el('input', { type: 'text', class: 'signal-flow-swing-frequency signal-flow-test-frequency', value: '', 'aria-label': 'Sine frequency, f/fs', title: 'The sine\'s frequency as f/fs (1/256, 0.004), made a whole number of cycles in the window; blank: inside the signal band set above' });
  onFieldCommit(frequency, (text) => { flow().swingFrequency = text.trim(); markSettingsChanged(); });
  return el('div', { class: 'signal-flow-swing', hidden: true }, [
    el('p', { class: 'field-hint', text: 'Simulates a sine into one source at the coefficients above, rounding at each quantizer (Schreier\'s levels, full scale N - 1), and plots each net\'s peak as the amplitude sweeps to overload.' }),
    el('div', { class: 'signal-flow-swing-controls' }, [
      el('label', { text: 'Sine into' }), source,
      el('label', { text: 'at f/fs' }), frequency,
      el('button', { type: 'button', class: 'signal-flow-swing-run', text: 'Simulate', onclick: () => runSwing() }),
    ]),
    el('p', { class: 'field-hint signal-flow-swing-status', 'aria-live': 'polite' }),
    el('div', { class: 'signal-flow-swing-plot' }),
  ]);
}

function fillSwingSources(sources) {
  const select = plots.querySelector('.signal-flow-swing-source');
  if (!select) return;
  const real = sources.filter((s) => !s.quantizer && !s.dither);
  select.replaceChildren(...real.map((s) => el('option', { value: s.id, text: s.name })));
  if (real.some((s) => s.id === flow().swingInput)) select.value = flow().swingInput;
  // The document's frequency; blank, the band's own (shown as the placeholder).
  plots.querySelector('.signal-flow-swing-frequency').value = flow().swingFrequency || '';
  refreshTestFrequencies();
}

/** A test's sine frequency (f/fs): the one typed, else inside the signal
 *  band (its middle, swingTestFrequency), else 1/256. */
function testFrequency(text) {
  return swingTestFrequency({ frequency: text || '' }, editor.circuit.analysisValues.band);
}

/** The test frequencies' placeholders: what a blank field runs at, from the band. */
function refreshTestFrequencies() {
  const fallback = testFrequency('');
  const text = `${Number(fallback.toPrecision(3))}`;
  for (const field of [section, plots].flatMap((root) => [...(root?.querySelectorAll('.signal-flow-test-frequency') || [])])) {
    field.placeholder = text;
  }
}

function swingFrequency() {
  return testFrequency(plots.querySelector('.signal-flow-swing-frequency').value.trim());
}

/** Sweep the amplitude, one run a frame, drawing as it goes; resolves
 *  when it is done (or overtaken by a newer sweep). */
function runSwing() {
  plotsBusy.set('swing', true);
  return new Promise((resolve) => sweepSwing(resolve));
}

function sweepSwing(done) {
  const status = plots.querySelector('.signal-flow-swing-status');
  const numbers = resolved();
  const values = Object.fromEntries(diagramSymbols(editor.circuit).map((name) => [name, numbers[name] ?? 1]));
  const sim = prepareSimulation(editor.circuit, {
    values,
    sources: flow().sources,
    input: plots.querySelector('.signal-flow-swing-source').value,
    output: flow().output,
    frequency: swingFrequency(),
  });
  const run = ++swingRun;
  if (!sim.ok) {
    swing = null;
    status.textContent = sim.error;
    status.classList.add('analysis-error');
    renderSwing();
    plotsBusy.set('swing', false);
    done(null);
    return;
  }
  status.classList.remove('analysis-error');
  const amplitudes = sweepAmplitudes();
  swing = { signals: sim.signals, fullScale: sim.fullScale, frequency: sim.frequency, points: [] };
  if (!swingShown) swingShown = new Set([...sim.signals.filter((s) => ['state', 'quantizer-input', 'output'].includes(s.role)).map((s) => s.key), SWING_TONE]);
  // Its coefficients get sliders, derived or not.
  renderCoefficients();
  let index = 0;
  const step = () => {
    if (run !== swingRun) { done(null); return; }
    const started = performance.now();
    // As many runs as fit in a frame's worth of time.
    while (index < amplitudes.length && performance.now() - started < 30) {
      const a = amplitudes[index++];
      const result = sim.run(a);
      swing.points.push({ a, ...result });
      // Past three overloaded runs in a row there is nothing more to see.
      if (swing.points.slice(-3).length === 3 && swing.points.slice(-3).every((p) => p.overloaded)) index = amplitudes.length;
    }
    // A loop that runs away even at the smallest input is unstable, not overloaded.
    const unstable = swing.points.length && swing.points.every((p) => p.overloaded);
    status.classList.toggle('analysis-error', !!unstable && index >= amplitudes.length);
    status.textContent = index < amplitudes.length
      ? `Simulating... ${swing.points.length} of ${amplitudes.length} amplitudes`
      : unstable
      ? `The loop runs away even at ${swing.points[0].a} dBFS: it is unstable at these coefficients, so there is no swing to plot. Derive and check its poles (a sampled loop needs them inside |z| = 1; the quantizer cannot hold a loop that is unstable already).`
      : `Full scale ${sim.fullScale}; sine at f/fs = ${Number(sim.frequency.toPrecision(4))}, ${Math.round(sim.frequency * 4096)} cycles in 4096 samples.${swing.points.find((p) => p.overloaded) ? ` Overloads from ${swing.points.find((p) => p.overloaded).a} dBFS.` : ''}`;
    renderSwing();
    if (index < amplitudes.length) requestAnimationFrame(step);
    else {
      plotsBusy.set('swing', false);
      done(swing);
    }
  };
  step();
}

/** The sliders moved: run the sweep again once they settle. */
function swingCoefficientsChanged() {
  if (!swing) return;
  clearTimeout(swingTimer);
  swingTimer = setTimeout(runSwing, 350);
}

function swingTraces() {
  if (!swing) return [];
  const db = (peak) => (peak > 0 ? 20 * Math.log10(peak / swing.fullScale) : -300);
  const entries = swing.signals.filter((s) => s.role !== 'source').map((s, i) => ({ key: s.key, label: s.name, index: swing.signals.indexOf(s), order: i, stepped: !!s.quantized }));
  const traces = entries.map((entry, i) => ({
    key: entry.key,
    label: entry.label,
    ...(entry.stepped ? { stepped: true } : {}),
    color: TRACE_COLORS[i % TRACE_COLORS.length],
    points: swing.points.map((p) => ({ a: p.a, db: p.overloaded ? null : db(p.peaks[entry.index]) })),
  }));
  if (swing.points.some((p) => p.tone !== null && p.tone !== undefined)) {
    const output = swing.signals.find((s) => s.key === flow().output);
    traces.push({ key: SWING_TONE, tone: true, label: `\\text{tone at } ${output?.name || 'out'}`, color: TRACE_COLORS[traces.length % TRACE_COLORS.length], points: swing.points.map((p) => ({ a: p.a, db: p.overloaded ? null : db(p.tone) })) });
  }
  return traces;
}

function swingPlotOf(traces) {
  const amplitudes = swing.points.map((p) => p.a);
  return { kind: 'swing', range: { low: Math.min(...amplitudes, -60), high: Math.max(...amplitudes, 3) }, traces };
}

function renderSwing() {
  const host = plots.querySelector('.signal-flow-swing-plot');
  host.replaceChildren();
  if (!swing || swing.points.length < 2) return;
  const traces = swingTraces();
  // Each shown net keeps a color no other shown net has.
  const used = new Set();
  for (const trace of traces.filter((t) => swingShown.has(t.key))) {
    let color = swingColors.get(trace.key);
    if (!color || used.has(color)) color = TRACE_COLORS.find((c) => !used.has(c)) || trace.color;
    swingColors.set(trace.key, color);
    used.add(color);
  }
  for (const trace of traces) trace.color = swingColors.get(trace.key) || trace.color;
  const shown = traces.filter((t) => swingShown.has(t.key));
  const plot = swingPlotOf(shown.map((t) => ({ ...t, points: t.points.map((p) => ({ a: p.a, db: p.db ?? Infinity })) })));
  if (shown.length) {
    const view = plotView('swing');
    host.append(view.el);
    view.set(swingSpec(plot));
  }
  else host.append(el('p', { class: 'field-hint', text: 'Check a net below to plot it.' }));
  host.append(netPicker(traces.map((trace) => {
    const last = trace.points.filter((p) => p.db !== null).at(-1);
    return {
      key: trace.key, label: trace.label, color: trace.color, checked: swingShown.has(trace.key),
      title: last ? `peak ${Number((10 ** (last.db / 20) * swing.fullScale).toPrecision(3))} at ${last.a} dBFS in` : '',
    };
  }), (key, on) => { if (on) swingShown.add(key); else swingShown.delete(key); renderSwing(); }));
  host.append(el('div', { class: 'signal-flow-graph-actions' }, [
    el('button', { type: 'button', text: 'Annotate', title: 'Put the plot on the drawing', disabled: !shown.length, onclick: () => placePlot(swingPlotOf(shown), shown, { view: plotViews.swing?.zoom() }) }),
  ]));
}

// ----- results --------------------------------------------------------------------------

/** A result's label, a signal's subscript markup (E_{QZ1}) drawn as one. */
function equationLabel(text) {
  const label = el('div', { class: 'analysis-equation-label' });
  for (const run of parseLabelRuns(text)) label.append(run.sub || run.super ? el(run.sub ? 'sub' : 'sup', { text: run.text }) : run.text);
  return label;
}

function mathRow(label, tex) {
  const value = el('div', { class: 'analysis-equation-value', 'aria-label': tex });
  value.innerHTML = texToMathML(tex);
  return el('div', { class: 'analysis-equation-row' }, [equationLabel(label), value]);
}

// ----- coefficients ---------------------------------------------------------------------

/** Every coefficient the diagram names, and any a result or trace still
 *  holds: the sliders show them all from the start, derived or not. */
function currentSymbols() {
  const names = new Set(diagramSymbols(editor.circuit));
  for (const trace of traces) for (const name of resultSymbols(trace.value, trace.variable)) names.add(name);
  if (latest?.ok) for (const entry of latest.entries) for (const name of resultSymbols(entry.value, latest.variable)) names.add(name);
  return [...names].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/** Every symbol of a result with its number (1 until set). */
function valuesFor(value, variable) {
  const values = {};
  const numbers = resolved();
  for (const name of resultSymbols(value, variable)) values[name] = numbers[name] ?? 1;
  return values;
}

/** A result with every symbol given its number. */
function numeric(value, variable) {
  return withCoefficients(value, valuesFor(value, variable));
}

let redrawFrame = 0;
/** Redraw what the coefficients feed, once a frame while a slider moves. */
/** The settings came back from undo or redo: the form, the sliders, and
 *  the plots show them again (what was derived still holds). */
export function signalFlowSettingsRestored() {
  if (!section || mode !== 'signal-flow') return;
  fillForm();
  renderCoefficients({ force: true });
  renderPlots();
  coefficientsChanged();
  coefficientsSettled();
}

function coefficientsChanged() {
  if (redrawFrame) return;
  redrawFrame = requestAnimationFrame(() => {
    redrawFrame = 0;
    markSettingsChanged();
    renderGraph();
    renderResults();
    swingCoefficientsChanged();
    timeChanged();
    if (graphView() === 'loop') { loop = null; renderLoop(); }
  });
}

let settleTimer = 0;
/** The numbers settled (a slider let go, a value typed, numbers pasted):
 *  what simulates long -- the spectrum -- runs again, not on every tick. */
function coefficientsSettled() {
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => { if (flow().spectrum?.on) runSpectrum(); });
}

let shownSymbols = '';
let shownCircuit = null;
/** The coefficient rows; kept (a slider mid-drag with them) unless the
 *  names change or `force` (new numbers from elsewhere, a paste). */
function renderCoefficients({ force = false } = {}) {
  const host = section.querySelector('.signal-flow-coefficients');
  const names = currentSymbols();
  host.hidden = !names.length;
  const rows = host.querySelector('.signal-flow-coefficient-rows');
  if (!force && names.join('\n') === shownSymbols && shownCircuit === editor.circuit && rows.children.length) { refreshLinkedRows(); return; }
  shownSymbols = names.join('\n');
  shownCircuit = editor.circuit;
  rows.replaceChildren();
  for (const name of names) {
    const linked = Object.hasOwn(links(), name);
    const value = coefficients()[name] ?? 1;
    const label = el('span', { class: 'signal-flow-coefficient-name' });
    label.innerHTML = texToMathML(symbolText(name));
    const slider = el('input', { type: 'range', min: String(-3 * PER_DECADE), max: String(3 * PER_DECADE), step: '1', 'aria-label': `${name}: slide to change` });
    slider.value = String(indexE24(Math.abs(value) || 1));
    const field = el('input', { type: 'text', class: 'signal-flow-coefficient-value', 'aria-label': `${name}: value`, title: 'Value, m/n, or = coefficient', value: linked ? `= ${links()[name]}` : coefficientText(name, value) });
    const row = el('div', { class: 'signal-flow-coefficient', 'data-name': name }, [label, slider, field]);
    slider.addEventListener('input', () => {
      // The slider sets the size; a value typed negative keeps its sign.
      const sign = (coefficients()[name] ?? 1) < 0 ? -1 : 1;
      coefficients()[name] = sign * stepE24(Number(slider.value));
      delete fractions()[name];
      field.value = String(coefficients()[name]);
      refreshLinkedRows();
      coefficientsChanged();
    });
    slider.addEventListener('change', () => coefficientsSettled());
    onFieldCommit(field, () => {
      const text = field.value.trim();
      field.classList.remove('invalid');
      field.title = '';
      // `= b_1` follows b_1; a number is the coefficient's own again.
      if (text.startsWith('=')) {
        let link;
        try {
          link = parseCoefficientLink(text);
          if (linkMakesCycle(name, link.text, links())) throw new Error(`${name} would follow itself`);
        } catch (err) {
          field.classList.add('invalid');
          field.title = err.message;
          return;
        }
        links()[name] = link.text;
      } else {
        let typed;
        try {
          typed = parseCoefficientNumber(text);
        } catch (err) {
          field.classList.add('invalid');
          field.title = err.message;
          return;
        }
        delete links()[name];
        coefficients()[name] = typed.value;
        // A ratio (5/32, 2^-5) stays written as typed.
        if (typed.text) fractions()[name] = typed.text;
        else delete fractions()[name];
        if (typed.value) slider.value = String(indexE24(Math.abs(typed.value)));
      }
      refreshLinkedRows();
      coefficientsChanged();
      coefficientsSettled();
    });
    rows.append(row);
  }
  refreshLinkedRows();
}

/** Paste coefficient vectors (the delta-sigma toolbox's a, b, c, g) into the sliders. */
function pasteCoefficients() {
  const area = el('textarea', { class: 'signal-flow-paste', rows: '4', spellcheck: 'false', placeholder: 'a = [0.0444 0.2843 0.7894 1.25]\nb = [0.0444 0.2843 0.7894 1.25 1]\nc = [1 1 1 1]\ng = [0.0039 0.0034]', 'aria-label': 'Coefficients to paste' });
  const apply = () => {
    const { values, vectors } = parseCoefficientVectors(area.value, currentSymbols());
    const names = Object.keys(values);
    if (!names.length) { logLine('Paste coefficients: no name = value found (a = [0.1 0.2], g = 0.004)', 'error'); return; }
    for (const name of names) {
      coefficients()[name] = values[name];
      delete links()[name];
      delete fractions()[name];
    }
    const summary = [...Object.entries(vectors).map(([v, n]) => `${v}_1..${v}_${n}`), ...names.filter((n) => !Object.keys(vectors).some((v) => n.startsWith(`${v}_`)))];
    logLine(`set ${summary.join(', ')}`);
    renderCoefficients({ force: true });
    coefficientsChanged();
    coefficientsSettled();
  };
  return el('details', { class: 'signal-flow-paste-box' }, [
    el('summary', { text: 'Paste coefficients (delta-sigma toolbox)' }),
    area,
    el('p', { class: 'field-hint', text: 'One name = numbers per line; a vector fills a_1, a_2, …. MATLAB output pastes as printed. Name the diagram\'s gains to match (a_1, b_1, c_1, g_1).' }),
    el('div', { class: 'signal-flow-graph-actions' }, [el('button', { type: 'button', text: 'Apply', onclick: apply })]),
  ]);
}

/** Linked rows show the number they follow: the slider at it, disabled,
 *  and the link with its number on hover. */
function refreshLinkedRows() {
  const numbers = resolved();
  for (const row of section.querySelectorAll('.signal-flow-coefficient')) {
    const name = row.dataset.name;
    const linked = Object.hasOwn(links(), name);
    const slider = row.querySelector('input[type=range]');
    row.classList.toggle('linked', linked);
    slider.disabled = linked;
    if (!linked) { slider.title = ''; continue; }
    const value = numbers[name] ?? 1;
    if (value) slider.value = String(indexE24(Math.abs(value)));
    slider.title = `${name} = ${links()[name]} = ${Number(value.toPrecision(4))}`;
  }
}

// ----- the graph ------------------------------------------------------------------------

// The axis s results plot on: ω in the coefficients' units, or f/fs with s
// in units of 1/Ts (saved with the document). A z result puts every trace on f/fs.
const sAxisSetting = () => editor.circuit.analysisValues.sAxis || 'omega';
// What the graph shows (saved with the document): magnitude, phase, or the step response.
const graphView = () => flow().graphView || 'magnitude';
// Over a simulated spectrum a curve predicts it: solved with each
// quantizer at the gain the simulation measured (a two-level one's is set
// by the loop), where that solve has the same output and input.
const spectrumShown = () => !!spectrum?.points?.length;
const measuredValue = (trace) => (spectrumShown() && spectrum.linear?.ok && spectrum.linear.output.key === trace.output
  ? spectrum.linear.entries.find((entry) => entry.input === trace.input)?.value : null);
// With a simulated spectrum, one plot in its dBFS: the spectrum, each NTF
// as the noise it predicts (its error at the variance measured), each STF
// as where the tone would sit.
const dbfsOffsetOf = (trace) => {
  const fit = trace.noise && measuredValue(trace) ? spectrum.quantizers?.find((q) => q.refdes === trace.input) : null;
  const error = fit?.errorVariance > 0 ? 10 * Math.log10(fit.errorVariance * 3) : 0;
  return dbfsOffset(spectrum.raw, spectrum.fullScale, { noise: trace.noise, amplitude: spectrum.amplitude }) + error;
};

const graphPlot = (list, view = graphView(), detail = null) => {
  const shown = view === 'magnitude' && spectrumShown();
  // Held spectra behind the live one, while it is shown.
  const background = shown
    ? [...heldSpectraList().filter((held) => held.on !== false).map((held) => ({ label: heldLabel(held), color: held.color, points: held.points, hold: held.key })),
      ...(liveSpectrumOn ? [{ label: liveSpectrumLabel(), color: MUTED_TRACE_COLOR, points: spectrum.points }] : [])]
    : [];
  // A held trace is numbers already, and keeps the offset it was held at.
  const numbered = list.map((trace) => (trace.held
    ? { ...trace, label: heldLabel(trace) }
    : { ...trace, value: numeric(measuredValue(trace) ?? trace.value, trace.variable) }));
  if (view === 'step') return stepPlot(numbered);
  const dbfs = shown ? { offset: (trace) => (trace.held && Number.isFinite(trace.held.offset) ? trace.held.offset : dbfsOffsetOf(trace)) } : null;
  return responsePlot(numbered, 's', { sAxis: sAxisSetting(), band: editor.circuit.analysisValues.band, quantity: view, background, dbfs, detail });
};

// ----- held traces ----------------------------------------------------------------------

/** A held trace's or spectrum's label: its own, then the numbers it was
 *  held at that differ from the sliders' now (`a_r = 0.01`), or "held"
 *  when none does. */
function heldLabel(held) {
  const numbers = resolved();
  const differ = differing(held.held?.values || held.values, (name) => numbers[name] ?? 1);
  const amplitude = held.amplitude !== undefined && spectrum && held.amplitude !== spectrum.amplitude ? [`${heldNumber(held.amplitude)}\\ \\text{dBFS}`] : [];
  return heldName(held.held?.base ?? '\\text{simulated output}', [...differ, ...amplitude]);
}

/** A live trace's name beside its held copies: its numbers now for the
 *  names theirs give. */
function liveLabel(trace) {
  const numbers = resolved();
  const current = (name) => numbers[name] ?? 1;
  return liveName(trace.label, traces.filter((t) => t.held?.of === trace.id).flatMap((t) => differingNames(t.held.values, current)), current);
}

/** The live spectrum's name beside the held ones, as a live trace's. */
function liveSpectrumLabel() {
  const numbers = resolved();
  const current = (name) => numbers[name] ?? 1;
  return liveName('\\text{simulated output}', heldSpectraList().filter((held) => held.on !== false).flatMap((held) => differingNames(held.values, current)), current);
}

const nextTraceColor = () => {
  const used = new Set([...traces.map((trace) => trace.color), ...heldSpectraList().map((held) => held.color)]);
  return TRACE_COLORS.find((candidate) => !used.has(candidate)) || TRACE_COLORS[(traces.length + heldSpectraList().length) % TRACE_COLORS.length];
};

/** Hold a trace: a copy at the numbers now, in a color of its own, that
 *  the sliders leave as it is. */
function holdTrace(trace) {
  const numbers = resolved();
  const values = Object.fromEntries(resultSymbols(trace.value, trace.variable).map((name) => [name, numbers[name] ?? 1]));
  const offset = spectrumShown() ? dbfsOffsetOf(trace) : undefined;
  const record = { key: holdKey(), of: trace.id, base: trace.label, color: nextTraceColor(), values, ...(offset !== undefined ? { offset } : {}) };
  holdsChanged([...holds(), record]);
  // Over a spectrum, at the gains it measured, as the live curve is drawn.
  traces.push(heldFrom(record, trace, measuredValue(trace) ?? trace.value));
  renderGraph();
}

/** A held trace from its record and the live trace it was held from, at
 *  the numbers held. */
function heldFrom(record, live, value = live.value) {
  return {
    ...live,
    id: `${live.id}\n${record.key}`,
    value: withCoefficients(value, record.values),
    color: record.color,
    on: record.on !== false,
    held: { values: record.values, base: record.base, key: record.key, of: record.of, ...(Number.isFinite(record.offset) ? { offset: record.offset } : {}) },
  };
}

/** The held traces whose live one is on the graph again (a Derive brought
 *  it back), made from their records. */
function restoreHolds() {
  for (const record of holds()) {
    if (record.kind === 'spectrum' || traces.some((trace) => trace.held?.key === record.key)) continue;
    const live = traces.find((trace) => !trace.held && trace.id === record.of);
    if (live) traces.push(heldFrom(record, live));
  }
}

/** Hold the simulated spectrum: a copy at the numbers now, drawn behind
 *  the live one. */
function holdSpectrum() {
  if (!spectrumShown()) return;
  const numbers = resolved();
  const values = Object.fromEntries(diagramSymbols(editor.circuit).map((name) => [name, numbers[name] ?? 1]));
  holdsChanged([...holds(), { key: holdKey(), kind: 'spectrum', points: spectrum.points, values, amplitude: spectrum.amplitude, color: nextTraceColor() }]);
  renderGraph();
}

// ----- the simulated output's spectrum, behind the curves --------------------------------

let spectrum = null; // { points (plotted), raw, frequency, amplitude } or { error }

// The spectrum's record: segments of 8192 samples (or as set) overlapping
// by half, Welch-averaged over a record four segments long (seven averages).
const SPECTRUM_SEGMENTS = [4096, 8192, 16384, 32768, 65536];
const SPECTRUM_SEGMENT = 8192;
const SPECTRUM_AVERAGES = 4;
const spectrumSegment = () => (SPECTRUM_SEGMENTS.includes(Number(flow().spectrum?.samples)) ? Number(flow().spectrum.samples) : SPECTRUM_SEGMENT);

/** The input's f/fs for the spectrum: as typed, 0 a constant input (DC);
 *  blank, inside the band. */
function spectrumFrequency(text) {
  return String(text ?? '').trim() && fraction(text) === 0 ? 0 : testFrequency(text);
}

/** The spectrum's simulation, a section of its own: on or off, its input,
 *  its length, and what it measured in band. */
function spectrumControls() {
  const settings = flow().spectrum || {};
  const check = el('input', { type: 'checkbox', 'aria-label': 'Simulated output spectrum' });
  check.checked = !!settings.on;
  const amplitude = el('input', { type: 'text', class: 'signal-flow-band-field', value: settings.amplitude ?? '-6', 'aria-label': 'Sine amplitude, dBFS' });
  const frequency = el('input', { type: 'text', class: 'signal-flow-band-field signal-flow-test-frequency signal-flow-spectrum-frequency', value: settings.frequency ?? '', 'aria-label': 'Sine frequency, f/fs', title: 'Input f/fs (1/256, 0.004; 0 for DC); blank: in the band' });
  const samples = el('select', { class: 'signal-flow-spectrum-samples', 'aria-label': 'Samples per segment', title: 'Samples per FFT segment; the run is four segments' },
    SPECTRUM_SEGMENTS.map((n) => el('option', { value: String(n), text: String(n) })));
  samples.value = String(spectrumSegment());
  const save = () => {
    flow().spectrum = {
      on: check.checked,
      amplitude: amplitude.value.trim() || '-6',
      ...(frequency.value.trim() ? { frequency: frequency.value.trim() } : {}),
      ...(Number(samples.value) !== SPECTRUM_SEGMENT ? { samples: Number(samples.value) } : {}),
    };
    markSettingsChanged();
    runSpectrum();
  };
  check.addEventListener('change', save);
  samples.addEventListener('change', save);
  onFieldCommit(amplitude, save);
  onFieldCommit(frequency, save);
  const fallback = testFrequency('');
  frequency.placeholder = `${Number(fallback.toPrecision(3))}`;
  return el('fieldset', { class: 'analysis-approximations signal-flow-spectrum' }, [
    el('legend', { text: 'Simulation' }),
    el('div', { class: 'signal-flow-band' }, [
      el('label', { class: 'signal-flow-spectrum-toggle' }, [check, el('span', { text: 'Output spectrum' })]),
      el('label', { text: 'Input' }), amplitude, el('label', { text: 'dBFS at f/fs' }), frequency,
      el('label', { text: 'Samples' }), samples,
    ]),
    el('p', { class: 'field-hint signal-flow-spectrum-status', text: spectrumStatus() }),
  ]);
}

function spectrumStatus() {
  if (!spectrum) return '';
  if (spectrum.error) return spectrum.error;
  const measured = inBand(spectrum.raw, spectrum.frequency, bandEdges(editor.circuit.analysisValues.band), { fullScale: spectrum.fullScale });
  const averaged = `${spectrum.raw.averages} averages of ${spectrum.raw.n} samples`;
  const gains = (spectrum.quantizers || []).map((q) => `${q.refdes} gain ${Number(q.gain.toPrecision(3))}`).join(', ');
  const curves = gains ? `; curves at ${gains}` : '';
  if (!measured) return `${averaged}; set a band for its SNDR${curves}`;
  const sndr = measured.sndr === null ? '' : `SNDR ${measured.sndr.toFixed(1)} dB (ENOB ${measured.enob.toFixed(1)}), `;
  return `In band: ${sndr}noise ${measured.noiseDb.toFixed(1)} dBFS; ${averaged}${curves}`;
}

let spectrumRun = 0; // the latest run asked for: an older one waiting is dropped

let spectrumWorker = null; // a worker thread (worker-thread.js), kept between runs
let spectrumWorkerBusy = false;

/** Simulate the spectrum in a worker thread, the windows free meanwhile;
 *  where none can start, in this one once the busy dots are on screen.
 *  The latest ask wins: a run still going for an older one is stopped. */
function runSpectrum() {
  const settings = flow().spectrum || {};
  const run = ++spectrumRun;
  if (!settings.on || !hasQuantizer()) {
    plotsBusy.set('spectrum', false);
    spectrum = null;
    renderGraph();
    return;
  }
  plotsBusy.set('spectrum', true);
  const request = spectrumRequest();
  const finish = (result) => {
    if (run !== spectrumRun) return;
    plotsBusy.set('spectrum', false);
    showSpectrum(request, result);
  };
  if (request.error) { finish(request); return; }
  if (spectrumWorkerBusy) { spectrumWorker.terminate(); spectrumWorker = null; }
  spectrumWorker ||= startWorker();
  if (!spectrumWorker) {
    afterPaint(() => { if (run === spectrumRun) finish(simulatedSpectrum(request)); });
    return;
  }
  spectrumWorkerBusy = true;
  spectrumWorker.onmessage = ({ data }) => {
    if (data.type !== 'spectrum' || data.id !== run) return;
    spectrumWorkerBusy = false;
    finish(data);
  };
  spectrumWorker.onerror = (ev) => {
    // A worker that cannot run: this thread takes the run, and the next ones.
    ev.preventDefault?.();
    spectrumWorker?.terminate();
    spectrumWorker = null;
    spectrumWorkerBusy = false;
    if (run === spectrumRun) finish(simulatedSpectrum(request));
  };
  spectrumWorker.postMessage({ type: 'spectrum', id: run, ...request });
}

/** What one spectrum run simulates, from the settings and the sliders:
 *  the diagram's JSON and prepareSimulation's options (spectrum-run.js
 *  `simulatedSpectrum`), or `{ error }`. */
function spectrumRequest() {
  const settings = flow().spectrum || {};
  const amplitude = Number(settings.amplitude ?? -6);
  if (!Number.isFinite(amplitude)) return { error: 'the amplitude is a number of dBFS' };
  const numbers = resolved();
  const values = Object.fromEntries(diagramSymbols(editor.circuit).map((name) => [name, numbers[name] ?? 1]));
  const { sources } = signalFlowGraph(editor.circuit);
  const input = plots.querySelector('.signal-flow-swing-source')?.value || flow().swingInput || sources.find((s) => !s.quantizer && !s.dither)?.id;
  // A whole number of cycles in each averaged segment, so the tone sits in its bins.
  const segment = spectrumSegment();
  const typed = spectrumFrequency(settings.frequency);
  const frequency = typed === 0 ? 0 : Math.max(1, Math.round(typed * segment)) / segment;
  return {
    circuit: editor.circuit.toJSON(),
    options: { values, sources: flow().sources, input, output: flow().output, frequency, samples: SPECTRUM_AVERAGES * segment, segment },
    amplitude,
    segment,
    numbers,
  };
}

/** A run's spectrum on the graph, behind the curves solved again at each
 *  quantizer's measured gain. */
function showSpectrum(request, result) {
  const { raw, quantizers = [] } = result;
  if (result.error) spectrum = { error: result.error };
  else if (!raw) spectrum = { error: result.overloaded ? `the loop runs away at ${request.amplitude} dBFS` : 'no output to take the spectrum of' };
  else {
    // The linear model again, each quantizer at its measured gain.
    const linear = quantizers.length
      ? analyzeSignalFlow(editor.circuit, { output: flow().output, sources: flow().sources, values: request.numbers, quantizerGains: Object.fromEntries(quantizers.map((q) => [q.refdes, Number(q.gain.toPrecision(6))])) })
      : null;
    spectrum = { raw, points: plotSpectrum({ ...raw, points: dbfsSpectrum(raw, result.fullScale) }, result.frequency), frequency: result.frequency, amplitude: request.amplitude, fullScale: result.fullScale, quantizers, linear };
  }
  // Its legend row comes or goes with it; else the plot alone is redrawn.
  if (graphView() === 'magnitude' && !!plots.querySelector('.signal-flow-legend-spectrum') !== spectrumShown()) renderGraph();
  else redrawGraphPlot();
  const status = plots.querySelector('.signal-flow-spectrum-status');
  if (status) status.textContent = spectrumStatus();
}
// The traces drawn, each held one named by the numbers it was held at.
const shownTraces = () => traces.filter((trace) => trace.on).map((trace) => ({ ...trace, label: trace.held ? heldLabel(trace) : liveLabel(trace) }));
const hasQuantizer = () => [...editor.circuit.components.values()].some((c) => c.type === 'quantizer');

/** Redraw the graph's plot alone, its controls left as they are (but a
 *  held trace's name, which names the numbers that differ from these). */
function redrawGraphPlot() {
  for (const math of plots.querySelectorAll('.signal-flow-legend-math[data-hold]')) {
    const held = traces.find((t) => t.held?.key === math.dataset.hold) || heldSpectraList().find((h) => h.key === math.dataset.hold);
    if (held) math.innerHTML = texToMathML(heldLabel(held));
  }
  // A live one names its numbers now beside its held copies.
  for (const math of plots.querySelectorAll('.signal-flow-legend-math[data-live]')) {
    const live = math.dataset.live === 'spectrum' ? null : traces.find((t) => t.id === math.dataset.live);
    if (live || math.dataset.live === 'spectrum') math.innerHTML = texToMathML(live ? liveLabel(live) : liveSpectrumLabel());
  }
  const host = plots.querySelector('.signal-flow-graph');
  const graph = plotViews.graph;
  const plot = graphPlot(shownTraces());
  const view = graphView();
  if (graph && host.contains(graph.el) && plot) graph.set(graphSpec(plot, view === 'step' ? null : (range) => graphPlot(shownTraces(), view, range)));
  else renderGraph();
}

/** A number typed as f/fs: 0.004, 1/256. */
function fraction(text) {
  const match = String(text).trim().match(/^(\d*\.?\d+)\s*\/\s*(\d*\.?\d+)$/);
  return match ? Number(match[1]) / Number(match[2]) : Number(String(text).trim());
}

/** The signal band, f0 and bw in f/fs: a line at bw, or two at f0 +- bw/2. */
function bandControls() {
  const band = editor.circuit.analysisValues.band;
  const field = (key, label, title) => {
    // A fraction shows as typed (1/256), a number as its digits.
    const input = el('input', { type: 'text', class: 'signal-flow-band-field', value: band?.text?.[key] ?? (band?.[key] ? String(Number(band[key].toPrecision(6))) : ''), placeholder: key === 'f0' ? '0' : '-', 'aria-label': label, title });
    onFieldCommit(input, () => {
      const f0 = fraction(row.querySelector('[data-key=f0]').value || '0');
      const bwText = row.querySelector('[data-key=bw]').value.trim();
      const bw = fraction(bwText);
      if (bwText && !(bw > 0 && f0 >= 0)) return;
      const f0Text = row.querySelector('[data-key=f0]').value;
      editor.circuit.analysisValues.band = bwText ? normalizeBand({ f0: f0 || 0, bw, text: { f0: f0Text, bw: bwText } }) || undefined : undefined;
      markSettingsChanged();
      redrawGraphPlot();
      renderResults();
      const status = plots.querySelector('.signal-flow-spectrum-status');
      if (status) status.textContent = spectrumStatus();
      refreshTestFrequencies();
      renderOptimize();
    });
    input.dataset.key = key;
    return input;
  };
  const row = el('div', { class: 'signal-flow-band' }, [
    el('label', { text: 'Signal band: f0' }), field('f0', 'Band center, f/fs', 'The band\'s center as f/fs; 0 for a baseband signal'),
    el('label', { text: 'bw' }), field('bw', 'Bandwidth, f/fs', 'The bandwidth as f/fs (1/128, 0.004); empty for no band lines'),
  ]);
  return row;
}

/** Add an entry's response to the graph (a graph keeps one variable). */
function addTrace(entry, variable, output) {
  const id = `${output.key}\n${entry.input}\n${entry.equation}`;
  if (traces.some((trace) => trace.id === id)) return;
  const used = new Set(traces.map((trace) => trace.color));
  const color = TRACE_COLORS.find((candidate) => !used.has(candidate)) || TRACE_COLORS[traces.length % TRACE_COLORS.length];
  // A trace is named by its ratio (OUT/IN); the equation can be annotated on its own.
  traces.push({ id, label: entry.label, equation: entry.equation, color, value: entry.value, variable, on: true, noise: !!entry.quantizer, input: entry.input, output: output.key });
  // Its held copies, saved with the design, come back with it.
  restoreHolds();
}

const GRAPH_VIEWS = new Set(['magnitude', 'phase', 'step']);

/** The Plots window's views, each with its tab; the loop gain only for a
 *  diagram with feedback (its tab returns when one is drawn). */
function plotTabs() {
  return [
    ['magnitude', 'Magnitude', 'Magnitude (dBFS with a simulated spectrum)'],
    ['phase', 'Phase', 'Phase, in degrees'],
    ['step', 'Step', 'Step response (sampled results in samples)'],
    ['locus', 'Locus', 'Poles as one coefficient sweeps'],
    ['swing', 'Swing', 'Net peaks as a sine\'s amplitude sweeps'],
    ...(loopSignals().length ? [['loop', 'Loop', 'Loop gain T: crossover and margins']] : []),
    ['time', 'Time', 'Nets in time, simulated with a sine'],
    ['sweep', 'Sweep', 'A coefficient swept: what each simulation measures'],
  ];
}

/** The plots' view switch, and the view it shows. */
function renderPlots() {
  if (!plots) return;
  const views = plotTabs();
  const diagram = hasSignalFlow(editor.circuit);
  // A view the diagram no longer offers (its loop removed) falls back.
  const view = views.some(([value]) => value === graphView()) ? graphView() : 'magnitude';
  const head = plots.querySelector('.signal-flow-plots-head');
  const viewButton = ([value, text, title]) => el('button', { type: 'button', text, title, 'aria-pressed': String(view === value), onclick: () => { flow().graphView = value; markSettingsChanged(); renderPlots(); } });
  head.replaceChildren(el('div', { class: 'segmented signal-flow-view', role: 'group', 'aria-label': 'Plot' }, views.map(viewButton)));
  head.hidden = !diagram;
  plots.querySelector('.signal-flow-plots-empty').hidden = diagram;
  plots.querySelector('.signal-flow-graph').hidden = !diagram || !GRAPH_VIEWS.has(view);
  plots.querySelector('.signal-flow-locus').hidden = !diagram || view !== 'locus';
  plots.querySelector('.signal-flow-swing').hidden = !diagram || view !== 'swing';
  plots.querySelector('.signal-flow-loop').hidden = !diagram || view !== 'loop';
  plots.querySelector('.signal-flow-time').hidden = !diagram || view !== 'time';
  plots.querySelector('.signal-flow-sweep').hidden = !diagram || view !== 'sweep';
  if (!diagram) return;
  if (GRAPH_VIEWS.has(view)) renderGraph();
  if (view === 'locus') fillLocus();
  if (view === 'loop') renderLoop();
  if (view === 'time') runTime();
  if (view === 'sweep') showSweep();
}

/** The window opened: its sources and its view, as the diagram is now. */
function refreshPlots() {
  fillSwingSources(signalFlowGraph(editor.circuit).sources);
  renderPlots();
}

function renderGraph() {
  const host = plots.querySelector('.signal-flow-graph');
  host.replaceChildren();
  const view = graphView();
  if (!GRAPH_VIEWS.has(view)) return;
  if (!traces.length && !(view === 'magnitude' && spectrum?.points?.length)) {
    host.append(el('p', { class: 'field-hint', text: 'Derive, and each result joins this graph.' }));
    return;
  }
  const plot = graphPlot(shownTraces());
  const head = el('div', { class: 'signal-flow-graph-head' });
  // With an s result on it, the frequency axis is a choice: ω in the
  // coefficients' units, or f/fs reading s in units of 1/Ts (as a
  // continuous-time loop filter normalized to its sample rate is written).
  if (view !== 'step' && traces.some((trace) => trace.variable === 's')) {
    const forced = traces.some((trace) => trace.variable === 'z');
    const choose = (value) => {
      editor.circuit.analysisValues.sAxis = value === 'normalized' ? 'normalized' : undefined;
      markSettingsChanged();
      renderGraph();
    };
    const button = (value, text, title) => {
      const pressed = forced ? value === 'normalized' : sAxisSetting() === value;
      return el('button', { type: 'button', text, title, 'aria-pressed': String(pressed), disabled: forced && value !== 'normalized', onclick: () => choose(value) });
    };
    head.append(el('div', { class: 'segmented signal-flow-axis', role: 'group', 'aria-label': 'Frequency axis' }, [
      button('omega', 'ω', 'ω, in the coefficients\' units'),
      button('normalized', 'f/fs', forced ? 'f/fs: a z result is plotted (s in units of 1/Ts)' : 'f/fs (s in units of 1/Ts; f/fs = ω/2π, up to ½)'),
    ]));
  }
  if (head.children.length) host.append(head);
  // A simulated output spectrum shows a quantizer's noise; a linear diagram has none.
  if (view === 'magnitude' && hasQuantizer()) host.append(spectrumControls());
  if (plot) {
    const graph = plotView('graph');
    host.append(graph.el);
    graph.set(graphSpec(plot, view === 'step' ? null : (range) => graphPlot(shownTraces(), view, range)));
  } else host.append(el('p', { class: 'field-hint', text: view === 'step' && shownTraces().length ? 'These results have no step response here (a loop holding a delay).' : 'Check a trace below to plot it.' }));
  const legend = el('div', { class: 'signal-flow-legend' });
  for (const trace of traces) {
    legend.append(traceLegendRow(trace, {
      label: trace.held ? heldLabel(trace) : liveLabel(trace), holds, holdsChanged,
      onHold: () => holdTrace(trace),
      onShow: renderGraph,
      onRemove: () => { traces = traces.filter((t) => t !== trace); renderCoefficients(); renderGraph(); },
    }));
  }
  // The simulated spectrum and those held, on the magnitude view.
  if (view === 'magnitude' && spectrumShown()) {
    const check = el('input', { type: 'checkbox', 'aria-label': 'Show the simulated output' });
    check.checked = liveSpectrumOn;
    check.addEventListener('change', () => { liveSpectrumOn = check.checked; renderGraph(); });
    const math = el('span', { class: 'signal-flow-legend-math' });
    math.innerHTML = texToMathML(liveSpectrumLabel());
    math.dataset.live = 'spectrum';
    math.style.color = MUTED_TRACE_COLOR;
    const hold = holdButton(holdSpectrum, 'Hold the simulated output');
    legend.append(el('div', { class: 'signal-flow-legend-row signal-flow-legend-spectrum' }, [check, el('span', { class: 'signal-flow-swatch', style: `background:${MUTED_TRACE_COLOR}` }), math, el('span', { class: 'signal-flow-legend-actions' }, [hold])]));
    for (const held of heldSpectraList()) {
      const check = el('input', { type: 'checkbox', 'aria-label': 'Show this spectrum' });
      check.checked = held.on !== false;
      check.addEventListener('change', () => { holdsChanged(holds().map((record) => (record.key === held.key ? { ...record, on: check.checked } : record))); renderGraph(); });
      const math = el('span', { class: 'signal-flow-legend-math' });
      math.innerHTML = texToMathML(heldLabel(held));
      math.dataset.hold = held.key;
      math.style.color = held.color;
      const remove = el('button', { type: 'button', class: 'signal-flow-legend-remove', 'aria-label': 'Remove this spectrum', title: 'Remove', text: '×', onclick: () => { holdsChanged(holds().filter((record) => record.key !== held.key)); renderGraph(); } });
      legend.append(el('div', { class: 'signal-flow-legend-row signal-flow-legend-held-spectrum' }, [check, el('span', { class: 'signal-flow-swatch', style: `background:${held.color}` }), math, el('span', { class: 'signal-flow-legend-actions' }, [remove])]));
    }
  }
  host.append(legend);
  host.append(el('div', { class: 'signal-flow-graph-actions' }, [
    el('button', { type: 'button', text: 'Clear graph', onclick: () => { traces = []; holdsChanged([]); renderCoefficients(); renderGraph(); renderResults(); } }),
    el('button', { type: 'button', text: 'Annotate', title: 'Put the graph on the drawing', disabled: !plot, onclick: annotateGraph }),
  ]));
}

/** The graph on the drawing: a plot annotation, each trace's equation a
 *  math label in its color beside it (children of the box, moving with it). */
function annotateGraph() {
  const shown = shownTraces();
  // Zoomed, at the window's limits, its curves dense across them.
  const view = plotViews.graph?.zoom() || null;
  const plot = graphPlot(shown, graphView(), view && graphView() !== 'step' ? view.x : null);
  if (!plot) return;
  // A simulated spectrum's SNDR stays in the window: the legend names curves.
  placePlot(plot, shown, { view });
}

/** A response plot (signal-flow.js `responsePlot`'s shape) on the drawing,
 *  as Annotate graph puts this graph there: `shown` names its traces
 *  ({ label, color }). The small-signal Bode graph's annotation. */
export function placeResponsePlot(plot, shown, { source = 'signal-flow', view = null } = {}) {
  placePlot(plot, shown, { source, view });
}

/**
 * A plot on the drawing. Annotating again replaces the data of the plot of
 * that kind already there -- the selected one (or the one whose legend is
 * selected), else the only one -- keeping its place, size, and style: its
 * plot and its legend (the traces named in their colors) are swapped, the
 * legend staying where it was. With none to update, a new plot goes under
 * the drawing at its left edge. The coefficients' numbers are a table of
 * their own (annotateCoefficients).
 */
function placePlot(plot, shown, { source = 'signal-flow', view = null } = {}) {
  const circuit = editor.circuit;
  // As the window shows it: zoomed, the plot keeps those limits (`view`)
  // through later updates; fitted, it shows all of its data.
  const { view: _old, ...rest } = plot;
  plot = view ? { ...rest, view } : rest;
  // The same tool's plot of the same kind (a response graph also of the
  // same quantity): figures.js chooseFigure.
  const identity = { kind: 'plot', source, key: plotKey(plot) };
  const target = chooseFigure(circuit, identity, selectedLabels().map((label) => label.id))?.labels.find((label) => label.plot) || null;
  let written = null;
  commit(() => { written = writePlot(target, plot, shown, { identity }); });
  if (!written?.box) return;
  // Their sizes are estimates until the browser measures them: stack them
  // then, edge to edge (each box is rounded to the grid already).
  alignLabelColumn(written.ids, { left: written.left, top: written.top, gap: 0 });
  setSelection([]);
  setLabelSelection([written.box.id]);
  logLine(target ? 'updated the plot on the drawing in place' : 'placed the graph on the drawing; drag to move it, its corners to resize');
  render();
}

/** A plot box's legend labels: ours by role (older plots' math children too). */
const legendOf = (box) => editor.circuit.plotLegend(box);

/**
 * Write a plot into `target` (its data and legend swapped, its place, size,
 * and style kept) or a new box under the drawing; inside a commit. Returns
 * `{ box, ids, left, top }` for the legend's column.
 */
function writePlot(target, plot, shown, { identity = null } = {}) {
  const circuit = editor.circuit;
  let box = target;
  let left;
  let top;
  if (target) {
    // The column is where its curves' entries are (notes may sit apart).
    const entries = legendOf(target);
    const named = entries.slice(0, circuit.plotLegendCurves(target).length);
    const old = (named.length ? named : entries).map((label) => label.bbox());
    const frame = target.bbox();
    left = old.length ? Math.min(...old.map((r) => r.x)) : frame.x + frame.w;
    top = old.length ? Math.min(...old.map((r) => r.y)) : frame.y;
    // A column beside the plot never starts inside it, nor in black over
    // its line samples' room: one that slid there goes back beside it.
    const room = target.style.blackTraces ? PLOT_LEGEND_SAMPLE_ROOM : 0;
    if (top < frame.y + frame.h && left > frame.x && left < frame.x + frame.w + room) left = frame.x + frame.w + room;
  } else {
    // Packed clear of what is there (figures.js): the box, and its legend
    // beside it about as wide as a third of the box.
    const spot = placeFigure(circuit, 'plot', { size: { w: (PLOT_BOX.w + 6) * GRID, h: PLOT_BOX.h * GRID } });
    // The legend beside the box, past the room its line samples take (a
    // new plot draws in black): its labels keep their own inset.
    left = spot.x + PLOT_BOX.w * GRID + PLOT_LEGEND_SAMPLE_ROOM;
    top = spot.y;
  }
  const ids = [];
  const figure = identity && { ...identity, id: target?.figure?.id || newFigureId(circuit) };
  if (target) {
    // A trace hidden in the plot's settings stays hidden through an update
    // (a held one by its key, the others by name).
    const before = target.plot?.traces || [];
    // A name past its comma is its numbers then, which may have moved since.
    const base = (label) => String(label).split(',\\ ')[0];
    const wasHidden = (trace) => before.some((old) => old.hidden && (old.hold ? old.hold === trace.hold : !trace.hold && base(old.label) === base(trace.label) && !!old.background === !!trace.background));
    if (Array.isArray(plot.traces) && before.some((old) => old.hidden)) plot = { ...plot, traces: plot.traces.map((trace) => (wasHidden(trace) ? { ...trace, hidden: true } : trace)) };
    // Traces added from files, and the markers, stay through an update.
    const { extra, cursors } = target.plot || {};
    target.plot = normalizePlot({ ...plot, ...(extra ? { extra } : {}), ...(cursors ? { cursors } : {}) });
    // A plot from before figures is this tool's from now on.
    if (figure && !target.figure) target.figure = figure;
    for (const label of legendOf(target)) circuit.removeLabel(label.id);
  } else {
    const x = left - PLOT_BOX.w * GRID - PLOT_LEGEND_SAMPLE_ROOM;
    box = circuit.addAnnotation('box', { x, y: top, end: { x: x + PLOT_BOX.w * GRID, y: top + PLOT_BOX.h * GRID }, plot, style: { lineStyle: 'solid', blackTraces: true }, ...(figure ? { figure } : {}) });
    if (figure) settlePlaced(circuit, figure.id);
  }
  let y = top;
  const add = (text, style, math = true) => {
    const label = circuit.addLabel({ text, math, parent: box.id, role: PLOT_LEGEND_ROLE, align: 'left', x: 0, y: 0, ...(style ? { style } : {}) });
    const size = label.bbox();
    label.moveTo(snap(left + size.w / 2), snap(y + size.h / 2));
    y = label.bbox().y + label.bbox().h;
    ids.push(label.id);
  };
  // The analysis's curves, then a simulated spectrum behind them, then the
  // traces added from files.
  // A hidden trace has no entry: `shown` names the front traces in order.
  const front = (box.plot.traces || []).filter((trace) => !trace.background);
  const behind = (box.plot.traces || []).filter((trace) => trace.background && !trace.hidden);
  shown.forEach((trace, i) => { if (!front[i]?.hidden) add(`$${trace.label}$`, { color: trace.color }); });
  behind.forEach((trace) => add(`$${trace.label}$`, { color: trace.color }));
  for (const trace of box.plot.extra || []) add(trace.label || ' ', { color: trace.color }, false);
  return { box, ids, left, top };
}

/** Every coefficient a plot or simulation is drawn at, sorted by name
 *  (a_1, a_2, b_1, ...): the diagram's, its results', and the dither's
 *  gains (no transfer function shows them, yet they set what every
 *  simulation draws). */
const tableSymbols = () => [...new Set([...currentSymbols(), ...ditherSymbols(editor.circuit)])]
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

/** The coefficients table's TeX, as the parts and noise tables are: a
 *  heading row and a rule, then a row per coefficient, its name then its
 *  number (a linked one's too: the number it follows). */
function coefficientRows() {
  const numbers = resolved();
  // A coefficient written as a fraction (rounded to m/n) shows as one.
  // A linked one too, once the coefficients are rounded: it follows
  // fractions, so its number is one (c_1 = b_1 = 7/32), never 0.2188.
  const rounded = Object.keys(fractions()).length > 0;
  const numberOf = (name, seen = new Set()) => {
    if (fractions()[name] && !Object.hasOwn(links(), name)) return fractions()[name];
    // A link to one coefficient (b_1 = c_1) is written as that one is.
    const link = links()[name]?.trim();
    if (link && Object.hasOwn(numbers, link) && !seen.has(link)) return numberOf(link, seen.add(name));
    const number = numbers[name] ?? 1;
    return (rounded && Object.hasOwn(links(), name) && fractionText(number)) || Number(number.toPrecision(4));
  };
  const rows = tableSymbols().map((name) => `${symbolText(name)} & ${numberOf(name)}`);
  return rows.length ? ['\\text{Coefficient} & \\text{Value}', '\\hline', ...rows] : [];
}

const COEFFICIENTS = { kind: 'coefficients', source: 'signal-flow', columns: 'lr' };

/** The coefficients' numbers on the drawing as their own table
 *  (figure-annotate.js), right of the circuit. Annotating again rewrites
 *  the table there. */
function annotateCoefficients() {
  const rows = coefficientRows();
  if (!rows.length) return;
  const { updated } = annotateMathFigure({ ...COEFFICIENTS, text: rows.join('\n') });
  logLine(updated ? 'updated the coefficients table' : 'annotated the coefficients table');
}

/**
 * Every plot on the drawing redrawn at the coefficients' numbers now, as
 * one edit: each graph and step plot from the traces of the same names
 * (a plot naming one no longer on the graph is left as it is), a loop
 * plot at its signal, a root locus over its coefficient and range, a swing
 * plot from a fresh sweep of the nets it shows, a sweep plot from its
 * sweeps run again (sweep-plot.js sweepPlotUpdate).
 */
async function updatePlots() {
  const circuit = editor.circuit;
  // A data plot is its file's, never the analysis's; but a sweep's.
  const boxes = [...circuit.labels.values()].filter((label) => label.kind === 'box' && label.plot && (label.plot.kind !== 'data' || label.plot.sweep));
  if (!boxes.length) { logLine('No plots on the drawing to update.'); return; }
  if (flow().spectrum?.on) runSpectrum();
  if (boxes.some((box) => box.plot.kind === 'swing')) {
    logLine('Updating plots: sweeping the swing...');
    await runSwing();
  }
  if (circuit !== editor.circuit) return;
  // Each sweep plot's sweeps, one after another (each point a simulation).
  const swept = new Map();
  const sweeps = boxes.filter((box) => box.plot.kind === 'data');
  for (const [i, box] of sweeps.entries()) {
    logLine(`Updating plots: running sweep ${i + 1} of ${sweeps.length}...`);
    const update = await sweepPlotUpdate(box.plot, () => circuit !== editor.circuit);
    if (circuit !== editor.circuit) return;
    if (update) swept.set(box, update);
  }
  const updates = [];
  const skipped = [];
  for (const box of boxes) {
    const update = box.plot.kind === 'data' ? (swept.get(box) || null) : plotUpdate(box.plot);
    if (update) updates.push({ box, ...update });
    else skipped.push(box);
  }
  const written = [];
  let table = null;
  commit(() => {
    // A plot from before the coefficients table had their numbers under
    // its legend (lines of "name = value"; a trace's name never is one):
    // they move to the table.
    const hadValues = updates.some((update) => legendOf(update.box).some((label) => /\s=\s/.test(String(label.text))));
    // Each keeps the limits it was annotated at.
    for (const update of updates) {
      if (update.traces) {
        // A sweep plot keeps its axes too; its sweep's entries are TeX.
        const entries = replaceDataPlotTraces(circuit, update.box, { traces: update.traces, ...(update.y ? { y: update.y } : {}) }, { math: update.box.plot.sweep.count });
        if (entries.length) written.push({ ids: entries.map((label) => label.id), left: Math.min(...entries.map((l) => l.bbox().x)), top: Math.min(...entries.map((l) => l.bbox().y)) });
        continue;
      }
      written.push(writePlot(update.box, update.box.plot.view ? { ...update.plot, view: update.box.plot.view } : update.plot, update.shown));
    }
    // The coefficients table, at the same numbers.
    const rows = coefficientRows();
    if (rows.length) table = writeMathFigure({ ...COEFFICIENTS, text: rows.join('\n'), create: hadValues });
  });
  for (const item of written) alignLabelColumn(item.ids, { left: item.left, top: item.top, gap: 0 });
  table?.settle();
  render();
  const kinds = (list) => list.map((box) => (box.plot.role === 'loop' ? 'loop' : box.plot.kind === 'response' ? (box.plot.quantity === 'phase' ? 'phase' : 'magnitude') : box.plot.kind === 'data' ? 'sweep' : box.plot.kind));
  logLine(`updated ${updates.length} plot${updates.length === 1 ? '' : 's'}${updates.length ? ` (${kinds(updates.map((u) => u.box)).join(', ')})` : ''}${skipped.length ? `; left ${skipped.length} as ${skipped.length === 1 ? 'it was' : 'they were'} (${kinds(skipped).join(', ')}: its traces are no longer on the graph, or derive or sweep first)` : ''}`, skipped.length && !updates.length ? 'error' : undefined);
}

/** A plot's new data at the numbers now: `{ plot, shown }`, or null. */
function plotUpdate(plot) {
  if (plot.kind === 'response' && plot.role === 'loop') {
    const data = loopData(plot.source || flow().loopAt || loopSignals()[0]?.key);
    return data?.magnitude ? { plot: data.annotated, shown: data.shown } : null;
  }
  if (plot.kind === 'response' || plot.kind === 'step') {
    // Each trace by its name, keeping its color.
    const stored = plot.traces.filter((trace) => !trace.background);
    // A held one by its key, its name naming the numbers it was held at.
    const matched = stored.map((trace) => {
      // A live one's name may carry its numbers then (`OUT/IN,\\ a = 1`).
      const current = trace.hold ? traces.find((t) => t.held?.key === trace.hold) : traces.find((t) => !t.held && (t.label === trace.label || trace.label.startsWith(`${t.label},`)));
      return current ? { ...current, label: current.held ? heldLabel(current) : liveLabel(current), color: trace.color } : null;
    });
    if (!matched.length || matched.some((t) => !t)) return null;
    const view = plot.kind === 'step' ? 'step' : plot.quantity === 'phase' ? 'phase' : 'magnitude';
    const next = graphPlot(matched, view);
    return next ? { plot: next, shown: matched } : null;
  }
  if (plot.kind === 'locus') {
    const entry = latest?.ok ? latest.entries.find((e) => e.label === plot.label) : null;
    const name = plot.source;
    if (!entry || !name) return null;
    const result = computeLocus(entry, name, plot.from, plot.to);
    if (!result) return null;
    const next = { ...locusPlot(result, { parameter: symbolText(name), label: entry.label, color: plot.color }), source: name };
    return { plot: next, shown: [{ label: next.label, color: next.color }] };
  }
  if (plot.kind === 'wave') return timePlotUpdate(plot);
  if (plot.kind === 'swing') {
    if (!swing || swing.points.length < 2) return null;
    const current = swingTraces();
    const matched = plot.traces.map((trace) => {
      const found = current.find((t) => t.label === trace.label);
      return found ? { ...found, color: trace.color } : null;
    });
    if (!matched.length || matched.some((t) => !t)) return null;
    return { plot: swingPlotOf(matched), shown: matched };
  }
  return null;
}

// ----- results --------------------------------------------------------------------------

function renderResults() {
  const host = section.querySelector('.signal-flow-results');
  host.replaceChildren();
  if (!latest) return;
  if (!latest.ok) {
    host.append(el('p', { class: 'analysis-error', text: latest.error }));
    return;
  }
  for (const entry of latest.entries) {
    const block = el('div', { class: 'analysis-equation signal-flow-entry' });
    if (entry.sampled) {
      // Through a sampler the result is numbers: worked out again at the
      // coefficients below, so it follows the sliders.
      const shown = sampledEquation(entry, valuesFor(entry.value, latest.variable));
      block.append(mathRow(`From ${entry.inputName}, at the coefficients below`, shown.equation));
      if (shown.mixed) block.append(el('p', { class: 'field-hint', text: `${entry.inputName} is continuous, so its path stays in s (s = jω, z = e^jωT): a tone at f comes out at f, images aside.` }));
      if (shown.zeros?.length) block.append(rootRow('Zeros', shown.zeros, 'z'));
      if (shown.poles?.length) block.append(rootRow(shown.mixed ? 'Poles of the sampled loop' : 'Poles', shown.poles, 'z'));
      if (shown.poles?.some((p) => Math.hypot(p.re, p.im) > 1 + 1e-9)) block.append(el('p', { class: 'analysis-error', text: 'A pole is outside the unit circle: the loop is unstable at these values, whatever the magnitude shows.' }));
      appendSqnr(block, entry, entry.value.at(valuesFor(entry.value, latest.variable)));
      appendTraceButton(block, entry);
      host.append(block);
      continue;
    }
    block.append(mathRow(`From ${entry.inputName}`, entry.equation));
    // Symbolic results show their roots at the coefficients' numbers.
    if (entry.delayed) {
      block.append(el('div', { class: 'analysis-equation-row' }, [
        el('div', { class: 'analysis-equation-label', text: 'Poles and zeros' }),
        el('div', { class: 'signal-flow-roots', text: 'infinitely many, from the delay; the graph is exact' }),
      ]));
    }
    const symbolic = !entry.delayed && (entry.poles === null || entry.zeros === null);
    const roots = symbolic ? numericRootsOf(numeric(entry.value, latest.variable)) : entry;
    const at = symbolic ? ' at the coefficients below' : '';
    if (roots.zeros?.length) block.append(rootRow('Zeros', roots.zeros, latest.variable, at));
    if (roots.poles?.length) block.append(rootRow('Poles', roots.poles, latest.variable, at));
    if (latest.variable === 'z') appendSqnr(block, entry, numeric(entry.value, latest.variable));
    appendTraceButton(block, entry);
    host.append(block);
  }
}

/** A quantizer's NTF, with a band set: the peak SQNR it predicts. */
function appendSqnr(block, entry, ntf) {
  if (!entry.quantizer) return;
  const band = editor.circuit.analysisValues.band;
  const component = editor.circuit.components.get(entry.quantizer);
  const levels = Number(component?.value) || 2;
  if (!bandEdges(band).length) {
    block.append(el('p', { class: 'field-hint', text: 'Set the signal band above the plots (bw, and f0 for band-pass) to get the peak SQNR.' }));
    return;
  }
  const sqnr = bandSqnr(ntf, levels, band);
  if (sqnr === null) return;
  const edges = bandEdges(band).map((f) => Number(f.toPrecision(3)));
  block.append(el('div', { class: 'analysis-equation-row' }, [
    el('div', { class: 'analysis-equation-label', text: 'Peak SQNR in band' }),
    el('div', { class: 'signal-flow-roots', text: `${Number.isFinite(sqnr) ? sqnr.toFixed(1) : '∞'} dB`, title: `Full-scale sine, ${levels} levels, f/fs ${edges.length === 2 ? `${edges[0]} to ${edges[1]}` : `0 to ${edges[0]}`} (linear model)` }),
  ]));
}

/** A result's switch: pressed while its response is on the graph, pressed
 *  again to take it off. */
function appendTraceButton(block, entry) {
  const id = `${latest.output.key}\n${entry.input}\n${entry.equation}`;
  const plotted = traces.some((trace) => trace.id === id);
  block.append(el('div', { class: 'signal-flow-entry-actions' }, [
    el('button', {
      type: 'button',
      text: 'On the graph',
      'aria-pressed': String(plotted),
      title: plotted ? 'On the graph: press to take it off' : 'Put this response on the graph',
      onclick: () => {
        if (plotted) traces = traces.filter((trace) => trace.id !== id);
        else addTrace(entry, latest.variable, latest.output);
        renderCoefficients();
        renderResults();
        renderGraph();
        if (!plotted) showPlots();
      },
    }),
  ]));
}

function rootRow(label, roots, variable, at = '') {
  const unit = variable === 'z' && label === 'Poles' ? ' (stable inside |z| = 1)' : '';
  return el('div', { class: 'analysis-equation-row' }, [
    equationLabel(`${label}${at}${unit}`),
    el('div', { class: 'signal-flow-roots', text: roots.map(complexText).join(',  ') }),
  ]);
}

/** Derive, with the analysis window's busy dots up while it runs. */
function derive() {
  deriving(deriveNow);
}

function deriveNow() {
  latest = analyzeSignalFlow(editor.circuit, { output: flow().output, sources: flow().sources, values: resolved() });
  derivedRevision = editor.modelRevision;
  section.querySelector('.signal-flow-stale').hidden = true;
  // Each new response joins the graph, beside those already there.
  if (latest.ok) for (const entry of latest.entries) addTrace(entry, latest.variable, latest.output);
  renderCoefficients();
  renderResults();
  arriving(section.querySelector('.signal-flow-results'));
  renderPlots();
  if (flow().spectrum?.on && latest.ok) runSpectrum();
  renderOptimize();
  if (latest.ok) offerPlots();
  else logLine(`Signal-flow analysis: ${latest.error}`, 'error');
}

/** The equations on the drawing as the signal-flow table
 *  (figure-annotate.js): a row per input, its transfer function, whose
 *  ratio names the input. Annotating again rewrites the table there. */
function annotate() {
  if (!latest?.ok) return;
  // A sampled result is written at the numbers it is shown with.
  const rows = latest.entries.map((entry) => (entry.sampled ? sampledEquation(entry, valuesFor(entry.value, latest.variable)).equation : entry.equation));
  const { updated } = annotateMathFigure({ kind: 'equations', source: 'signal-flow', text: rows.join('\n'), columns: 'l' });
  logLine(updated ? 'updated the equation table' : 'annotated the equation table');
}

// ----- install --------------------------------------------------------------------------

export function installSignalFlowUi() {
  const scroll = analysisDialog?.querySelector('.analysis-scroll');
  if (!scroll) return;
  modeBar = el('div', { class: 'segmented analysis-mode', role: 'group', 'aria-label': 'Analysis mode' }, [
    el('button', { type: 'button', 'data-mode': 'circuit', text: 'Circuit', title: 'Small-signal analysis', onclick: () => setMode('circuit', { user: true }) }),
    el('button', { type: 'button', 'data-mode': 'signal-flow', text: 'Signal flow', title: 'Signal-flow analysis', onclick: () => setMode('signal-flow', { user: true }) }),
  ]);
  const output = el('select', { id: 'signal-flow-output', onchange: (ev) => { flow().output = ev.target.value; markSettingsChanged(); } });
  section = el('div', { id: 'analysis-signal-flow', class: 'signal-flow-section', hidden: true }, [
    el('p', { class: 'analysis-intro', text: 'Pick the output and set each source to input, zero, or a constant. Derive gives each input\'s transfer function to the output.' }),
    domainsGuide(),
    // One card for the signals: the output, then every source, row by row.
    el('fieldset', { class: 'analysis-approximations' }, [
      el('legend', { text: 'Signals' }),
      el('div', { class: 'signal-flow-source signal-flow-output-row' }, [el('label', { for: 'signal-flow-output', class: 'signal-flow-source-name', text: 'Output' }), output]),
      el('div', { class: 'signal-flow-sources' }),
      el('p', { class: 'field-hint', text: 'A source is an input port or a named wire nothing drives. A constant only matters where it multiplies a signal; elsewhere it acts as zero.' }),
    ]),
    el('div', { class: 'signal-flow-issues', hidden: true }),
    el('p', { class: 'analysis-stale signal-flow-stale', hidden: true, text: 'The diagram changed since these equations were derived.' }),
    // The results first: what Derive found, then its plots.
    el('div', { class: 'signal-flow-results', 'aria-live': 'polite' }),
    // The signal band, one setting for every plot and spec: the response's
    // band lines and SQNR, the specs, and where each test's sine sits unless
    // it is set. The plots themselves are in their own window.
    el('div', { class: 'signal-flow-plots' }, [
      el('div', { class: 'card-heading', text: 'Plots' }),
      el('div', { class: 'signal-flow-band-host' }),
    ]),
    // The tuning comes after what it tunes: the coefficients' sliders, then
    // the optimizer (folded until opened).
    el('fieldset', { class: 'analysis-approximations signal-flow-coefficients', hidden: true }, [
      el('legend', { text: 'Coefficients' }),
      el('div', { class: 'signal-flow-coefficient-rows' }),
      el('p', { class: 'field-hint', text: 'The plots and the poles and zeros use these values; the equations stay symbolic. Type = b_1 (or = 2*b_1, = T/2) to make one follow others.' }),
      pasteCoefficients(),
    ]),
    optimizeSection({
      circuit: () => editor.circuit,
      flow,
      coefficients,
      links,
      resolved,
      band: () => editor.circuit.analysisValues.band,
      // A response plot as the graph shows it (the run window's).
      plotSpec: (plot, detailed) => graphSpec(plot, detailed),
      markSettingsChanged,
      // The numbers found, into the sliders.
      applyCoefficients(values, { fractions: texts = {} } = {}) {
        for (const [name, value] of Object.entries(values)) {
          coefficients()[name] = value;
          if (texts[name]) fractions()[name] = texts[name];
          else delete fractions()[name];
        }
        logLine(`set ${Object.entries(values).map(([name, value]) => `${name} = ${texts[name] || value}`).join(", ")}`);
        renderCoefficients({ force: true });
        coefficientsChanged();
        coefficientsSettled();
      },
      snapshotCoefficients: () => ({ coefficients: { ...coefficients() }, fractions: { ...fractions() } }),
      restoreCoefficients(saved) {
        editor.circuit.analysisValues.coefficients = { ...saved.coefficients };
        editor.circuit.analysisValues.fractions = { ...saved.fractions };
        renderCoefficients({ force: true });
        coefficientsChanged();
        coefficientsSettled();
      },
    }),
  ]);
  // The window's Annotate menu reads the mode; this mode's offers.
  setAnnotationMode(() => mode || 'circuit');
  registerAnnotations('signal-flow', () => [
    { label: 'Equations', identity: { kind: 'equations', source: 'signal-flow' }, available: !!latest?.ok, run: annotate },
    { label: 'Graph', identity: { kind: 'plot', source: 'signal-flow' }, available: !!graphPlot(shownTraces()), run: annotateGraph },
    { label: 'Coefficients', identity: { kind: 'coefficients', source: 'signal-flow' }, available: tableSymbols().length > 0, run: annotateCoefficients },
    // Not a figure of its own: every plot on the drawing at the numbers now.
    { label: 'Update all plots', identity: null, available: [...editor.circuit.labels.values()].some((label) => label.plot), run: () => updatePlots() },
  ]);
  actions = [
    el('button', { type: 'button', class: 'primary-action signal-flow-derive', 'data-icon': 'check', text: 'Derive', title: 'Derive (Enter)', onclick: derive }),
  ];
  for (const button of actions) if (button.dataset.icon && !button.querySelector('.button-icon')) button.prepend(buttonIcon(button.dataset.icon));
  document.getElementById('analysis-submit')?.before(...actions);
  scroll.prepend(modeBar);
  modeBar.after(section);
  // Enter in a field derives here; it must not submit the circuit form.
  section.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' || ev.target.tagName === 'BUTTON') return;
    ev.preventDefault();
    derive();
  });
  // The diagram may have changed while the window was open: refresh the
  // signals and sources when the pointer comes back to it.
  let filledRevision = -1;
  section.addEventListener('pointerenter', () => {
    if (filledRevision === editor.modelRevision) return;
    filledRevision = editor.modelRevision;
    fillForm();
  });
  plots = el('div', { class: 'signal-flow-plots-view' }, [
    el('p', { class: 'field-hint signal-flow-plots-empty', text: 'Draw a signal-flow diagram (H(s), H(z), sums, gains, quantizers), then Derive in the analysis window (Shift+S).' }),
    el('div', { class: 'signal-flow-graph-head signal-flow-plots-head' }),
    el('div', { class: 'signal-flow-graph' }),
    locusSection(),
    swingSection(),
    loopSection(),
    timeSection(),
    sweepSection(),
  ]);
  installPlotsWindow({ mode: 'signal-flow', view: plots, shown: refreshPlots });
  installTimePlot({ flow, resolved, placePlot: (plot, shown, options) => placePlot(plot, shown, options), visible: () => plotsShown() && graphView() === 'time' });
  // A sweep's values: the sliders', one of them (or more) set apart.
  installSweepPlot({ flow, links, resolvedWith: (values) => resolveCoefficients({ ...defaultCoefficients(), ...coefficients(), ...values }, links()), visible: () => plotsShown() && graphView() === 'sweep' });
  // Another document starts clean: its own mode, none of the last one's results.
  onDocumentShown(() => {
    chosenThisSession = false;
    clearResults();
    if (!analysisDialog.hidden) setMode(suggestedMode());
    // The Plots window shows what this drawing is, the analysis window shut.
    else setPlotsMode(suggestedMode());
  });
  // Each opening picks the mode the drawing suggests, unless it was chosen.
  new MutationObserver(() => {
    if (analysisDialog.hidden) return;
    setMode(chosenThisSession && mode ? mode : suggestedMode());
  }).observe(analysisDialog, { attributes: true, attributeFilter: ['hidden'] });
  setMode('circuit');
}
