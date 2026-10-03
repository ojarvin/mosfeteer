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

import { TRACE_COLORS, analyzeSignalFlow, complexText, hasSignalFlow, responsePlot, signalFlowGraph } from '../core/analysis/signal-flow.js';
import { responseFigure } from '../core/bode-figure.js';
import { parseLabelRuns } from '../core/model.js';
import { texToMathML } from '../core/render.js';
import { GRID, snap } from '../core/grid.js';
import { editor } from './editor-state.js';
import { analysisDialog } from './elements.js';
import { commit, render, setLabelSelection, setSelection } from './main.js';
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
    table.append(el('div', { class: 'signal-flow-source' }, [el('span', { class: 'signal-flow-source-name', text: source.name }), select, constant]));
  }
  const problems = section.querySelector('.signal-flow-issues');
  problems.replaceChildren(...issues.map((issue) => el('p', { class: 'analysis-error', text: issue.message })));
  problems.hidden = !issues.length;
  section.querySelector('.signal-flow-stale').hidden = !latest || derivedRevision === editor.modelRevision;
}

// ----- results --------------------------------------------------------------------------

function mathRow(label, tex) {
  const value = el('div', { class: 'analysis-equation-value', 'aria-label': tex });
  value.innerHTML = texToMathML(tex);
  return el('div', { class: 'analysis-equation-row' }, [el('div', { class: 'analysis-equation-label', text: label }), value]);
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
  const figure = responseFigure(plot, { width: 400, height: 220, fontSize: 11 });
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${figure.width} ${figure.height}`);
  svg.setAttribute('class', 'signal-flow-plot');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Magnitude responses');
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

const traceVariable = () => traces[0]?.variable || null;
const shownTraces = () => traces.filter((trace) => trace.on);

/** Add an entry's response to the graph (a graph keeps one variable). */
function addTrace(entry, variable, output) {
  if (traceVariable() && traceVariable() !== variable) traces = [];
  const id = `${output.key}\n${entry.input}\n${entry.equation}`;
  if (traces.some((trace) => trace.id === id)) return;
  const used = new Set(traces.map((trace) => trace.color));
  const color = TRACE_COLORS.find((candidate) => !used.has(candidate)) || TRACE_COLORS[traces.length % TRACE_COLORS.length];
  traces.push({ id, label: entry.equation, color, value: entry.value, variable, on: true });
}

function renderGraph() {
  const host = section.querySelector('.signal-flow-graph');
  host.replaceChildren();
  const plot = traces.length ? responsePlot(shownTraces(), traceVariable()) : null;
  host.hidden = !traces.length;
  if (!traces.length) return;
  host.append(el('div', { class: 'analysis-equation-label', text: 'Magnitude' }));
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
    const remove = el('button', { type: 'button', class: 'signal-flow-legend-remove', 'aria-label': 'Remove this trace', title: 'Remove this trace from the graph', text: '×', onclick: () => { traces = traces.filter((t) => t !== trace); renderGraph(); } });
    legend.append(el('div', { class: 'signal-flow-legend-row' }, [check, el('span', { class: 'signal-flow-swatch', style: `background:${trace.color}` }), math, remove]));
  }
  host.append(legend);
  host.append(el('div', { class: 'signal-flow-graph-actions' }, [
    el('button', { type: 'button', text: 'Clear graph', onclick: () => { traces = []; renderGraph(); renderResults(); } }),
    el('button', { type: 'button', text: 'Annotate graph', title: 'Put this graph on the drawing, its traces named beside it', disabled: !plot, onclick: annotateGraph }),
  ]));
}

/** The graph on the drawing: a plot annotation, each trace's equation a
 *  math label in its colour beside it (children of the box, moving with it). */
function annotateGraph() {
  const shown = shownTraces();
  const plot = responsePlot(shown, traceVariable());
  if (!plot) return;
  const bounds = editor.circuit.bounds();
  const empty = !editor.circuit.components.size && !editor.circuit.labels.size;
  const x = empty ? 0 : snap(bounds.x + bounds.w + 2 * GRID);
  const y = empty ? 0 : snap(bounds.y);
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
  });
  if (!box) return;
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
    block.append(mathRow(`From ${entry.inputName}`, entry.equation));
    if (entry.zeros?.length) block.append(rootRow('Zeros', entry.zeros, latest.variable));
    if (entry.poles?.length) block.append(rootRow('Poles', entry.poles, latest.variable));
    if (entry.poles !== null && entry.zeros !== null) {
      const id = `${latest.output.key}\n${entry.input}\n${entry.equation}`;
      const plotted = traces.some((trace) => trace.id === id);
      block.append(el('div', { class: 'signal-flow-entry-actions' }, [
        el('button', { type: 'button', text: plotted ? 'On the graph' : 'Add to graph', disabled: plotted, onclick: () => { addTrace(entry, latest.variable, latest.output); renderGraph(); renderResults(); } }),
      ]));
    }
    host.append(block);
  }
}

function rootRow(label, roots, variable) {
  const unit = variable === 'z' && label === 'Poles' ? ' (stable inside |z| = 1)' : '';
  return el('div', { class: 'analysis-equation-row' }, [
    el('div', { class: 'analysis-equation-label', text: `${label}${unit}` }),
    el('div', { class: 'signal-flow-roots', text: roots.map(complexText).join(',  ') }),
  ]);
}

function derive() {
  latest = analyzeSignalFlow(editor.circuit, { output: settings.output, sources: settings.sources });
  derivedRevision = editor.modelRevision;
  section.querySelector('.signal-flow-stale').hidden = true;
  // Each new numeric response joins the graph, beside those already there.
  if (latest.ok) for (const entry of latest.entries) if (entry.poles !== null && entry.zeros !== null) addTrace(entry, latest.variable, latest.output);
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
      const label = editor.circuit.addLabel({ text: `$${entry.equation}$`, x: 0, y: 0, align: 'left', math: true });
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
    el('div', { class: 'signal-flow-graph', hidden: true }),
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
