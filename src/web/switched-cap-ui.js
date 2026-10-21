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

import { analyzeSwitchedCap, switchedCapNoiseFigures, switchedCapPhases } from '../core/analysis/switched-cap.js';
import { calculate, siResult } from '../core/calculator.js';
import { TRACE_COLORS, complexText, transferTex, numericRootsOf, responsePlot, resultSymbols, withCoefficients } from '../core/analysis/signal-flow.js';
import { symbolText } from '../core/analysis/present.js';
import { responseSpec } from '../core/plot-spec.js';
import { plainTexText, texToMathML } from '../core/render.js';
import { switchState } from '../core/beats.js';
import { canonicalNetName } from '../core/model.js';
import { setPartValue } from '../core/part-moves.js';
import { createPlotView, linkPlots } from './plot-view.js';
import { installPlotsWindow, offerPlots } from './plots-window.js';
import { placeResponsePlot, registerAnalysisMode } from './signal-flow-ui.js';
import { valueRow } from './value-row.js';
import { PER_DECADE } from './e-series.js';
import { editor } from './editor-state.js';
import { commit, markSettingsChanged, onDocumentShown, render } from './main.js';
import { logLine } from './status-bar-ui.js';
import { element as el, onFieldCommit } from './dom.js';
import { annotateMathFigure } from './figure-annotate.js';
import { registerAnnotations } from './annotate-menu.js';

const settings = () => (editor.circuit.analysisValues.sc ||= { input: '', output: '', readout: '', values: {} });

let section = null;
let latest = null; // { revision, result }
// The graph's traces, as the Bode graph keeps them: each Derive's result,
// { id, label, color, value, on }.
let traces = [];
let plotsEl = null;
// Magnitude over phase on one frequency axis, as the Bode graph's.
let graphs = null;
let saveFrame = 0;

/** A drawing the mode suits: switches and capacitors, and nothing an SC
 *  circuit is not made of. */
function suggested(circuit) {
  const parts = [...circuit.components.values()];
  return parts.some((c) => switchState(c)) && parts.some((c) => c.type === 'capacitor')
    && !parts.some((c) => /^(nmos|pmos|nmosb|pmosb|npn|pnp|resistor|inductor|current_source|voltage_source|vccs|vcvs|gm|gm_cmfb|diode)$/.test(c.type));
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
  const result = analyzeSwitchedCap(editor.circuit, { input: s.input || undefined, output: s.output || undefined, readout: s.readout || undefined, noise: !!s.noise });
  latest = { revision: editor.modelRevision, result };
  if (result.ok) addTrace(result);
  renderResult();
  runCalculator();
  renderPlots();
  if (result.ok) offerPlots();
}

/** A result onto the graph, as each Derive adds its gain to the Bode graph:
 *  the same equation again replaces its trace. A trace is named by its ratio
 *  (V_OUT/V_IN), as the signal-flow graph's; the equation is its identity. */
function addTrace(result) {
  const existing = traces.find((trace) => trace.equation === result.equation);
  if (existing) {
    existing.value = result.value;
    existing.gains = result.gains;
    existing.on = true;
    return;
  }
  const used = new Set(traces.map((trace) => trace.color));
  const color = TRACE_COLORS.find((candidate) => !used.has(candidate)) || TRACE_COLORS[traces.length % TRACE_COLORS.length];
  traces.push({ id: `sc-${traces.length}-${result.equation}`, label: result.label, equation: result.equation, color, value: result.value, gains: result.gains, on: true });
}

/** What Derive found: the equation (or why there is none), and its poles
 *  and zeros at the capacitances' numbers. */
function renderResult() {
  const host = section.querySelector('.sc-results');
  section.querySelector('.sc-stale').hidden = !latest || latest.revision === editor.modelRevision;
  renderNoise();
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

// ----- noise -----------------------------------------------------------------------------

/** A contributor's parts, for the canvas to light up (as the small-signal
 *  noise table's devices do). */
const partsOf = (row) => [...row.switches, ...row.capacitors];

/** Light up `parts` on the drawing while a row is pointed at. */
function emphasize(parts) {
  const next = parts || [];
  if (next.length === editor.equationEmphasis.length && next.every((ref, i) => ref === editor.equationEmphasis[i])) return;
  editor.equationEmphasis = next;
  render();
}

/** A table in the small-signal noise table's style: a row per contributor
 *  (the switches it samples through, the capacitors, the phase), then the
 *  total; `cells(row)` gives each row's value cells. */
function noiseTable(headers, rows, total, cells) {
  const th = (content, attrs = {}) => el('th', attrs, [content]);
  const value = (cell) => el('td', { class: 'sc-noise-value' }, [cell]);
  const head = el('tr', {}, [th('Switches', { scope: 'col' }), th('Capacitors', { scope: 'col' }), th('Phase', { scope: 'col' }), ...headers.map((header) => th(header, { scope: 'col', class: 'sc-noise-value' }))]);
  const body = rows.map((row) => el('tr', { 'data-components': partsOf(row).join(' ') }, [
    th(row.switches.join(', '), { scope: 'row' }),
    el('td', { text: row.capacitors.join(', ') }),
    el('td', {}, [phaseName(row.phaseName)]),
    ...cells(row).map(value),
  ]));
  const totalRow = el('tr', { class: 'sc-noise-total' }, [th('Total', { scope: 'row', colspan: '3' }), ...cells(total).map(value)]);
  const table = el('table', {}, [el('thead', {}, [head]), el('tbody', {}, [...body, totalRow])]);
  table.addEventListener('pointerover', (ev) => {
    const row = ev.target.closest?.('tr[data-components]');
    emphasize(row ? row.dataset.components.split(' ') : []);
  });
  table.addEventListener('pointerleave', () => emphasize([]));
  return el('div', { class: 'analysis-noise-table sc-noise-table' }, [el('div', { class: 'analysis-noise-table-scroll' }, [table])]);
}

/** The noise section: off, a hint; on, each contributor in symbols. */
function renderNoise() {
  const host = section?.querySelector('.sc-noise-result');
  if (!host) return;
  const on = !!settings().noise;
  section.querySelector('#sc-noise-on').checked = on;
  section.querySelector('.sc-calc').hidden = !on;
  const result = latest?.result;
  if (!on || !result?.ok) { host.replaceChildren(); return; }
  const noise = result.noise;
  if (!noise) { host.replaceChildren(el('p', { class: 'field-hint', text: 'Derive to work it out.' })); return; }
  if (!noise.ok) { host.replaceChildren(el('p', { class: 'field-hint', role: 'status', text: noise.error })); return; }
  host.replaceChildren(noiseTable(
    [math('\\frac{\\overline{v^2_{n,in}}}{kT}')],
    noise.contributors,
    noise.total,
    (row) => [math(transferTex(row.input, 'z', { symbolicLead: true }))],
  ));
}

// The calculator's defaults: a capacitance 1 pF, a gain 60 dB, 27 °C, 1 MHz.
const CALC_DEFAULTS = { capacitance: '1p', gain: '1000', celsius: '27', fs: '1M' };

const calc = () => (settings().calc ||= { values: {} });

/** A field's number (SI suffixes and arithmetic, as the calculator takes
 *  them), or NaN. */
function fieldNumber(text) {
  try { return Number(calculate(String(text)).value); } catch { return NaN; }
}

/** The calculator's fields: a value for each symbol, the temperature, f_s. */
function renderCalculatorFields() {
  const host = section?.querySelector('.sc-calc-fields');
  if (!host) return;
  const result = latest?.result;
  const symbols = result?.ok ? result.symbols : [];
  const gains = new Set(result?.gains || []);
  const field = (label, value, placeholder, onInput, unit) => {
    const input = el('input', { type: 'text', class: 'sc-calc-field', value: value ?? '', placeholder, 'aria-label': plainTexText(label) });
    // Applied once entered; the fields stay as they are, focus too.
    onFieldCommit(input, (text) => { onInput(text.trim()); markSettingsChanged(); calculatorResult(); });
    return el('div', { class: 'sc-calc-row' }, [el('span', { class: 'signal-flow-source-name' }, [math(label)]), input, el('span', { class: 'sc-calc-unit', text: unit })]);
  };
  host.replaceChildren(
    ...symbols.map((name) => field(symbolText(name), calc().values[name], gains.has(name) ? CALC_DEFAULTS.gain : CALC_DEFAULTS.capacitance, (text) => { if (text) calc().values[name] = text; else delete calc().values[name]; }, gains.has(name) ? '' : 'F')),
    field('T', calc().celsius, CALC_DEFAULTS.celsius, (text) => { calc().celsius = text; }, '°C'),
    field('f_s', calc().fs, CALC_DEFAULTS.fs, (text) => { calc().fs = text; }, 'Hz'),
  );
  const linked = sizedCapacitors();
  section.querySelector('.sc-calc-sizing').hidden = !linked.length;
}

// ----- the sizing table ------------------------------------------------------------------

/** The calculator's symbols that are a capacitor's own (its refdes, its
 *  value a number or none), each with its part: what the sizing table's
 *  Value column holds. A shared symbol (C_S) is no one part's value. */
function sizedCapacitors() {
  const result = latest?.result;
  if (!result?.ok) return [];
  const gains = new Set(result.gains || []);
  return result.symbols.flatMap((name) => {
    const part = editor.circuit.components.get(name);
    return !gains.has(name) && result.capacitors.includes(name) && part ? [{ name, part }] : [];
  });
}

/** A part's value as the calculator takes it (1 pF as 1p), or null when it
 *  is not a number. */
function calculatorText(value) {
  const text = String(value ?? '').replace(/\s+/g, '').replace(/F$/, '');
  return text && fieldNumber(text) > 0 ? text : null;
}

/** Each capacitor's value from the sizing table into its field. */
function readSizing() {
  const read = [];
  for (const { name, part } of sizedCapacitors()) {
    const text = calculatorText(part.value);
    if (!text) continue;
    calc().values[name] = text;
    read.push(name);
  }
  if (!read.length) { logLine('the sizing table has no number for these capacitors', 'error'); return; }
  markSettingsChanged();
  runCalculator();
  logLine(`read ${read.join(', ')} from the sizing table`);
}

/** Each capacitor's field into the sizing table: one undo step. */
function writeSizing() {
  const values = sizedCapacitors().map(({ name }) => ({ name, farads: fieldNumber(calc().values[name] || CALC_DEFAULTS.capacitance) }));
  const bad = values.find(({ farads }) => !(farads > 0));
  if (bad) { logLine(`${bad.name}: ${calc().values[bad.name]} is not a capacitance`, 'error'); return; }
  if (!values.length) return;
  // A bare number would read as a coefficient; a unit keeps it a value.
  const done = commit(() => {
    for (const { name, farads } of values) setPartValue(editor.circuit, name, siResult(farads) || `${farads}F`);
    return true;
  });
  if (done) logLine(`wrote ${values.map(({ name }) => name).join(', ')} to the sizing table`);
}

/** A value with its unit, prefixed: 64.37 µV, 91.04 nV/√Hz. */
function volts(value, unit) {
  const prefixed = siResult(Number(value.toPrecision(4)));
  const [, number, prefix] = /^(-?[\d.e+-]+?)([a-zµ]?|[A-Z]?)$/i.exec(prefixed || '') || [null, String(Number(value.toPrecision(4))), ''];
  return `${Number(Number(number).toPrecision(4))} ${prefix}${unit}`;
}

/** The numbers: each contributor's input-referred RMS and density, and
 *  their total, at the calculator's values. */
function runCalculator() {
  if (!section) return;
  renderCalculatorFields();
  calculatorResult();
}

/** The calculator's table, its fields left as they are. */
function calculatorResult() {
  const host = section?.querySelector('.sc-calc-result');
  if (!host) return;
  const numbers = calculatorNumbers();
  section.querySelector('.sc-calc-annotate').disabled = !numbers?.figures.ok;
  if (!numbers) { host.replaceChildren(); return; }
  const { figures } = numbers;
  if (!figures.ok) { host.replaceChildren(el('p', { class: 'field-hint', role: 'status', text: figures.error })); return; }
  host.replaceChildren(noiseTable(['RMS', 'Density'], figures.contributors, figures.total, (row) => [volts(row.rms, 'V'), volts(row.density, 'V/√Hz')]));
}

/** The calculator's figures at its numbers: { figures, values, celsius,
 *  fs }, or null with the noise off or nothing derived. */
function calculatorNumbers() {
  const result = latest?.result;
  if (!settings().noise || !result?.ok) return null;
  const gains = new Set(result.gains || []);
  const values = Object.fromEntries(result.symbols.map((name) => [name, fieldNumber(calc().values[name] || (gains.has(name) ? CALC_DEFAULTS.gain : CALC_DEFAULTS.capacitance))]));
  const s = settings();
  const celsius = fieldNumber(calc().celsius || CALC_DEFAULTS.celsius);
  const fs = fieldNumber(calc().fs || CALC_DEFAULTS.fs);
  const figures = switchedCapNoiseFigures(editor.circuit, {
    input: s.input || undefined, output: s.output || undefined, readout: s.readout || undefined,
    symbols: result.symbols, gains: result.gains, values, celsius, fs,
  });
  return { figures, values, gains, celsius, fs };
}

/**
 * The calculator's numbers on the drawing as the kT/C noise table
 * (figure-annotate.js): a row per contributor -- its switches, capacitors,
 * phase, RMS and density -- the total under a rule, and the numbers they
 * were worked out at. Annotating again rewrites the table there.
 */
function annotateNoise() {
  const numbers = calculatorNumbers();
  if (!numbers?.figures.ok) return;
  const { figures, values, gains, celsius, fs } = numbers;
  const words = (text) => `\\text{${text}}`;
  const phase = (name) => (/^\$.*\$$/.test(name) ? name.replace(/^\$+|\$+$/g, '') : words(name));
  const cells = (row) => [words(volts(row.rms, 'V')), `${words(volts(row.density, 'V'))}/\\sqrt{\\mathrm{Hz}}`];
  const rows = [
    [words('Switches'), words('Capacitors'), words('Phase'), words('RMS'), words('Density')].join(' & '),
    '\\hline',
    ...figures.contributors.map((row) => [words(row.switches.join(', ')), words(row.capacitors.join(', ')), phase(row.phaseName), ...cells(row)].join(' & ')),
    '\\hline',
    [words('Total'), '', '', ...cells(figures.total)].join(' & '),
  ];
  const at = Object.entries(values).map(([name, value]) => `${symbolText(name)} = ${gains.has(name) ? Number(value.toPrecision(4)) : words(volts(value, 'F'))}`);
  rows.push(`${words('At ')} T = ${words(`${Number(celsius.toPrecision(4))} °C`)},\\ f_{s} = ${words(volts(fs, 'Hz'))}${at.length ? `,\\ ${at.join(',\\ ')}` : ''}`);
  const { updated } = annotateMathFigure({ kind: 'noise', source: 'switched-cap', text: rows.join('\n'), columns: 'lllrr' });
  logLine(updated ? 'updated the kT/C noise table' : 'annotated the kT/C noise table');
}

// ----- the graph -------------------------------------------------------------------------

const shownTraces = () => traces.filter((trace) => trace.on);

/** The graph's plot: the shown traces at the numbers, magnitude or phase. */
function graphPlot(quantity = 'magnitude') {
  const shown = shownTraces();
  if (!shown.length) return null;
  return responsePlot(shown.map((trace) => ({ ...trace, value: numbered(trace.value), variable: 'z' })), 'z', { quantity });
}

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

/** The Plots window's view of this mode: as the Bode graph -- magnitude
 *  over phase, a legend to show or take off each trace, then Clear and
 *  Annotate graph. */
function renderPlots() {
  if (!plotsEl) return;
  const head = plotsEl.querySelector('.sc-plots-head');
  const host = plotsEl.querySelector('.sc-graph');
  plotsEl.querySelector('.sc-plots-empty').hidden = traces.length > 0;
  head.hidden = true;
  const plot = graphPlot();
  // The plots stay in place while they redraw (a zoomed view stays too).
  const { magnitude, phase } = stackedGraphs();
  if (plot) {
    if (magnitude.el.parentNode !== host) host.replaceChildren(magnitude.el, phase.el);
    magnitude.set(responseSpec(plot));
    phase.set(responseSpec(graphPlot('phase')));
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
    el('button', { type: 'button', class: 'sc-annotate-graph', text: 'Annotate graph', title: 'Annotate the graph', disabled: !plot, onclick: () => { if (plot) placeResponsePlot(plot, shownTraces(), { source: 'switched-cap' }); } }),
  );
}

// ----- the drawing -----------------------------------------------------------------------

/** The equation on the drawing as the switched-cap table
 *  (figure-annotate.js): the transfer function and the phase it is read
 *  at, and with the noise worked out, the input-referred kT/C noise.
 *  Annotating again rewrites the table there. */
function annotate() {
  const result = latest?.result;
  if (!result?.ok) return;
  const tex = (name) => (/^\$.*\$$/.test(name) ? name.replace(/^\$+|\$+$/g, '') : `\\text{${name}}`);
  const rows = [
    `\\text{Transfer function} & ${result.equation}`,
    `\\text{Read at the end of} & ${tex(result.states[result.readout].name)}`,
  ];
  if (result.noise?.ok) rows.push(`\\text{kT/C noise} & \\frac{\\overline{v^2_{n,in}}}{kT} = ${transferTex(result.noise.total.input, 'z', { symbolicLead: true })}`);
  const { updated } = annotateMathFigure({ kind: 'equations', source: 'switched-cap', text: rows.join('\n'), columns: 'll' });
  logLine(updated ? 'updated the equation table' : 'annotated the equation table');
}

// ----- install ---------------------------------------------------------------------------

export function installSwitchedCapUi() {
  const select = (id, key) => el('select', { id, onchange: (ev) => { settings()[key] = ev.target.value; markSettingsChanged(); } });
  const row = (label, id, control) => el('div', { class: 'signal-flow-source' }, [el('label', { for: id, class: 'signal-flow-source-name', text: label }), control]);
  section = el('div', { id: 'analysis-switched-cap', class: 'signal-flow-section sc-section', hidden: true }, [
    el('p', { class: 'analysis-intro', text: 'Derive gives the exact H(z) from the timing diagram\'s phases, and the kT/C noise when asked.' }),
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
    el('fieldset', { class: 'analysis-approximations sc-noise' }, [
      el('legend', { text: 'Noise' }),
      el('label', { class: 'sc-noise-toggle' }, [
        el('input', { type: 'checkbox', id: 'sc-noise-on', onchange: (ev) => { settings().noise = ev.target.checked; markSettingsChanged(); if (ev.target.checked && latest?.result.ok && !latest.result.noise) derive(); else { renderNoise(); runCalculator(); } } }),
        ' kT/C noise with each Derive',
      ]),
      el('div', { class: 'sc-noise-result' }),
      el('p', { class: 'field-hint', text: 'Switch noise, kT/C per phase, referred to the input. Op-amp noise is not included.' }),
    ]),
    el('fieldset', { class: 'analysis-approximations sc-calc', hidden: true }, [
      el('legend', { text: 'Noise calculator' }),
      el('div', { class: 'sc-calc-fields' }),
      el('div', { class: 'signal-flow-graph-actions sc-calc-sizing', hidden: true }, [
        el('button', { type: 'button', class: 'sc-calc-read', text: 'From sizing', title: 'Read the capacitances from the sizing table', onclick: readSizing }),
        el('button', { type: 'button', class: 'sc-calc-write', text: 'To sizing', title: 'Write the capacitances to the sizing table', onclick: writeSizing }),
      ]),
      el('div', { class: 'sc-calc-result', 'aria-live': 'polite' }),
      el('div', { class: 'signal-flow-graph-actions' }, [
        el('button', { type: 'button', class: 'sc-calc-annotate', text: 'Annotate table', title: 'Annotate the noise table', disabled: true, onclick: annotateNoise }),
      ]),
      el('p', { class: 'field-hint', text: 'Input-referred RMS over the band to f_s/2, and its white-noise density.' }),
    ]),
    el('fieldset', { class: 'analysis-approximations signal-flow-coefficients sc-values', hidden: true }, [
      el('legend', { text: 'Values' }),
      el('div', { class: 'signal-flow-coefficient-rows sc-value-rows' }),
      el('p', { class: 'field-hint', text: 'The plots and the poles and zeros use these numbers; the equation stays symbolic.' }),
    ]),
  ]);
  // What this mode puts on the drawing, in the window's Annotate menu.
  registerAnnotations('switched-cap', () => [
    { label: 'Equations', identity: { kind: 'equations', source: 'switched-cap' }, available: !!latest?.result.ok, run: annotate },
    { label: 'kT/C noise table', identity: { kind: 'noise', source: 'switched-cap' }, available: !!calculatorNumbers()?.figures.ok, run: annotateNoise },
    { label: 'Graph', identity: { kind: 'plot', source: 'switched-cap' }, available: !!graphPlot(), run: () => placeResponsePlot(graphPlot(), shownTraces(), { source: 'switched-cap' }) },
  ]);
  const actions = [
    el('button', { type: 'button', class: 'primary-action sc-derive', 'data-icon': 'check', text: 'Derive', title: 'Derive (Enter)', onclick: derive }),
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
    hint: 'Switched-capacitor analysis',
    title: 'Switched-capacitor analysis',
    section,
    actions,
    suggested,
    shown: () => { fillForm(); renderResult(); runCalculator(); },
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
    if (!section.hidden) { fillForm(); renderResult(); runCalculator(); }
    renderPlots();
  });
}
