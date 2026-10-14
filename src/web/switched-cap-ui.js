/**
 * The analysis window's switched-capacitor mode: a drawn SC circuit's exact
 * H(z) (core/analysis/switched-cap.js), beside the circuit and signal-flow
 * modes. The clock is the timing diagram's (or the beats'); the form picks
 * the input and output (a port of any kind, or any net) and the phase whose
 * end the output is read at, shows each phase's closed switches, and Derive
 * gives the equation. It works as the other modes do: the capacitances are
 * Values rows (value-row.js, saved with the design as `analysisValues.sc`),
 * and each Derive adds its result to the Plots window's graph -- magnitude
 * or phase over f/f_s, a legend to show or take off each, Annotate graph to
 * put it on the drawing.
 */

import { analyzeSwitchedCap, switchedCapPhases } from '../core/analysis/switched-cap.js';
import { TRACE_COLORS, complexText, numericRootsOf, responsePlot, resultSymbols, withCoefficients } from '../core/analysis/signal-flow.js';
import { symbolText } from '../core/analysis/present.js';
import { responseSpec } from '../core/plot-spec.js';
import { plainTexText, texToMathML } from '../core/render.js';
import { GRID, snap } from '../core/grid.js';
import { switchState } from '../core/beats.js';
import { canonicalNetName } from '../core/model.js';
import { createPlotView } from './plot-view.js';
import { installPlotsWindow, offerPlots, showPlots } from './plots-window.js';
import { placeResponsePlot, registerAnalysisMode } from './signal-flow-ui.js';
import { valueRow } from './value-row.js';
import { PER_DECADE } from './e-series.js';
import { editor } from './editor-state.js';
import { commit, markSettingsChanged, onDocumentShown, render, setLabelSelection, setSelection } from './main.js';
import { logLine } from './status-bar-ui.js';
import { buttonIcon } from './icons.js';
import { element as el } from './dom.js';

const settings = () => (editor.circuit.analysisValues.sc ||= { input: '', output: '', readout: '', values: {} });

let section = null;
let annotateButton = null; // in the window's footer, shown with a result
let latest = null; // { revision, result }
// The graph's traces, as the Bode graph keeps them: each Derive's result,
// { id, label, color, value, on }; and its view, magnitude or phase.
let traces = [];
let view = 'magnitude';
let plotsEl = null;
let graph = null;
let saveFrame = 0;

/** A drawing the mode suits: switches and capacitors, and nothing an SC
 *  circuit is not made of. */
function suggested(circuit) {
  const parts = [...circuit.components.values()];
  return parts.some((c) => switchState(c)) && parts.some((c) => c.type === 'capacitor')
    && !parts.some((c) => /^(nmos|pmos|nmosb|pmosb|npn|pnp|resistor|inductor|current_source|voltage_source|vccs|vcvs|gm|diode)$/.test(c.type));
}

/** TeX as MathML, inline or on a line of its own. */
function math(tex, display = false) {
  const span = el('span', { class: `sc-math${display ? ' display' : ''}` });
  const markup = texToMathML(tex);
  span.innerHTML = display ? markup : markup.replace('display="block"', 'display="inline"');
  return span;
}

/** A phase's name as written: TeX drawn as math, plain text as it is. */
const phaseName = (name) => (/^\$.*\$$/.test(name) ? math(name.replace(/^\$+|\$+$/g, '')) : el('span', { text: name }));

// The port kinds a select offers first for each role.
const PORT_TYPES = { input: ['input', 'inputoutput', 'port'], output: ['output', 'inputoutput', 'port'] };

/** What a select offers: the drawing's ports of that role (input, output,
 *  in/out, or plain ports), then every other net -- named ones by name,
 *  the rest by id. Each as { value, text }. */
function netChoices(role) {
  const circuit = editor.circuit;
  const valueOf = (net) => canonicalNetName(net.name) || net.id;
  const ports = [];
  const seen = new Set();
  for (const component of circuit.components.values()) {
    if (!PORT_TYPES[role].includes(component.type)) continue;
    const net = circuit.netOfTerminal({ comp: component.refdes, term: 'p' });
    if (!net || seen.has(valueOf(net))) continue;
    seen.add(valueOf(net));
    ports.push({ value: valueOf(net), text: plainTexText(valueOf(net)) });
  }
  const nets = [];
  for (const net of circuit.nets.values()) {
    const value = valueOf(net);
    if (seen.has(value)) continue;
    seen.add(value);
    nets.push({ value, text: net.name ? plainTexText(value) : `${net.id} (unnamed)` });
  }
  nets.sort((a, b) => a.text.localeCompare(b.text, undefined, { numeric: true }));
  return { ports, nets };
}

function fillPortSelect(select, role, chosen) {
  const { ports, nets } = netChoices(role);
  const option = ({ value, text }) => el('option', { value, text });
  select.replaceChildren(
    el('option', { value: '', text: `the ${role} port` }),
    ...(ports.length ? [el('optgroup', { label: 'Ports' }, ports.map(option))] : []),
    ...(nets.length ? [el('optgroup', { label: 'Nets' }, nets.map(option))] : []),
  );
  // A net chosen before keeps its place even if nothing offers it now.
  if (chosen && ![...ports, ...nets].some((choice) => choice.value === chosen)) select.append(option({ value: chosen, text: plainTexText(chosen) }));
  select.value = chosen || '';
}

/** The form from the drawing as it is now: ports, phases, and the clock. */
function fillForm() {
  if (!section) return;
  const s = settings();
  fillPortSelect(section.querySelector('#sc-input'), 'input', s.input);
  fillPortSelect(section.querySelector('#sc-output'), 'output', s.output);
  const phases = switchedCapPhases(editor.circuit);
  const readout = section.querySelector('#sc-readout');
  const states = phases.ok ? phases.states : [];
  readout.replaceChildren(
    el('option', { value: '', text: 'end of the last phase' }),
    ...states.map((state) => el('option', { value: state.name, text: `end of ${plainTexText(state.name)}` })),
  );
  readout.value = states.some((state) => state.name === s.readout) ? s.readout : '';
  const card = section.querySelector('.sc-phases');
  if (!phases.ok) {
    card.replaceChildren(el('p', { class: 'field-hint', text: phases.error }));
    return;
  }
  card.replaceChildren(el('table', { class: 'sc-phase-table' }, [
    el('tbody', {}, states.map((state, index) => el('tr', {}, [
      el('td', { class: 'sc-phase-index', text: String(index + 1) }),
      el('td', { class: 'sc-phase-name' }, [phaseName(state.name)]),
      el('td', { class: 'sc-phase-closed', text: state.closed.size ? `${[...state.closed].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).join(', ')} closed` : 'all open' }),
    ]))),
  ]), el('p', { class: 'field-hint', text: `From the ${phases.source === 'timing' ? 'timing diagram' : 'beats'}: one period, phase after phase.` }));
}

// ----- the capacitances ------------------------------------------------------------------

// A finite-gain op-amp's gain (A1) starts at 60 dB; a capacitance at 1.
const DEFAULT_GAIN = 1000;
/** The gains' symbols the latest result and the graph's traces hold. */
function gainSymbols() {
  return new Set([...(latest?.result.gains || []), ...traces.flatMap((trace) => trace.gains || [])]);
}
/** A value's number: as set, else its kind's default. */
const capacitance = (name) => settings().values[name] ?? (gainSymbols().has(name) ? DEFAULT_GAIN : 1);

/** Every capacitance the latest result and the graph's traces reach. */
function shownSymbols() {
  const names = new Set();
  const add = (value) => { for (const name of resultSymbols(value, 'z')) names.add(name); };
  if (latest?.result.ok) add(latest.result.value);
  for (const trace of traces) add(trace.value);
  return [...names].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/** A result at the capacitances' numbers. */
function numbered(value) {
  return withCoefficients(value, Object.fromEntries(resultSymbols(value, 'z').map((name) => [name, capacitance(name)])));
}

/** Saved once a frame while a slider moves: one undo step a finished
 *  adjustment (markSettingsChanged), as the Bode graph's Values. */
function saveValues() {
  if (saveFrame) return;
  saveFrame = requestAnimationFrame(() => {
    saveFrame = 0;
    markSettingsChanged();
  });
}

let shownRows = '';
/** The Capacitances rows: rebuilt only when the symbols change, so a
 *  slider being dragged is never replaced under the pointer. */
function renderValues({ force = false } = {}) {
  const host = section.querySelector('.sc-values');
  const names = shownSymbols();
  host.hidden = !names.length;
  const rows = host.querySelector('.sc-value-rows');
  const key = names.join('\n');
  if (!force && key === shownRows && rows.children.length) return;
  shownRows = key;
  const gains = gainSymbols();
  rows.replaceChildren(...names.map((name) => valueRow({
    name,
    tex: symbolText(name),
    value: capacitance(name),
    // A gain from 1 to 10^6; a capacitance three decades either way of 1.
    min: gains.has(name) ? 0 : -3 * PER_DECADE,
    max: gains.has(name) ? 6 * PER_DECADE : 3 * PER_DECADE,
    onValue: (number) => {
      settings().values[name] = number;
      saveValues();
      renderRoots();
      renderPlots();
    },
  })));
}

// ----- deriving --------------------------------------------------------------------------

function derive() {
  const s = settings();
  const result = analyzeSwitchedCap(editor.circuit, { input: s.input || undefined, output: s.output || undefined, readout: s.readout || undefined });
  latest = { revision: editor.modelRevision, result };
  if (result.ok) addTrace(result);
  renderResult();
  renderPlots();
  if (result.ok) offerPlots();
}

/** A result onto the graph, as each Derive adds its gain to the Bode graph:
 *  the same equation again replaces its trace. */
function addTrace(result) {
  const label = result.equation;
  const existing = traces.find((trace) => trace.label === label);
  if (existing) {
    existing.value = result.value;
    existing.gains = result.gains;
    existing.on = true;
    return;
  }
  const used = new Set(traces.map((trace) => trace.color));
  const color = TRACE_COLORS.find((candidate) => !used.has(candidate)) || TRACE_COLORS[traces.length % TRACE_COLORS.length];
  traces.push({ id: `sc-${traces.length}-${label}`, label, color, value: result.value, gains: result.gains, on: true });
}

/** What Derive found: the equation (or why there is none), and its poles
 *  and zeros at the capacitances' numbers. */
function renderResult() {
  const host = section.querySelector('.sc-results');
  section.querySelector('.sc-stale').hidden = !latest || latest.revision === editor.modelRevision;
  if (annotateButton) annotateButton.hidden = !latest?.result.ok;
  if (!latest) { host.replaceChildren(); renderValues(); return; }
  const { result } = latest;
  if (!result.ok) {
    host.replaceChildren(el('div', { class: 'analysis-error sc-error', role: 'status', text: result.error }));
    renderValues();
    return;
  }
  host.replaceChildren(
    el('div', { class: 'sc-equation' }, [math(result.equation, true)]),
    el('p', { class: 'field-hint' }, ['Read at the end of ', phaseName(result.states[result.readout].name), ', the input held through each period.']),
    el('div', { class: 'sc-roots' }),
  );
  renderRoots();
  renderValues();
}

function renderRoots() {
  const host = section?.querySelector('.sc-roots');
  if (!host || !latest?.result.ok) return;
  const roots = numericRootsOf(numbered(latest.result.value));
  const line = (label, items) => (items?.length ? el('p', { class: 'sc-root-line' }, [`${label}: `, items.map((root) => `z = ${complexText(root)}`).join(', ')]) : null);
  host.replaceChildren(...[line('Poles', roots.poles), line('Zeros', roots.zeros)].filter(Boolean));
}

// ----- the graph -------------------------------------------------------------------------

const shownTraces = () => traces.filter((trace) => trace.on);

/** The graph's plot: the shown traces at the numbers, magnitude or phase. */
function graphPlot() {
  const shown = shownTraces();
  if (!shown.length) return null;
  return responsePlot(shown.map((trace) => ({ ...trace, value: numbered(trace.value), variable: 'z' })), 'z', { quantity: view });
}

function viewButton(key, text, title) {
  return el('button', { type: 'button', text, title, 'aria-pressed': String(view === key), onclick: () => { view = key; renderPlots(); } });
}

/** The Plots window's view of this mode: as the Bode graph -- its view,
 *  the graph, a legend to show or take off each trace, then Clear and
 *  Annotate graph. */
function renderPlots() {
  if (!plotsEl) return;
  const head = plotsEl.querySelector('.sc-plots-head');
  const host = plotsEl.querySelector('.sc-graph');
  plotsEl.querySelector('.sc-plots-empty').hidden = traces.length > 0;
  head.hidden = !traces.length;
  head.replaceChildren(el('div', { class: 'segmented signal-flow-view', role: 'group', 'aria-label': 'Plot' }, [
    viewButton('magnitude', 'Magnitude', 'The magnitudes, in dB'),
    viewButton('phase', 'Phase', 'The phases, in degrees'),
  ]));
  const plot = graphPlot();
  // The plot stays in place while it redraws (a zoomed view stays too).
  if (!graph) graph = createPlotView({ height: 260, aspect: 0.6 });
  if (plot) {
    if (graph.el.parentNode !== host) host.replaceChildren(graph.el);
    graph.set(responseSpec(plot));
  } else {
    host.replaceChildren(el('p', { class: 'field-hint', text: traces.length ? 'Check a trace below to plot it.' : '' }));
  }
  const legend = plotsEl.querySelector('.sc-legend');
  legend.replaceChildren(...traces.map((trace) => {
    const check = el('input', { type: 'checkbox', 'aria-label': 'Show this trace' });
    check.checked = trace.on;
    check.addEventListener('change', () => { trace.on = check.checked; renderPlots(); });
    const label = el('span', { class: 'signal-flow-legend-math' });
    label.innerHTML = texToMathML(trace.label);
    label.style.color = trace.color;
    const remove = el('button', { type: 'button', class: 'signal-flow-legend-remove', 'aria-label': 'Remove this trace', title: 'Remove this trace from the graph', text: '×', onclick: () => { traces = traces.filter((t) => t !== trace); renderValues(); renderPlots(); } });
    return el('div', { class: 'signal-flow-legend-row' }, [check, el('span', { class: 'signal-flow-swatch', style: `background:${trace.color}` }), label, remove]);
  }));
  const actions = plotsEl.querySelector('.sc-plots-actions');
  actions.hidden = !traces.length;
  actions.replaceChildren(
    el('button', { type: 'button', text: 'Clear graph', onclick: () => { traces = []; renderValues(); renderPlots(); } }),
    el('button', { type: 'button', class: 'sc-annotate-graph', text: 'Annotate graph', title: 'Put this graph on the drawing, its traces named beside it', disabled: !plot, onclick: () => { if (plot) placeResponsePlot(plot, shownTraces()); } }),
  );
}

// ----- the drawing -----------------------------------------------------------------------

/** Write the equation under the drawing, as the signal-flow mode writes its. */
function annotate() {
  const result = latest?.result;
  if (!result?.ok) return;
  const bounds = editor.circuit.bounds();
  const left = bounds.w > 0 ? bounds.x : editor.cursor.x;
  const top = (bounds.h > 0 ? bounds.y + bounds.h : editor.cursor.y) + 2 * GRID;
  let id = null;
  commit(() => {
    const label = editor.circuit.addLabel({ text: `$${result.equation}$`, x: 0, y: 0, align: 'left', math: true });
    const box = label.bbox();
    label.moveTo(snap(left + box.w / 2), snap(top + box.h / 2));
    id = label.id;
  });
  setSelection([]);
  setLabelSelection([id]);
  render();
  logLine('equation written under the drawing');
}

// ----- install ---------------------------------------------------------------------------

export function installSwitchedCapUi() {
  const select = (id, key) => el('select', { id, onchange: (ev) => { settings()[key] = ev.target.value; markSettingsChanged(); } });
  const row = (label, id, control) => el('div', { class: 'signal-flow-source' }, [el('label', { for: id, class: 'signal-flow-source-name', text: label }), control]);
  section = el('div', { id: 'analysis-switched-cap', class: 'signal-flow-section sc-section', hidden: true }, [
    el('p', { class: 'analysis-intro', text: 'Each phase of the clock closes its switches; charge is kept from phase to phase. Op-amps are ideal, the input is held through each period, and the output is read at the end of the phase you pick: Derive gives its exact H(z).' }),
    el('fieldset', { class: 'analysis-approximations' }, [
      el('legend', { text: 'Signals' }),
      row('Input', 'sc-input', select('sc-input', 'input')),
      row('Output', 'sc-output', select('sc-output', 'output')),
      row('Read at', 'sc-readout', select('sc-readout', 'readout')),
      el('p', { class: 'field-hint', text: 'A port of any kind, or any net.' }),
    ]),
    el('fieldset', { class: 'analysis-approximations' }, [el('legend', { text: 'Phases' }), el('div', { class: 'sc-phases' })]),
    el('p', { class: 'analysis-stale sc-stale', hidden: true, text: 'The circuit changed since this was derived.' }),
    el('div', { class: 'sc-results', 'aria-live': 'polite' }),
    el('div', { class: 'signal-flow-plots' }, [
      el('div', { class: 'card-heading', text: 'Plots' }),
      el('div', { class: 'signal-flow-plots-open' }, [
        el('span', { class: 'field-hint', text: 'Each Derive adds its result to the graph: magnitude and phase over f/f_s.' }),
        el('button', { type: 'button', title: 'Show the Plots window (Shift+W)', onclick: () => showPlots() }, [buttonIcon('plots'), 'Show plots']),
      ]),
    ]),
    el('fieldset', { class: 'analysis-approximations signal-flow-coefficients sc-values', hidden: true }, [
      el('legend', { text: 'Values' }),
      el('div', { class: 'signal-flow-coefficient-rows sc-value-rows' }),
      el('p', { class: 'field-hint', text: 'The capacitances, and the gain of each finite-gain op-amp (its small-signal model): the graph and the poles and zeros use these numbers; the equation stays symbolic. Slide, or type any value. A capacitor valued C_S (or 2*C_u) shares that symbol with every capacitor of the same value.' }),
    ]),
  ]);
  annotateButton = el('button', { type: 'button', class: 'sc-annotate', 'data-icon': 'text', hidden: true, text: 'Annotate equation', title: 'Write the equation under the drawing', onclick: annotate });
  const actions = [
    annotateButton,
    el('button', { type: 'button', class: 'primary-action sc-derive', 'data-icon': 'check', text: 'Derive', title: 'Derive the transfer function (Enter)', onclick: derive }),
  ];
  // Enter in a field derives here.
  section.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' || ev.target.tagName === 'BUTTON') return;
    ev.preventDefault();
    derive();
  });
  // The drawing may have changed while the window was open.
  let filled = -1;
  section.addEventListener('pointerenter', () => {
    if (filled === editor.modelRevision) return;
    filled = editor.modelRevision;
    fillForm();
    if (latest) section.querySelector('.sc-stale').hidden = latest.revision === editor.modelRevision;
  });
  registerAnalysisMode({
    mode: 'switched-cap',
    label: 'Switched-cap',
    hint: 'The exact H(z) of a switched-capacitor circuit, phase by phase from its timing diagram',
    title: 'Switched-capacitor analysis',
    section,
    actions,
    suggested,
    shown: () => { fillForm(); renderResult(); },
  });
  // Its view in the Plots window, laid out as the Bode graph's.
  plotsEl = el('div', { class: 'sc-plots-view' }, [
    el('p', { class: 'field-hint sc-plots-empty', text: 'Derive a switched-capacitor circuit (Shift+S, Switched-cap) to plot its response.' }),
    el('div', { class: 'signal-flow-graph-head sc-plots-head', hidden: true }),
    el('div', { class: 'sc-graph' }),
    el('div', { class: 'signal-flow-legend sc-legend' }),
    el('div', { class: 'signal-flow-graph-actions sc-plots-actions', hidden: true }),
  ]);
  installPlotsWindow({ mode: 'switched-cap', view: plotsEl, shown: () => renderPlots() });
  // Another design starts with none of this one's results.
  onDocumentShown(() => {
    latest = null;
    traces = [];
    if (!section.hidden) { fillForm(); renderResult(); }
    renderPlots();
  });
}
