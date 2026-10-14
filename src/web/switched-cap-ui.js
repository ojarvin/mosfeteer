/**
 * The analysis window's switched-capacitor mode: a drawn SC circuit's exact
 * H(z) (core/analysis/switched-cap.js), beside the circuit and signal-flow
 * modes. The clock is the timing diagram's (or the beats'); the form picks
 * the input, the output, and the phase whose end the output is read at,
 * shows each phase's closed switches, and Derive gives the equation. The
 * capacitances' numbers (saved with the design, `analysisValues.sc`) draw
 * its magnitude and phase over f/f_s in the Plots window.
 */

import { analyzeSwitchedCap, switchedCapPhases } from '../core/analysis/switched-cap.js';
import { TRACE_COLORS, complexText, numericRootsOf, responsePlot, resultSymbols, withCoefficients } from '../core/analysis/signal-flow.js';
import { responseSpec } from '../core/plot-spec.js';
import { plainTexText, texToMathML } from '../core/render.js';
import { GRID, snap } from '../core/grid.js';
import { switchState } from '../core/beats.js';
import { canonicalNetName } from '../core/model.js';
import { createPlotView, linkPlots } from './plot-view.js';
import { installPlotsWindow, offerPlots, showPlots } from './plots-window.js';
import { registerAnalysisMode } from './signal-flow-ui.js';
import { editor } from './editor-state.js';
import { commit, markSettingsChanged, onDocumentShown, render, setLabelSelection, setSelection } from './main.js';
import { logLine } from './status-bar-ui.js';
import { buttonIcon } from './icons.js';
import { element as el } from './dom.js';

const settings = () => (editor.circuit.analysisValues.sc ||= { input: '', output: '', readout: '', values: {} });

let section = null;
let annotateButton = null; // in the window's footer, shown with a result
let latest = null; // { revision, result }
let plots = null; // { magnitude, phase } plot views in the Plots window

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

/** The ports a select offers: the drawing's ports of that kind, by net name. */
function portChoices(type) {
  const names = new Set();
  for (const component of editor.circuit.components.values()) {
    if (component.type !== type) continue;
    const net = editor.circuit.netOfTerminal({ comp: component.refdes, term: 'p' });
    const name = canonicalNetName(net?.name) || component.refdes;
    names.add(name);
  }
  return [...names];
}

function fillSelect(select, choices, chosen, automatic) {
  select.replaceChildren(el('option', { value: '', text: automatic }), ...choices.map(({ value, text }) => el('option', { value, text })));
  select.value = choices.some((choice) => choice.value === chosen) ? chosen : '';
}

/** The form from the drawing as it is now: ports, phases, and the clock. */
function fillForm() {
  if (!section) return;
  const s = settings();
  fillSelect(section.querySelector('#sc-input'), portChoices('input').map((name) => ({ value: name, text: plainTexText(name) })), s.input, 'the input port');
  fillSelect(section.querySelector('#sc-output'), portChoices('output').map((name) => ({ value: name, text: plainTexText(name) })), s.output, 'the output port');
  const phases = switchedCapPhases(editor.circuit);
  const readout = section.querySelector('#sc-readout');
  fillSelect(readout, phases.ok ? phases.states.map((state) => ({ value: state.name, text: `end of ${plainTexText(state.name)}` })) : [], s.readout, 'end of the last phase');
  const card = section.querySelector('.sc-phases');
  if (!phases.ok) {
    card.replaceChildren(el('p', { class: 'field-hint', text: phases.error }));
    return;
  }
  card.replaceChildren(el('table', { class: 'sc-phase-table' }, [
    el('tbody', {}, phases.states.map((state, index) => el('tr', {}, [
      el('td', { class: 'sc-phase-index', text: String(index + 1) }),
      el('td', { class: 'sc-phase-name' }, [phaseName(state.name)]),
      el('td', { class: 'sc-phase-closed', text: state.closed.size ? `${[...state.closed].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).join(', ')} closed` : 'all open' }),
    ]))),
  ]), el('p', { class: 'field-hint', text: `From the ${phases.source === 'timing' ? 'timing diagram' : 'beats'}: one period, phase after phase.` }));
}

/** The capacitances' numbers for the plots: a result's symbols, 1 unless set. */
function valuesFor(result) {
  const values = {};
  for (const name of resultSymbols(result.value, result.variable)) values[name] = settings().values[name] ?? 1;
  return values;
}

function derive() {
  const s = settings();
  const result = analyzeSwitchedCap(editor.circuit, { input: s.input || undefined, output: s.output || undefined, readout: s.readout || undefined });
  latest = { revision: editor.modelRevision, result };
  renderResult();
  renderPlots();
  if (result.ok) offerPlots();
}

/** What Derive found: the equation (or why there is none), its poles and
 *  zeros at the numbers, and the capacitances' fields. */
function renderResult() {
  const host = section.querySelector('.sc-results');
  const valuesHost = section.querySelector('.sc-values');
  section.querySelector('.sc-stale').hidden = !latest || latest.revision === editor.modelRevision;
  if (annotateButton) annotateButton.hidden = !latest?.result.ok;
  if (!latest) { host.replaceChildren(); valuesHost.hidden = true; return; }
  const { result } = latest;
  if (!result.ok) {
    host.replaceChildren(el('div', { class: 'analysis-error sc-error', role: 'status', text: result.error }));
    valuesHost.hidden = true;
    return;
  }
  const values = valuesFor(result);
  const roots = numericRootsOf(withCoefficients(result.value, values));
  const list = (label, items) => (items?.length ? el('p', { class: 'sc-roots' }, [`${label}: `, items.map((root) => `z = ${complexText(root)}`).join(', ')]) : null);
  host.replaceChildren(...[
    el('div', { class: 'sc-equation' }, [math(result.equation, true)]),
    el('p', { class: 'field-hint' }, ['Read at the end of ', phaseName(result.states[result.readout].name), `, the input held through each period.`]),
    list('Poles', roots.poles),
    list('Zeros', roots.zeros),
  ].filter(Boolean));
  // A field per capacitance: the numbers the plots and the roots use.
  const rows = Object.entries(values).map(([name, value]) => {
    const input = el('input', { type: 'number', min: '0', step: 'any', value: String(value), 'aria-label': `${name}`, class: 'sc-value-input' });
    input.addEventListener('change', () => {
      const number = Number(input.value);
      if (!(number > 0)) { input.value = String(settings().values[name] ?? 1); return; }
      settings().values[name] = number;
      markSettingsChanged();
      renderResult();
      renderPlots();
    });
    return el('label', { class: 'sc-value' }, [math(name.replace(/^([A-Za-z])([A-Za-z0-9]+)$/, '$1_{$2}')), input]);
  });
  valuesHost.querySelector('.sc-value-rows').replaceChildren(...rows);
  valuesHost.hidden = !rows.length;
}

/** Magnitude and phase over f/f_s, at the capacitances' numbers. */
function renderPlots() {
  if (!plots) return;
  const result = latest?.result;
  const empty = plots.view.querySelector('.sc-plots-empty');
  if (!result?.ok) {
    empty.hidden = false;
    plots.magnitude.set(null);
    plots.phase.set(null);
    return;
  }
  empty.hidden = true;
  const trace = { label: result.label, color: TRACE_COLORS[0], value: withCoefficients(result.value, valuesFor(result)), variable: 'z' };
  const magnitude = responsePlot([trace], 'z', { quantity: 'magnitude' });
  const phase = responsePlot([trace], 'z', { quantity: 'phase' });
  plots.magnitude.set(magnitude ? responseSpec(magnitude) : null);
  plots.phase.set(phase ? responseSpec(phase) : null);
}

/** Write the equation under the drawing, as the other modes do. */
function annotate() {
  const result = latest?.result;
  if (!result?.ok) return;
  // As the signal-flow mode writes its equations: under the drawing, left.
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
    ]),
    el('fieldset', { class: 'analysis-approximations' }, [el('legend', { text: 'Phases' }), el('div', { class: 'sc-phases' })]),
    el('p', { class: 'analysis-stale sc-stale', hidden: true, text: 'The circuit changed since this was derived.' }),
    el('div', { class: 'sc-results', 'aria-live': 'polite' }),
    el('fieldset', { class: 'analysis-approximations sc-values', hidden: true }, [
      el('legend', { text: 'Capacitances' }),
      el('div', { class: 'sc-value-rows' }),
      el('p', { class: 'field-hint', text: 'The plots and the poles and zeros use these numbers; the equation stays symbolic. A capacitor valued C_S (or 2*C_u) shares that symbol with every capacitor of the same value.' }),
    ]),
    el('div', { class: 'signal-flow-plots-open' }, [
      el('span', { class: 'field-hint', text: 'Magnitude and phase over f/f_s.' }),
      el('button', { type: 'button', title: 'Show the Plots window (Shift+W)', onclick: () => showPlots() }, [buttonIcon('plots'), 'Show plots']),
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
  // Its view in the Plots window.
  const magnitude = createPlotView({ aspect: 0.6 });
  const phase = createPlotView({ height: 150, aspect: 0.38 });
  linkPlots(magnitude, phase);
  const view = el('div', { class: 'sc-plots-view' }, [
    el('p', { class: 'field-hint sc-plots-empty', text: 'Derive a switched-capacitor circuit (Shift+S, Switched-cap) to plot its response.' }),
    magnitude.el, phase.el,
  ]);
  plots = { view, magnitude, phase };
  installPlotsWindow({ mode: 'switched-cap', view, shown: () => renderPlots() });
  // Another design starts with none of this one's results.
  onDocumentShown(() => {
    latest = null;
    if (!section.hidden) { fillForm(); renderResult(); }
    renderPlots();
  });
}
