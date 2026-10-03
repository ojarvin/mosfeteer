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

import { TRACE_COLORS, analyzeSignalFlow, complexText, diagramSymbols, hasSignalFlow, numericRootsOf, responsePlot, resultSymbols, sampledEquation, signalFlowGraph, withCoefficients } from '../core/analysis/signal-flow.js';
import { symbolText } from '../core/analysis/present.js';
import { linkMakesCycle, parseCoefficientLink, parseCoefficientVectors, resolveCoefficients } from '../core/analysis/coefficient-links.js';
import { expressionTex } from '../core/transfer-function.js';
import { PER_DECADE, indexE24, stepE24 } from './e-series.js';
import { responseFigure, swingFigure } from '../core/bode-figure.js';
import { prepareSimulation, sweepAmplitudes } from '../core/analysis/simulate.js';
import { parseLabelRuns } from '../core/model.js';
import { texToMathML } from '../core/render.js';
import { GRID, snap } from '../core/grid.js';
import { editor } from './editor-state.js';
import { analysisDialog } from './elements.js';
import { alignLabelColumn, commit, markSettingsChanged, render, revisionCurrent, setLabelSelection, setSelection } from './main.js';
import { logLine } from './status-bar-ui.js';
import { buttonIcon } from './icons.js';

// Devices the small-signal analysis models: a drawing with any opens in it.
const CIRCUIT_TYPES = /^(nmos|pmos|nmosb|pmosb|npn|pnp|resistor|capacitor|inductor|current_source|voltage_source|vccs|vcvs|impedance|opamp|opamp_diff|gm|diode)$/;

let mode = null; // 'circuit' | 'signal-flow'; chosen per opening unless switched
let chosenThisSession = false;
const settings = { output: '', sources: {} }; // source id -> 'input' | 'zero' | { constant }
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
  if (flow) fillForm();
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
  if (names.some(({ key }) => key === settings.output)) output.value = settings.output;
  settings.output = output.value;

  const table = section.querySelector('.signal-flow-sources');
  table.replaceChildren();
  if (!sources.length) table.append(el('p', { class: 'field-hint', text: 'No sources yet: a source is an input port, or any named wire nothing drives.' }));
  // Every source starts as an input: each gets its own transfer function
  // (superposition holds the others at zero for it).
  for (const source of sources) {
    const value = settings.sources[source.id] ?? 'input';
    settings.sources[source.id] = value;
    const kind = typeof value === 'object' ? 'constant' : value;
    const select = el('select', { 'aria-label': `${source.name}: input, zero, or constant` }, [
      el('option', { value: 'input', text: 'Input' }), el('option', { value: 'zero', text: 'Zero' }), el('option', { value: 'constant', text: 'Constant' }),
    ]);
    select.value = kind;
    const constant = el('input', { type: 'text', class: 'signal-flow-constant', placeholder: 'a or 0.5', 'aria-label': `${source.name} constant`, value: typeof value === 'object' ? value.constant : '' });
    constant.hidden = kind !== 'constant';
    const save = () => {
      constant.hidden = select.value !== 'constant';
      settings.sources[source.id] = select.value === 'constant' ? { constant: constant.value.trim() || '1' } : select.value;
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
  const source = el('select', { class: 'signal-flow-swing-source', 'aria-label': 'Source the sine drives' });
  const frequency = el('input', { type: 'text', class: 'signal-flow-swing-frequency', value: '1/256', 'aria-label': 'Sine frequency, f/fs', title: 'The sine\'s frequency as f/fs (1/256, 0.004), made a whole number of cycles in the window' });
  return el('fieldset', { class: 'analysis-approximations signal-flow-swing' }, [
    el('legend', { text: 'Swing' }),
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
  const previous = select.value;
  select.replaceChildren(...real.map((s) => el('option', { value: s.id, text: s.name })));
  if (real.some((s) => s.id === previous)) select.value = previous;
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
    sources: settings.sources,
    input: section.querySelector('.signal-flow-swing-source').value,
    output: settings.output,
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
  const entries = swing.signals.filter((s) => s.role !== 'source').map((s, i) => ({ key: s.key, label: s.name, index: swing.signals.indexOf(s), order: i }));
  const traces = entries.map((entry, i) => ({
    key: entry.key,
    label: entry.label,
    color: TRACE_COLORS[i % TRACE_COLORS.length],
    points: swing.points.map((p) => ({ a: p.a, db: p.overloaded ? null : db(p.peaks[entry.index]) })),
  }));
  if (swing.points.some((p) => p.tone !== null && p.tone !== undefined)) {
    const output = swing.signals.find((s) => s.key === settings.output);
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
  return figureSvg(responseFigure(plot, { width: 400, height: 220, fontSize: 11 }), 'Magnitude responses');
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
const graphPlot = (list) => responsePlot(list.map((trace) => ({ ...trace, value: numeric(trace.value, trace.variable) })), 's', { sAxis: sAxisSetting(), band: editor.circuit.analysisValues.band });
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
  traces.push({ id, label: entry.label, equation: entry.equation, color, value: entry.value, variable, on: true });
}

function renderGraph() {
  const host = section.querySelector('.signal-flow-graph');
  host.replaceChildren();
  const plot = traces.length ? graphPlot(shownTraces()) : null;
  host.hidden = !traces.length;
  if (!traces.length) return;
  const head = el('div', { class: 'signal-flow-graph-head' }, [el('div', { class: 'analysis-equation-label', text: 'Magnitude' })]);
  // With an s result on it, the frequency axis is a choice: ω in the
  // coefficients' units, or f/fs reading s in units of 1/Ts (as a
  // continuous-time loop filter normalized to its sample rate is written).
  if (traces.some((trace) => trace.variable === 's')) {
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
  host.append(head);
  host.append(bandControls());
  if (plot) host.append(graphSvg(plot));
  else host.append(el('p', { class: 'field-hint', text: 'Check a trace below to plot it.' }));
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

/** A plot on the drawing, under it at its left edge: its traces named
 *  beside it in their colours, the coefficients' numbers under them. */
function placePlot(plot, shown, used) {
  // One coefficient a line, left-aligned under the trace names.
  const numbers = resolved();
  const linkTex = (name) => {
    try { return `${expressionTex(parseCoefficientLink(links()[name]).ast)} = `; } catch { return ''; }
  };
  let values = used.map((name) => `${symbolText(name)} = ${Object.hasOwn(links(), name) ? linkTex(name) : ''}${Number((numbers[name] ?? 1).toPrecision(4))}`).join('\n');
  // The same numbers beside another plot already: not twice.
  const circuit = editor.circuit;
  if ([...circuit.labels.values()].some((label) => label.parent && circuit.labels.get(label.parent)?.plot && label.text === values)) values = '';
  // Under the drawing, at its left edge.
  const bounds = editor.circuit.bounds();
  const empty = !editor.circuit.components.size && !editor.circuit.labels.size;
  const x = empty ? 0 : snap(bounds.x);
  const y = empty ? 0 : snap(bounds.y + bounds.h + 2 * GRID);
  const w = 18 * GRID;
  const h = 11 * GRID;
  let box = null;
  const ids = [];
  commit(() => {
    box = editor.circuit.addAnnotation('box', { x, y, end: { x: x + w, y: y + h }, plot, style: { lineStyle: 'solid' } });
    let top = y;
    for (const trace of shown) {
      const label = editor.circuit.addLabel({ text: `$${trace.label}$`, math: true, parent: box.id, align: 'left', x: 0, y: 0, style: { color: trace.color } });
      const size = label.bbox();
      label.moveTo(snap(x + w + GRID + size.w / 2), snap(top + size.h / 2));
      top = label.bbox().y + label.bbox().h;
      ids.push(label.id);
    }
    if (values) {
      const label = editor.circuit.addLabel({ text: values, math: true, parent: box.id, align: 'left', x: 0, y: 0 });
      const size = label.bbox();
      label.moveTo(snap(x + w + GRID + size.w / 2), snap(top + size.h / 2));
      ids.push(label.id);
    }
  });
  if (!box) return;
  // Their sizes are estimates until the browser measures them: line their
  // left edges up then.
  alignLabelColumn(ids, { left: x + w + GRID, top: y, gap: 0 });
  setSelection([]);
  setLabelSelection([box.id]);
  logLine('placed the graph on the drawing; drag to move it, its corners to resize');
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
    appendTraceButton(block, entry);
    host.append(block);
  }
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
  latest = analyzeSignalFlow(editor.circuit, { output: settings.output, sources: settings.sources, values: resolved() });
  derivedRevision = editor.modelRevision;
  section.querySelector('.signal-flow-stale').hidden = true;
  // Each new response joins the graph, beside those already there.
  if (latest.ok) for (const entry of latest.entries) addTrace(entry, latest.variable, latest.output);
  renderCoefficients();
  renderResults();
  renderGraph();
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
  const output = el('select', { id: 'signal-flow-output', onchange: (ev) => { settings.output = ev.target.value; } });
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
    el('div', { class: 'signal-flow-graph', hidden: true }),
    swingSection(),
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
