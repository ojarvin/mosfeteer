/**
 * The analysis window's signal-flow mode (core/analysis/signal-flow.js): for a
 * block diagram rather than a circuit. A switch at the top of the window
 * chooses the mode -- a drawing of signal-flow parts and no devices opens in
 * it -- and this mode has its own fields, results, and actions, so the
 * small-signal form is untouched by it.
 *
 * The user picks the output signal and sets every source -- an input port or
 * any wire nothing drives -- to input, zero, or a constant. Derive shows each
 * input's transfer function to the output and its poles and zeros. Numeric
 * ones go onto one graph of magnitude responses, a colour per trace, kept
 * across derives so responses can be compared; Annotate graph puts that graph
 * on the drawing with its legend, and Annotate equations the equations.
 */

import { TRACE_COLORS, analyzeSignalFlow, bandEdges, bandSqnr, complexText, diagramSymbols, hasSignalFlow, loopBreakSignals, loopGain, loopMargins, responseCurve, transferTex, numericRootsOf, responsePlot, resultSymbols, sampledEquation, signalFlowGraph, withCoefficients } from '../core/analysis/signal-flow.js';
import { symbolText } from '../core/analysis/present.js';
import { linkMakesCycle, parseCoefficientLink, parseCoefficientVectors, resolveCoefficients } from '../core/analysis/coefficient-links.js';
import { expressionTex } from '../core/transfer-function.js';
import { PER_DECADE, indexE24, stepE24 } from './e-series.js';
import { locusFigure, responseFigure, stepFigure, swingFigure } from '../core/bode-figure.js';
import { stepPlot } from '../core/analysis/step.js';
import { locusPlot, locusSteps, rootLocus } from '../core/analysis/locus.js';
import { dbfsOffset, dbfsSpectrum, inBand, outputSpectrum, plotSpectrum } from '../core/analysis/spectrum.js';
import { prepareSimulation, sweepAmplitudes } from '../core/analysis/simulate.js';
import { normalizePlot, parseLabelRuns } from '../core/model.js';
import { texToMathML } from '../core/render.js';
import { GRID, snap } from '../core/grid.js';
import { editor } from './editor-state.js';
import { analysisDialog } from './elements.js';
import { alignLabelColumn, commit, markSettingsChanged, render, revisionCurrent, selectedLabels, setLabelSelection, setSelection } from './main.js';
import { logLine } from './status-bar-ui.js';
import { buttonIcon } from './icons.js';

// Devices the small-signal analysis models: a drawing with any opens in it.
const CIRCUIT_TYPES = /^(nmos|pmos|nmosb|pmosb|npn|pnp|resistor|capacitor|inductor|current_source|voltage_source|vccs|vcvs|impedance|opamp|opamp_diff|gm|diode)$/;

let mode = null; // 'circuit' | 'signal-flow'; chosen per opening unless switched
let chosenThisSession = false;
// The mode's settings, kept in the document so it reopens as it was left:
// the output, each source's mode (source id -> 'input' | 'zero' |
// { constant }), and the swing's source and frequency.
const flow = () => (editor.circuit.analysisValues.flow ||= { output: '', sources: {}, swingInput: '', swingFrequency: '' });
let latest = null;
// The graph's traces, kept across derives: { id, label (TeX), color, value, variable, on }.
let traces = [];
// Numbers for the symbols in the results (a_1, k), 1 until set: the graph and
// the numeric poles and zeros use them. Kept in the document, so a drawing
// opens with the numbers it was left at.
const coefficients = () => editor.circuit.analysisValues.coefficients;
// Linked coefficients (c_1 = b_1) and every coefficient's number through them.
const links = () => (editor.circuit.analysisValues.links ||= {});
const resolved = () => resolveCoefficients(coefficients(), links());
let modeBar = null;
let section = null;
let actions = null; // this mode's buttons, in the window's own footer
let derivedRevision = -1;

const el = (tag, props = {}, children = []) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (value !== false && value !== null && value !== undefined) node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...children);
  return node;
};

function circuitParts() {
  return [...editor.circuit.components.values()].filter((component) => CIRCUIT_TYPES.test(component.type)).length;
}

/** The mode a drawing opens in: signal flow when it has signal-flow parts and no devices. */
function suggestedMode() {
  return hasSignalFlow(editor.circuit) && !circuitParts() ? 'signal-flow' : 'circuit';
}

function circuitChildren() {
  const scroll = analysisDialog.querySelector('.analysis-scroll');
  return [...scroll.children].filter((child) => child !== modeBar && child !== section);
}

function setMode(next, { user = false } = {}) {
  mode = next;
  if (user) chosenThisSession = true;
  const flow = mode === 'signal-flow';
  for (const child of circuitChildren()) child.classList.toggle('analysis-mode-hidden', flow);
  // One footer: the circuit's buttons there, or this mode's.
  for (const id of ['analysis-annotate', 'analysis-submit']) document.getElementById(id)?.classList.toggle('analysis-mode-hidden', flow);
  for (const button of actions) button.classList.toggle('analysis-mode-hidden', !flow);
  section.hidden = !flow;
  for (const button of modeBar.querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
  const title = document.getElementById('analysis-dialog-title');
  if (title) title.textContent = flow ? 'Signal-flow analysis' : 'Small-signal analysis';
  if (flow) {
    fillForm();
    renderPlots();
  }
}

// ----- the form -------------------------------------------------------------------------

function fillForm() {
  const { signals, sources, issues } = signalFlowGraph(editor.circuit);
  const output = section.querySelector('#signal-flow-output');
  const names = [...signals.values()].filter((signal) => signal.driver).map((signal) => ({ key: signal.key, name: signal.display }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  // An output port's signal first: it is what is usually wanted.
  const outputPorts = new Set([...editor.circuit.components.values()].filter((c) => c.type === 'output')
    .flatMap((port) => [...signals.values()].filter((signal) => signal.netIds.some((id) => editor.circuit.nets.get(id)?.terminals.some((t) => t.comp === port.refdes)))).map((signal) => signal.key));
  names.sort((a, b) => outputPorts.has(b.key) - outputPorts.has(a.key));
  output.replaceChildren(...names.map(({ key, name }) => el('option', { value: key, text: name })));
  if (names.some(({ key }) => key === flow().output)) output.value = flow().output;
  // A first default is no edit; replacing a saved output (its signal gone) is.
  if (flow().output !== output.value) {
    const had = flow().output;
    flow().output = output.value;
    if (had) markSettingsChanged();
  }

  const table = section.querySelector('.signal-flow-sources');
  table.replaceChildren();
  if (!sources.length) table.append(el('p', { class: 'field-hint', text: 'No sources yet: a source is an input port, or any named wire nothing drives.' }));
  // Every source starts as an input: each gets its own transfer function
  // (superposition holds the others at zero for it).
  for (const source of sources) {
    const value = flow().sources[source.id] ?? 'input';
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
    constant.addEventListener('input', save);
    const name = el('span', { class: 'signal-flow-source-name', text: source.name });
    // A quantizer's error source: E_{QZ1}, as math.
    if (source.quantizer) { name.innerHTML = texToMathML(source.name); name.title = `${source.id}'s quantization error (its linear model: a gain of 1 plus this)`; }
    table.append(el('div', { class: 'signal-flow-source' }, [name, select, constant]));
  }
  const problems = section.querySelector('.signal-flow-issues');
  problems.replaceChildren(...issues.map((issue) => el('p', { class: 'analysis-error', text: issue.message })));
  problems.hidden = !issues.length;
  section.querySelector('.signal-flow-stale').hidden = !latest || revisionCurrent(derivedRevision);
  fillSwingSources(sources);
  // Another document: its own swing, not the last one's.
  if (swingCircuit !== editor.circuit) {
    swingCircuit = editor.circuit;
    swing = null;
    swingShown = null;
    renderSwing();
  }
}

// ----- root locus: the poles as one coefficient sweeps ----------------------------------

let locus = null; // { plot, entryIndex, name }
let locusRun = 0;

function locusSection() {
  return el('div', { class: 'signal-flow-locus', hidden: true }, [
    el('p', { class: 'field-hint signal-flow-locus-empty', text: 'Derive first: the locus follows one result\'s poles as one coefficient sweeps.' }),
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
  const host = section.querySelector('.signal-flow-locus');
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
  const host = section.querySelector('.signal-flow-locus');
  const name = host.querySelector('.signal-flow-locus-name').value;
  const value = resolved()[name] ?? 1;
  const base = value || 1;
  host.querySelector('.signal-flow-locus-from').value = String(Number((base / 10).toPrecision(3)));
  host.querySelector('.signal-flow-locus-to').value = String(Number((base * 10).toPrecision(3)));
}

/** Sweep, a few steps a frame, then draw. */
function runLocus() {
  const host = section.querySelector('.signal-flow-locus');
  const status = host.querySelector('.signal-flow-locus-status');
  const entry = latest?.entries?.[Number(host.querySelector('.signal-flow-locus-entry').value)];
  const name = host.querySelector('.signal-flow-locus-name').value;
  const from = fraction(host.querySelector('.signal-flow-locus-from').value);
  const to = fraction(host.querySelector('.signal-flow-locus-to').value);
  const ks = locusSteps(from, to);
  if (!entry || !name || !ks.length || Math.sign(from) !== Math.sign(to)) {
    status.textContent = 'Pick a result and a coefficient, and a range from one number to another of the same sign.';
    return;
  }
  // The coefficient at k, everything else (and what links to it) following.
  const valuesAt = (k) => {
    const own = { ...coefficients(), [name]: k };
    const numbers = resolveCoefficients(own, Object.fromEntries(Object.entries(links()).filter(([key]) => key !== name)));
    const values = {};
    for (const symbol of resultSymbols(entry.value, latest.variable)) values[symbol] = numbers[symbol] ?? 1;
    return values;
  };
  const cache = new Map();
  const evaluate = (k) => {
    if (!cache.has(k)) cache.set(k, withCoefficients(entry.value, valuesAt(k)));
    return cache.get(k);
  };
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
      status.textContent = 'This result has no numeric poles to follow (a delay, or a continuous input through a sampler).';
      locus = null;
    } else {
      locus = { plot: locusPlot(result, { parameter: symbolText(name), label: entry.label, color: TRACE_COLORS[0] }) };
      status.textContent = result.crossings.length
        ? `${result.crossings.map((c, i) => `${i ? 'then ' : ''}${c.becomes} at ${name} = ${Number(c.k.toPrecision(3))}`).join(', ').replace(/^./, (m) => m.toUpperCase())}.`
        : `${unstableNow(result) ? 'Unstable' : 'Stable'} across the whole sweep, ${from} to ${to}.`;
    }
    renderLocus();
  };
  step();
}

const unstableNow = (result) => result.steps[0].poles.some((p) => (result.variable === 'z' ? Math.hypot(p.re, p.im) > 1 + 1e-9 : p.re > 1e-9));

function renderLocus() {
  const host = section.querySelector('.signal-flow-locus-plot');
  host.replaceChildren();
  if (!locus?.plot) return;
  host.append(figureSvg(locusFigure(locus.plot, { width: 400, height: 260, fontSize: 11 }), 'Root locus'));
  host.append(el('div', { class: 'signal-flow-graph-actions' }, [
    el('button', { type: 'button', text: 'Annotate locus', title: 'Put this root locus on the drawing', onclick: () => placePlot(locus.plot, [{ label: locus.plot.label, color: locus.plot.color }], currentSymbols()) }),
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
    el('p', { class: 'field-hint', text: 'T is what returns, with a minus sign, for 1 injected where the loop is broken (every source at zero): a negative-feedback loop gain, so a quantizer\'s NTF is 1/(1 + T).' }),
    el('div', { class: 'signal-flow-loop-body' }),
  ]);
}

/** The signals a loop can be broken at (signal-flow.js loopBreakSignals). */
const loopSignals = () => loopBreakSignals(editor.circuit);

function renderLoop() {
  const host = section.querySelector('.signal-flow-loop');
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
  const result = loop.result;
  if (!result.ok) { body.append(el('p', { class: 'analysis-error', text: result.error })); return; }
  // T at the coefficients' numbers.
  const t = result.value?.kind === 'sampled' ? result.value.at(valuesFor(result.value, result.variable)) : numeric(result.value, result.variable);
  const symbolic = result.value?.kind !== 'sampled';
  body.append(mathRow(symbolic ? 'Loop gain' : 'Loop gain, at the coefficients above', `T(${result.variable}) = ${transferTex(symbolic ? result.value : t, result.variable, symbolic ? {} : { digits: 4 })}`));
  if (!t) { body.append(el('p', { class: 'field-hint', text: 'This loop gain has no numbers to plot.' })); return; }
  const curve = responseCurve(t, result.variable, { sAxis: result.variable === 'z' ? 'normalized' : sAxisSetting() });
  const margins = loopMargins(curve);
  const unit = curve?.axis === 'normalized' ? 'f/fs' : 'ω';
  const number = (v) => String(Number(v.toPrecision(3)));
  const summary = !margins?.crossover
    ? 'No crossover: |T| never passes 1 in this range.'
    : `Crossover at ${unit} = ${number(margins.crossover)}: phase margin ${margins.phaseMargin.toFixed(1)}°${margins.gainMargin !== null ? `, gain margin ${margins.gainMargin.toFixed(1)} dB` : ''}.`;
  body.append(el('p', { class: `field-hint${margins?.phaseMargin !== null && margins?.phaseMargin < 0 ? ' analysis-error' : ''}`, text: summary }));
  const markers = margins?.crossover ? [{ f: margins.crossover, label: `PM ${margins.phaseMargin.toFixed(0)}°` }] : [];
  const trace = { label: 'T', color: TRACE_COLORS[0], value: t, variable: result.variable };
  const magnitude = responsePlot([trace], result.variable, { sAxis: sAxisSetting() });
  const phase = responsePlot([trace], result.variable, { sAxis: sAxisSetting(), quantity: 'phase' });
  if (magnitude) body.append(graphSvg({ ...magnitude, markers, role: 'loop' }));
  if (phase) body.append(graphSvg({ ...phase, role: 'loop', markers: markers.map((m) => ({ f: m.f, label: '' })) }));
  body.append(el('div', { class: 'signal-flow-graph-actions' }, [
    el('button', { type: 'button', text: 'Annotate loop', title: 'Put the loop gain\'s magnitude, its crossover and margin marked, on the drawing', disabled: !magnitude, onclick: () => placePlot({ ...magnitude, markers, role: 'loop' }, [{ label: `T_{${String(result.signal).replace(/[{}]/g, '')}}`, color: TRACE_COLORS[0] }], currentSymbols()) }),
  ]));
}

// ----- swing: each net's peak against the input amplitude ------------------------------

// The last sweep: { signals, fullScale, frequency, points: [{ a, peaks, tone, overloaded }] }.
let swing = null;
let swingRun = 0; // a sweep in progress stops when a newer one starts
let swingShown = null; // keys of the nets on the plot
let swingTimer = 0;
let swingCircuit = null;
const swingColors = new Map();
const SWING_TONE = '\u0000tone';

function swingSection() {
  const source = el('select', { class: 'signal-flow-swing-source', 'aria-label': 'Source the sine drives', onchange: (ev) => { flow().swingInput = ev.target.value; markSettingsChanged(); } });
  const frequency = el('input', { type: 'text', class: 'signal-flow-swing-frequency', value: '1/256', 'aria-label': 'Sine frequency, f/fs', title: 'The sine\'s frequency as f/fs (1/256, 0.004), made a whole number of cycles in the window', oninput: (ev) => { flow().swingFrequency = ev.target.value.trim(); markSettingsChanged(); } });
  return el('div', { class: 'signal-flow-swing', hidden: true }, [
    el('p', { class: 'field-hint', text: 'Simulates the diagram at the coefficients above with a sine into one source, rounding at each quantizer (Schreier\'s levels, full scale N - 1), and plots every net\'s peak as the amplitude sweeps up to overload.' }),
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
  const select = section.querySelector('.signal-flow-swing-source');
  if (!select) return;
  const real = sources.filter((s) => !s.quantizer);
  select.replaceChildren(...real.map((s) => el('option', { value: s.id, text: s.name })));
  if (real.some((s) => s.id === flow().swingInput)) select.value = flow().swingInput;
  // The document's frequency, or the default.
  section.querySelector('.signal-flow-swing-frequency').value = flow().swingFrequency || '1/256';
}

function swingFrequency() {
  const text = section.querySelector('.signal-flow-swing-frequency').value.trim();
  const match = text.match(/^(\d+(?:\.\d*)?)\s*\/\s*(\d+(?:\.\d*)?)$/);
  const value = match ? Number(match[1]) / Number(match[2]) : Number(text);
  return value > 0 && value < 0.5 ? value : 1 / 256;
}

/** Sweep the amplitude, one run a frame, drawing as it goes. */
function runSwing() {
  const status = section.querySelector('.signal-flow-swing-status');
  const numbers = resolved();
  const values = Object.fromEntries(diagramSymbols(editor.circuit).map((name) => [name, numbers[name] ?? 1]));
  const sim = prepareSimulation(editor.circuit, {
    values,
    sources: flow().sources,
    input: section.querySelector('.signal-flow-swing-source').value,
    output: flow().output,
    frequency: swingFrequency(),
  });
  const run = ++swingRun;
  if (!sim.ok) {
    swing = null;
    status.textContent = sim.error;
    status.classList.add('analysis-error');
    renderSwing();
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
    if (run !== swingRun) return;
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
    traces.push({ key: SWING_TONE, label: `\\text{tone at } ${output?.name || 'out'}`, color: TRACE_COLORS[traces.length % TRACE_COLORS.length], points: swing.points.map((p) => ({ a: p.a, db: p.overloaded ? null : db(p.tone) })) });
  }
  return traces;
}

function swingPlotOf(traces) {
  const amplitudes = swing.points.map((p) => p.a);
  return { kind: 'swing', range: { low: Math.min(...amplitudes, -60), high: Math.max(...amplitudes, 3) }, traces };
}

function renderSwing() {
  const host = section.querySelector('.signal-flow-swing-plot');
  host.replaceChildren();
  if (!swing || swing.points.length < 2) return;
  const traces = swingTraces();
  // Each shown net keeps a colour no other shown net has.
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
  if (shown.length) host.append(figureSvg(swingFigure(plot, { width: 400, height: 220, fontSize: 11 }), 'Peak against input amplitude'));
  else host.append(el('p', { class: 'field-hint', text: 'Check a net below to plot it.' }));
  const legend = el('div', { class: 'signal-flow-legend' });
  for (const trace of traces) {
    const check = el('input', { type: 'checkbox', 'aria-label': 'Show this net' });
    check.checked = swingShown.has(trace.key);
    check.addEventListener('change', () => { if (check.checked) swingShown.add(trace.key); else swingShown.delete(trace.key); renderSwing(); });
    const math = el('span', { class: 'signal-flow-legend-math' });
    math.innerHTML = texToMathML(trace.label);
    math.style.color = trace.color;
    const last = trace.points.filter((p) => p.db !== null).at(-1);
    legend.append(el('div', { class: 'signal-flow-legend-row', title: last ? `peak ${Number((10 ** (last.db / 20) * swing.fullScale).toPrecision(3))} at ${last.a} dBFS in` : '' }, [check, el('span', { class: 'signal-flow-swatch', style: `background:${trace.color}` }), math]));
  }
  host.append(legend);
  host.append(el('div', { class: 'signal-flow-graph-actions' }, [
    el('button', { type: 'button', text: 'Annotate swing', title: 'Put this plot on the drawing, its nets named beside it', disabled: !shown.length, onclick: () => placePlot(swingPlotOf(shown), shown, currentSymbols()) }),
  ]));
}

// ----- results --------------------------------------------------------------------------

function mathRow(label, tex) {
  const value = el('div', { class: 'analysis-equation-value', 'aria-label': tex });
  value.innerHTML = texToMathML(tex);
  return el('div', { class: 'analysis-equation-row' }, [el('div', { class: 'analysis-equation-label', text: label }), value]);
}

// ----- coefficients ---------------------------------------------------------------------

/** Every symbol the results and the graph's traces depend on. */
function currentSymbols() {
  const names = new Set();
  for (const trace of traces) for (const name of resultSymbols(trace.value, trace.variable)) names.add(name);
  if (latest?.ok) for (const entry of latest.entries) for (const name of resultSymbols(entry.value, latest.variable)) names.add(name);
  // A swing sweep runs on every coefficient the diagram names.
  if (swing) for (const name of diagramSymbols(editor.circuit)) names.add(name);
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
function coefficientsChanged() {
  if (redrawFrame) return;
  redrawFrame = requestAnimationFrame(() => {
    redrawFrame = 0;
    markSettingsChanged();
    renderGraph();
    renderResults();
    swingCoefficientsChanged();
    if (flow().spectrum?.on) { clearTimeout(spectrumTimer); spectrumTimer = setTimeout(runSpectrum, 350); }
    if (graphView() === 'loop') { loop = null; renderLoop(); }
  });
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
    const field = el('input', { type: 'text', class: 'signal-flow-coefficient-value', 'aria-label': `${name}: value`, value: linked ? `= ${links()[name]}` : String(value) });
    const row = el('div', { class: 'signal-flow-coefficient', 'data-name': name }, [label, slider, field]);
    slider.addEventListener('input', () => {
      // The slider sets the size; a value typed negative keeps its sign.
      const sign = (coefficients()[name] ?? 1) < 0 ? -1 : 1;
      coefficients()[name] = sign * stepE24(Number(slider.value));
      field.value = String(coefficients()[name]);
      refreshLinkedRows();
      coefficientsChanged();
    });
    field.addEventListener('input', () => {
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
        const number = Number(text);
        if (!text || !Number.isFinite(number)) return;
        delete links()[name];
        coefficients()[name] = number;
        if (number) slider.value = String(indexE24(Math.abs(number)));
      }
      refreshLinkedRows();
      coefficientsChanged();
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
    }
    const summary = [...Object.entries(vectors).map(([v, n]) => `${v}_1..${v}_${n}`), ...names.filter((n) => !Object.keys(vectors).some((v) => n.startsWith(`${v}_`)))];
    logLine(`set ${summary.join(', ')}`);
    renderCoefficients({ force: true });
    coefficientsChanged();
  };
  return el('details', { class: 'signal-flow-paste-box' }, [
    el('summary', { text: 'Paste coefficients (delta-sigma toolbox)' }),
    area,
    el('p', { class: 'field-hint', text: 'Name = numbers, one per line: a vector names its entries a_1, a_2, ... (MATLAB output pastes as it prints). Name the diagram\'s gains to match: a_1, b_1, c_1, g_1.' }),
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

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Text with _{} and ^{} markup as SVG tspans. */
function svgText(item, fontSize) {
  const text = document.createElementNS(SVG_NS, 'text');
  text.setAttribute('x', item.x);
  text.setAttribute('y', item.y);
  text.setAttribute('text-anchor', item.anchor || 'start');
  text.setAttribute('class', `role-${item.role}`);
  for (const run of parseLabelRuns(item.text)) {
    const span = document.createElementNS(SVG_NS, 'tspan');
    span.textContent = run.text;
    if (run.sub || run.super) {
      span.setAttribute('baseline-shift', run.sub ? '-25%' : '35%');
      span.setAttribute('font-size', `${fontSize * 0.7}`);
    }
    text.append(span);
  }
  return text;
}

/** The graph in the panel: the same layout the drawing gets, in the theme's colours. */
function graphSvg(plot) {
  if (plot.kind === 'step') return figureSvg(stepFigure(plot, { width: 400, height: 220, fontSize: 11 }), 'Step responses');
  return figureSvg(responseFigure(plot, { width: 400, height: 220, fontSize: 11 }), plot.quantity === 'phase' ? 'Phase responses' : 'Magnitude responses');
}

function figureSvg(figure, title) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${figure.width} ${figure.height}`);
  svg.setAttribute('class', 'signal-flow-plot');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', title);
  for (const item of figure.items) {
    let node;
    if (item.type === 'line') {
      node = document.createElementNS(SVG_NS, 'line');
      for (const key of ['x1', 'y1', 'x2', 'y2']) node.setAttribute(key, item[key]);
    } else if (item.type === 'path') {
      node = document.createElementNS(SVG_NS, 'path');
      node.setAttribute('d', item.points.map((p, i) => `${i ? 'L' : 'M'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' '));
      if (item.color) node.style.stroke = item.color;
    } else if (item.type === 'dot') {
      node = document.createElementNS(SVG_NS, 'circle');
      node.setAttribute('cx', item.x);
      node.setAttribute('cy', item.y);
      node.setAttribute('r', item.r || 2);
      node.style.fill = item.color || 'currentColor';
      if (item.opacity !== undefined) node.style.fillOpacity = item.opacity;
    } else if (item.type === 'text') node = svgText(item, 11);
    if (!node) continue;
    node.classList.add(`role-${item.role}`);
    svg.append(node);
  }
  return svg;
}

// The axis s results plot on: ω in the coefficients' units, or f/fs with s
// in units of 1/Ts (saved with the document). A z result puts every trace on f/fs.
const sAxisSetting = () => editor.circuit.analysisValues.sAxis || 'omega';
// What the graph shows (saved with the document): magnitude, phase, or the step response.
const graphView = () => flow().graphView || 'magnitude';
const graphPlot = (list) => {
  const numbered = list.map((trace) => ({ ...trace, value: numeric(trace.value, trace.variable) }));
  if (graphView() === 'step') return stepPlot(numbered);
  // With a simulated spectrum, one plot in its dBFS: the spectrum, each NTF
  // as the noise it predicts, each STF as where the tone would sit.
  const background = spectrum?.points?.length ? [{ label: '\\text{simulated output}', color: '#8a8f99', points: spectrum.points }] : [];
  const dbfs = background.length ? { offset: (trace) => dbfsOffset(spectrum.raw, spectrum.fullScale, { noise: trace.noise, amplitude: spectrum.amplitude }) } : null;
  return responsePlot(numbered, 's', { sAxis: sAxisSetting(), band: editor.circuit.analysisValues.band, quantity: graphView(), background, dbfs });
};

// ----- the simulated output's spectrum, behind the curves --------------------------------

let spectrum = null; // { points (plotted), raw, frequency, amplitude } or { error }
let spectrumTimer = 0;

/** The checkbox and amplitude for the spectrum, and what it measured in band. */
function spectrumControls() {
  const settings = flow().spectrum || {};
  const check = el('input', { type: 'checkbox', 'aria-label': 'Simulated output spectrum' });
  check.checked = !!settings.on;
  const amplitude = el('input', { type: 'text', class: 'signal-flow-band-field', value: settings.amplitude ?? '-6', 'aria-label': 'Sine amplitude, dBFS' });
  const save = () => {
    flow().spectrum = { on: check.checked, amplitude: amplitude.value.trim() || '-6' };
    markSettingsChanged();
    runSpectrum();
  };
  check.addEventListener('change', save);
  amplitude.addEventListener('input', () => { clearTimeout(spectrumTimer); spectrumTimer = setTimeout(save, 400); });
  amplitude.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.stopPropagation(); ev.preventDefault(); save(); } });
  return el('div', { class: 'signal-flow-band signal-flow-spectrum' }, [
    el('label', { class: 'signal-flow-spectrum-toggle' }, [check, el('span', { text: 'Simulated output spectrum at' })]), amplitude, el('label', { text: 'dBFS' }),
    el('span', { class: 'field-hint signal-flow-spectrum-status', text: spectrumStatus() }),
  ]);
}

function spectrumStatus() {
  if (!spectrum) return '';
  if (spectrum.error) return spectrum.error;
  const measured = inBand(spectrum.raw, spectrum.frequency, bandEdges(editor.circuit.analysisValues.band));
  return measured ? `SNDR ${measured.sndr.toFixed(1)} dB in band (ENOB ${measured.enob.toFixed(1)})` : 'set a band for its SNDR';
}

/** Simulate one run with the swing's source and frequency, and take its output's spectrum. */
function runSpectrum() {
  const settings = flow().spectrum || {};
  if (!settings.on) {
    spectrum = null;
    renderGraph();
    return;
  }
  const amplitude = Number(settings.amplitude ?? -6);
  const numbers = resolved();
  const values = Object.fromEntries(diagramSymbols(editor.circuit).map((name) => [name, numbers[name] ?? 1]));
  const { sources } = signalFlowGraph(editor.circuit);
  const input = section.querySelector('.signal-flow-swing-source')?.value || flow().swingInput || sources.find((s) => !s.quantizer)?.id;
  const sim = prepareSimulation(editor.circuit, { values, sources: flow().sources, input, output: flow().output, frequency: swingFrequency(), samples: 16384 });
  if (!sim.ok) spectrum = { error: sim.error };
  else if (!Number.isFinite(amplitude)) spectrum = { error: 'the amplitude is a number of dBFS' };
  else {
    const run = sim.run(amplitude, { record: true });
    const raw = run.overloaded || !run.samples ? null : outputSpectrum(run.samples);
    spectrum = raw
      ? { raw, points: plotSpectrum({ ...raw, points: dbfsSpectrum(raw, sim.fullScale) }, sim.frequency), frequency: sim.frequency, amplitude, fullScale: sim.fullScale }
      : { error: run.overloaded ? `the loop runs away at ${amplitude} dBFS` : 'no output to take the spectrum of' };
  }
  redrawGraphPlot();
  const status = section.querySelector('.signal-flow-spectrum-status');
  if (status) status.textContent = spectrumStatus();
}
const shownTraces = () => traces.filter((trace) => trace.on);

/** Redraw the graph's plot alone, its controls left as they are. */
function redrawGraphPlot() {
  const host = section.querySelector('.signal-flow-graph');
  const old = host.querySelector('.signal-flow-plot');
  const plot = graphPlot(shownTraces());
  if (old && plot) old.replaceWith(graphSvg(plot));
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
    const input = el('input', { type: 'text', class: 'signal-flow-band-field', value: band?.[key] ? String(Number(band[key].toPrecision(6))) : '', placeholder: key === 'f0' ? '0' : '-', 'aria-label': label, title });
    // Applied as typed; only the plot redraws, so the field keeps its focus.
    input.addEventListener('input', () => {
      const f0 = fraction(row.querySelector('[data-key=f0]').value || '0');
      const bwText = row.querySelector('[data-key=bw]').value.trim();
      const bw = fraction(bwText);
      if (bwText && !(bw > 0 && f0 >= 0)) return;
      editor.circuit.analysisValues.band = bwText ? { f0: f0 || 0, bw } : undefined;
      markSettingsChanged();
      redrawGraphPlot();
      renderResults();
      const status = section.querySelector('.signal-flow-spectrum-status');
      if (status) status.textContent = spectrumStatus();
    });
    // Enter applies the field, not a derive.
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.stopPropagation(); ev.preventDefault(); input.blur(); } });
    input.dataset.key = key;
    return input;
  };
  const row = el('div', { class: 'signal-flow-band' }, [
    el('label', { text: 'Band f0' }), field('f0', 'Band centre, f/fs', 'The band\'s centre as f/fs; 0 for a baseband signal'),
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
  traces.push({ id, label: entry.label, equation: entry.equation, color, value: entry.value, variable, on: true, noise: !!entry.quantizer });
}

const GRAPH_VIEWS = new Set(['magnitude', 'phase', 'step']);

/** The plot area's view switch, and the view it shows. */
function renderPlots() {
  const view = graphView();
  const head = section.querySelector('.signal-flow-plots-head');
  const viewButton = (value, text, title) => el('button', { type: 'button', text, title, 'aria-pressed': String(view === value), onclick: () => { flow().graphView = value; markSettingsChanged(); renderPlots(); } });
  head.replaceChildren(el('div', { class: 'segmented signal-flow-view', role: 'group', 'aria-label': 'Plot' }, [
    viewButton('magnitude', 'Magnitude', 'The magnitude responses (in dBFS with a simulated spectrum)'),
    viewButton('phase', 'Phase', 'The phase responses, in degrees'),
    viewButton('step', 'Step', 'The step responses: overshoot and settling (a sampled result in samples)'),
    viewButton('locus', 'Locus', 'The poles as one coefficient sweeps'),
    viewButton('swing', 'Swing', 'Each net\'s peak as a sine\'s amplitude sweeps, simulated'),
    viewButton('loop', 'Loop', 'The loop gain T at a broken signal: crossover, phase and gain margins'),
  ]));
  section.querySelector('.signal-flow-graph').hidden = !GRAPH_VIEWS.has(view);
  section.querySelector('.signal-flow-locus').hidden = view !== 'locus';
  section.querySelector('.signal-flow-swing').hidden = view !== 'swing';
  section.querySelector('.signal-flow-loop').hidden = view !== 'loop';
  if (GRAPH_VIEWS.has(view)) renderGraph();
  if (view === 'locus') fillLocus();
  if (view === 'loop') renderLoop();
}

function renderGraph() {
  const host = section.querySelector('.signal-flow-graph');
  host.replaceChildren();
  const view = graphView();
  if (!GRAPH_VIEWS.has(view)) return;
  if (!traces.length) {
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
      button('omega', 'ω', 'ω in the units of the coefficients'),
      button('normalized', 'f/fs', forced ? 'A z result is on the graph: everything plots over f/fs, s in units of 1/Ts' : 'f/fs, reading s in units of 1/Ts: f/fs = ω/2π, to ½'),
    ]));
  }
  if (head.children.length) host.append(head);
  if (view !== 'step') host.append(bandControls());
  if (view === 'magnitude') host.append(spectrumControls());
  if (plot) host.append(graphSvg(plot));
  else host.append(el('p', { class: 'field-hint', text: view === 'step' && shownTraces().length ? 'These results have no step response here (a loop holding a delay, or a continuous input through a sampler).' : 'Check a trace below to plot it.' }));
  const legend = el('div', { class: 'signal-flow-legend' });
  for (const trace of traces) {
    const check = el('input', { type: 'checkbox', 'aria-label': 'Show this trace' });
    check.checked = trace.on;
    check.addEventListener('change', () => { trace.on = check.checked; renderGraph(); });
    const math = el('span', { class: 'signal-flow-legend-math' });
    math.innerHTML = texToMathML(trace.label);
    math.style.color = trace.color;
    const remove = el('button', { type: 'button', class: 'signal-flow-legend-remove', 'aria-label': 'Remove this trace', title: 'Remove this trace from the graph', text: '×', onclick: () => { traces = traces.filter((t) => t !== trace); renderCoefficients(); renderGraph(); } });
    legend.append(el('div', { class: 'signal-flow-legend-row' }, [check, el('span', { class: 'signal-flow-swatch', style: `background:${trace.color}` }), math, remove]));
  }
  host.append(legend);
  host.append(el('div', { class: 'signal-flow-graph-actions' }, [
    el('button', { type: 'button', text: 'Clear graph', onclick: () => { traces = []; renderCoefficients(); renderGraph(); renderResults(); } }),
    el('button', { type: 'button', text: 'Annotate graph', title: 'Put this graph on the drawing, its traces named beside it', disabled: !plot, onclick: annotateGraph }),
  ]));
}

/** The graph on the drawing: a plot annotation, each trace's equation a
 *  math label in its colour beside it (children of the box, moving with it). */
function annotateGraph() {
  const shown = shownTraces();
  const plot = graphPlot(shown);
  if (!plot) return;
  // The numbers the symbols were drawn with, under the legend.
  const used = [...new Set(shown.flatMap((trace) => resultSymbols(trace.value, trace.variable)))];
  placePlot(plot, shown, used);
}

const PLOT_LEGEND_ROLE = 'plot-legend';

/**
 * A plot on the drawing. Annotating again replaces the data of the plot of
 * that kind already there -- the selected one (or the one whose legend is
 * selected), else the only one -- keeping its place, size, and style: its
 * plot and its legend (the traces named in their colours, the coefficients'
 * numbers under them) are swapped, the legend staying where it was. With
 * none to update, a new plot goes under the drawing at its left edge.
 */
function placePlot(plot, shown, used) {
  const circuit = editor.circuit;
  const numbers = resolved();
  const linkTex = (name) => {
    try { return `${expressionTex(parseCoefficientLink(links()[name]).ast)} = `; } catch { return ''; }
  };
  // One order for every plot: the coefficients sorted by name (a_1, a_2, b_1, ...).
  const names = [...new Set(used)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  let values = names.map((name) => `${symbolText(name)} = ${Object.hasOwn(links(), name) ? linkTex(name) : ''}${Number((numbers[name] ?? 1).toPrecision(4))}`).join('\n');
  // The same kind of plot (a response graph also of the same quantity).
  const plots = [...circuit.labels.values()].filter((label) => label.kind === 'box' && label.plot?.kind === plot.kind
    && (label.plot.quantity || '') === (plot.quantity || '') && (label.plot.role || '') === (plot.role || ''));
  const chosen = selectedLabels().map((label) => (plots.includes(label) ? label : circuit.labels.get(label.parent))).find((label) => plots.includes(label));
  const target = chosen || (plots.length === 1 ? plots[0] : null);
  // The same numbers beside another plot already: not twice.
  if ([...circuit.labels.values()].some((label) => label.parent && label.parent !== target?.id && circuit.labels.get(label.parent)?.plot && label.text === values)) values = '';
  // A legend label: ours by role (older plots' math children too).
  const legendOf = (box) => [...circuit.labels.values()].filter((label) => label.parent === box.id && (label.role === PLOT_LEGEND_ROLE || (label.math && !label.role)));
  let box = target;
  let left;
  let top;
  if (target) {
    const old = legendOf(target).map((label) => label.bbox());
    const frame = target.bbox();
    left = old.length ? Math.min(...old.map((r) => r.x)) : frame.x + frame.w + GRID;
    top = old.length ? Math.min(...old.map((r) => r.y)) : frame.y;
  } else {
    // Under the drawing, at its left edge.
    const bounds = circuit.bounds();
    const empty = !circuit.components.size && !circuit.labels.size;
    const x = empty ? 0 : snap(bounds.x);
    const y = empty ? 0 : snap(bounds.y + bounds.h + 2 * GRID);
    left = x + 18 * GRID + GRID;
    top = y;
  }
  const ids = [];
  commit(() => {
    if (target) {
      target.plot = normalizePlot(plot);
      for (const label of legendOf(target)) circuit.removeLabel(label.id);
    } else {
      const x = left - 19 * GRID;
      box = circuit.addAnnotation('box', { x, y: top, end: { x: x + 18 * GRID, y: top + 11 * GRID }, plot, style: { lineStyle: 'solid' } });
    }
    let y = top;
    const add = (text, style) => {
      const label = circuit.addLabel({ text, math: true, parent: box.id, role: PLOT_LEGEND_ROLE, align: 'left', x: 0, y: 0, ...(style ? { style } : {}) });
      const size = label.bbox();
      label.moveTo(snap(left + size.w / 2), snap(y + size.h / 2));
      y = label.bbox().y + label.bbox().h;
      ids.push(label.id);
    };
    for (const trace of shown) add(`$${trace.label}$`, { color: trace.color });
    if (values) add(values);
  });
  if (!box) return;
  // Their sizes are estimates until the browser measures them: stack them
  // then, edge to edge (each box is rounded to the grid already).
  alignLabelColumn(ids, { left, top, gap: 0 });
  setSelection([]);
  setLabelSelection([box.id]);
  logLine(target ? 'updated the plot on the drawing in place' : 'placed the graph on the drawing; drag to move it, its corners to resize');
  render();
}

// ----- results --------------------------------------------------------------------------

function renderResults() {
  const host = section.querySelector('.signal-flow-results');
  host.replaceChildren();
  actions[0].hidden = !latest?.ok;
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
      if (shown.mixed) block.append(el('p', { class: 'field-hint', text: `${entry.inputName} is continuous: its path to the sampler stays in s (s = jω, z = e^jωT): a tone in at f comes out at f, images aside.` }));
      if (shown.zeros?.length) block.append(rootRow('Zeros', shown.zeros, 'z'));
      if (shown.poles?.length) block.append(rootRow(shown.mixed ? 'Poles of the sampled loop' : 'Poles', shown.poles, 'z'));
      if (shown.poles?.some((p) => Math.hypot(p.re, p.im) > 1 + 1e-9)) block.append(el('p', { class: 'analysis-error', text: 'A pole lies outside the unit circle: the sampled loop is unstable at these numbers, whatever the magnitude plot shows.' }));
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
    block.append(el('p', { class: 'field-hint', text: 'Set a band on the graph (bw, and f0 for a band-pass signal) for this NTF\'s peak SQNR.' }));
    return;
  }
  const sqnr = bandSqnr(ntf, levels, band);
  if (sqnr === null) return;
  const edges = bandEdges(band).map((f) => Number(f.toPrecision(3)));
  block.append(el('div', { class: 'analysis-equation-row' }, [
    el('div', { class: 'analysis-equation-label', text: 'Peak SQNR in band' }),
    el('div', { class: 'signal-flow-roots', text: `${Number.isFinite(sqnr) ? sqnr.toFixed(1) : '∞'} dB`, title: `A full-scale sine (amplitude ${levels - 1}, ${levels} levels) against white quantization noise (variance 1/3, levels 2 apart) through this NTF, in f/fs ${edges.length === 2 ? `${edges[0]} to ${edges[1]}` : `0 to ${edges[0]}`}; a linear-model prediction` }),
  ]));
}

function appendTraceButton(block, entry) {
  const id = `${latest.output.key}\n${entry.input}\n${entry.equation}`;
  const plotted = traces.some((trace) => trace.id === id);
  block.append(el('div', { class: 'signal-flow-entry-actions' }, [
    el('button', { type: 'button', text: plotted ? 'On the graph' : 'Add to graph', disabled: plotted, onclick: () => { addTrace(entry, latest.variable, latest.output); renderCoefficients(); renderGraph(); renderResults(); } }),
  ]));
}

function rootRow(label, roots, variable, at = '') {
  const unit = variable === 'z' && label === 'Poles' ? ' (stable inside |z| = 1)' : '';
  return el('div', { class: 'analysis-equation-row' }, [
    el('div', { class: 'analysis-equation-label', text: `${label}${at}${unit}` }),
    el('div', { class: 'signal-flow-roots', text: roots.map(complexText).join(',  ') }),
  ]);
}

function derive() {
  latest = analyzeSignalFlow(editor.circuit, { output: flow().output, sources: flow().sources, values: resolved() });
  derivedRevision = editor.modelRevision;
  section.querySelector('.signal-flow-stale').hidden = true;
  // Each new response joins the graph, beside those already there.
  if (latest.ok) for (const entry of latest.entries) addTrace(entry, latest.variable, latest.output);
  renderCoefficients();
  renderResults();
  renderPlots();
  if (flow().spectrum?.on && latest.ok) runSpectrum();
  if (!latest.ok) logLine(`Signal-flow analysis: ${latest.error}`, 'error');
}

/** The equations under the drawing, as math labels, one per input. */
function annotate() {
  if (!latest?.ok) return;
  const bounds = editor.circuit.bounds();
  const left = bounds.w > 0 ? bounds.x : editor.cursor.x;
  let top = (bounds.h > 0 ? bounds.y + bounds.h : editor.cursor.y) + 2 * GRID;
  const ids = [];
  commit(() => {
    for (const entry of latest.entries) {
      // A sampled result is written at the numbers it is shown with.
      const equation = entry.sampled ? sampledEquation(entry, valuesFor(entry.value, latest.variable)).equation : entry.equation;
      const label = editor.circuit.addLabel({ text: `$${equation}$`, x: 0, y: 0, align: 'left', math: true });
      const box = label.bbox();
      label.moveTo(snap(left + box.w / 2), snap(top + box.h / 2));
      top = label.bbox().y + label.bbox().h + GRID;
      ids.push(label.id);
    }
  });
  setSelection([]);
  setLabelSelection(ids);
  render();
}

// ----- install --------------------------------------------------------------------------

export function installSignalFlowUi() {
  const scroll = analysisDialog?.querySelector('.analysis-scroll');
  if (!scroll) return;
  modeBar = el('div', { class: 'segmented analysis-mode', role: 'group', 'aria-label': 'Analysis mode' }, [
    el('button', { type: 'button', 'data-mode': 'circuit', text: 'Circuit', title: 'Small-signal analysis of a transistor circuit', onclick: () => setMode('circuit', { user: true }) }),
    el('button', { type: 'button', 'data-mode': 'signal-flow', text: 'Signal flow', title: 'Transfer functions of a block diagram: H(s)/H(z) blocks, sums, and multipliers', onclick: () => setMode('signal-flow', { user: true }) }),
  ]);
  const output = el('select', { id: 'signal-flow-output', onchange: (ev) => { flow().output = ev.target.value; markSettingsChanged(); } });
  section = el('div', { id: 'analysis-signal-flow', class: 'signal-flow-section', hidden: true }, [
    el('p', { class: 'analysis-intro', text: 'Each wire is a signal. Pick the output and set each source (an input port, or a named wire nothing drives) to input, zero, or a constant: every input gets its transfer function to the output.' }),
    el('div', { class: 'analysis-grid' }, [
      el('div', { class: 'analysis-node' }, [el('label', { for: 'signal-flow-output', text: 'Output signal' }), el('div', { class: 'analysis-node-control' }, [output])]),
    ]),
    el('fieldset', { class: 'analysis-approximations' }, [
      el('legend', { text: 'Sources' }),
      el('div', { class: 'signal-flow-sources' }),
      el('p', { class: 'field-hint', text: 'A constant matters only where it multiplies a signal; elsewhere it adds no transfer function, the same as zero.' }),
    ]),
    el('div', { class: 'signal-flow-issues', hidden: true }),
    el('p', { class: 'analysis-stale signal-flow-stale', hidden: true, text: 'The diagram changed since these equations were derived.' }),
    el('fieldset', { class: 'analysis-approximations signal-flow-coefficients', hidden: true }, [
      el('legend', { text: 'Coefficients' }),
      el('div', { class: 'signal-flow-coefficient-rows' }),
      el('p', { class: 'field-hint', text: 'The graph and the poles and zeros use these numbers; the equations stay symbolic. Slide, or type any value -- or = b_1 (= 2*b_1, = T/2) to make one follow others.' }),
      pasteCoefficients(),
    ]),
    // One plot area, its view picked at the top: the frequency and step
    // responses, the root locus, the swing.
    el('div', { class: 'signal-flow-plots' }, [
      el('div', { class: 'signal-flow-graph-head signal-flow-plots-head' }),
      el('div', { class: 'signal-flow-graph' }),
      locusSection(),
      swingSection(),
      loopSection(),
    ]),
    el('div', { class: 'signal-flow-results', 'aria-live': 'polite' }),
  ]);
  actions = [
    el('button', { type: 'button', class: 'signal-flow-annotate', 'data-icon': 'text', hidden: true, text: 'Annotate equations', title: 'Write the equations under the drawing', onclick: annotate }),
    el('button', { type: 'button', class: 'primary-action signal-flow-derive', 'data-icon': 'check', text: 'Derive', title: 'Derive every input\'s transfer function to the output (Enter)', onclick: derive }),
  ];
  for (const button of actions) if (!button.querySelector('.button-icon')) button.prepend(buttonIcon(button.dataset.icon));
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
  // Each opening picks the mode the drawing suggests, unless it was chosen.
  new MutationObserver(() => {
    if (analysisDialog.hidden) return;
    setMode(chosenThisSession && mode ? mode : suggestedMode());
  }).observe(analysisDialog, { attributes: true, attributeFilter: ['hidden'] });
  setMode('circuit');
}
