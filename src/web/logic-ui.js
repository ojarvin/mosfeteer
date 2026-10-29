/**
 * The analysis window's logic mode: a drawing of gates, multiplexers,
 * tri-states, flip-flops, and latches as its truth table -- a state
 * transition table with flip-flops or latches -- and each output and next
 * state as a minimized sum of products (core/analysis/logic.js). Nothing to
 * set: the inputs and outputs are found in the drawing, listed before
 * Derive. Annotate puts the table, or the equations, on the drawing.
 */

import { analyzeLogic, logicNameTex } from '../core/analysis/logic.js';
import { texToMathML } from '../core/render.js';
import { registerAnalysisMode } from './signal-flow-ui.js';
import { editor } from './editor-state.js';
import { onDocumentShown } from './main.js';
import { logLine } from './status-bar-ui.js';
import { element as el } from './dom.js';
import { annotateMathFigure } from './figure-annotate.js';
import { registerAnnotations } from './annotate-menu.js';

/** A table this many rows long, or shorter, goes on the drawing. */
const ANNOTATED_ROWS = 64;
/** Columns an annotated table holds (render.js), one of them the gap. */
const ANNOTATED_COLUMNS = 16;

const LOGIC_TYPES = /^(inverter|buffer|tristate_inverter|tristate_buffer|mux2|(and|nand|or|nor|xor|xnor)[23]_gate|dff.*|latch.*)$/;
const ANALOG_TYPES = /^(nmos|pmos|nmosb|pmosb|npn|pnp|resistor|capacitor|inductor|current_source|voltage_source|vccs|vcvs|opamp.*|gm.*|diode|switch_.*|tf_.*|gain|signal_.*)$/;

let section = null;
let latest = null; // { revision, result }

/** A drawing the mode suits: logic parts and nothing analog. */
function suggested(circuit) {
  const parts = [...circuit.components.values()];
  return parts.some((c) => LOGIC_TYPES.test(c.type)) && !parts.some((c) => ANALOG_TYPES.test(c.type));
}

function math(tex, display = false) {
  const span = el('span', { class: `logic-math${display ? ' display' : ''}` });
  const markup = texToMathML(tex);
  span.innerHTML = display ? markup : markup.replace('display="block"', 'display="inline"');
  return span;
}

/** The table's columns: the state then the inputs, the next state then the outputs. */
function columnsOf(result) {
  return {
    left: [...result.states.map((state) => logicNameTex(state.name)), ...result.inputs.map((input) => logicNameTex(input.name))],
    right: [...result.states.map((state) => state.next), ...result.outputs.map((output) => logicNameTex(output.name))],
  };
}

/** What the drawing gives: its inputs, outputs, state, and clock. */
function renderSignals() {
  const host = section.querySelector('.logic-signals');
  const result = analyzeLogic(editor.circuit);
  if (!result.ok) {
    host.replaceChildren(el('p', { class: 'field-hint', text: result.error }));
    return;
  }
  const list = (label, names) => el('div', { class: 'logic-signal-row' }, [
    el('span', { class: 'signal-flow-source-name', text: label }),
    el('span', { class: 'logic-signal-names' }, names.length ? names.flatMap((name, i) => [...(i ? [', '] : []), math(logicNameTex(name))]) : ['none']),
  ]);
  host.replaceChildren(
    list('Inputs', result.inputs.map((input) => input.name)),
    list('Outputs', result.outputs.map((output) => output.name)),
    ...(result.states.length ? [list('State', result.states.map((state) => state.name))] : []),
    ...(result.clock ? [list('Clock', [`${result.clock.name}`])] : []),
    el('p', { class: 'field-hint', text: 'Input and output ports, and pins wired to nothing: an unwired input is an input, an unwired output an output.' }),
  );
}

function derive() {
  const result = analyzeLogic(editor.circuit);
  latest = { revision: editor.modelRevision, result };
  renderResult();
  if (!result.ok) logLine(`Logic analysis: ${result.error}`, 'error');
}

function renderResult() {
  if (!section) return;
  const host = section.querySelector('.logic-results');
  section.querySelector('.logic-stale').hidden = !latest || latest.revision === editor.modelRevision;
  if (!latest) { host.replaceChildren(); return; }
  const { result } = latest;
  if (!result.ok) {
    host.replaceChildren(el('div', { class: 'analysis-error', role: 'status', text: result.error }));
    return;
  }
  const { left, right } = columnsOf(result);
  const head = el('tr', {}, [
    ...left.map((tex) => el('th', { scope: 'col' }, [math(tex)])),
    ...right.map((tex, i) => el('th', { scope: 'col', class: i === 0 ? 'logic-first-out' : undefined }, [math(tex)])),
  ]);
  const body = result.rows.map((row) => el('tr', {}, [
    ...[...row.states, ...row.inputs].map((v) => el('td', { text: String(v) })),
    ...[...row.next, ...row.outputs].map((v, i) => el('td', { class: `${i === 0 ? 'logic-first-out' : ''} ${v === 1 ? 'logic-high' : ''}`.trim() || undefined, text: String(v) })),
  ]));
  const title = result.sequential ? 'State transition table' : 'Truth table';
  const clock = result.clock ? `On each ${result.clock.falling ? 'falling' : 'rising'} edge of ${result.clock.name}; ` : '';
  const latches = result.states.some((state) => state.latch) ? 'a latch\'s next state is what it holds once its enable has gone; ' : '';
  host.replaceChildren(
    el('h3', { class: 'logic-title', text: title }),
    el('div', { class: 'analysis-noise-table logic-table' }, [el('div', { class: 'analysis-noise-table-scroll' }, [el('table', {}, [el('thead', {}, [head]), el('tbody', {}, body)])])]),
    ...(result.sequential ? [el('p', { class: 'field-hint', text: `${clock}${latches}the state on the left, the next state (+) on the right.` })] : []),
    el('h3', { class: 'logic-title', text: result.sequential ? 'Next state and outputs' : 'Outputs' }),
    el('div', { class: 'logic-expressions' }, result.expressions.map((expression) => el('div', { class: 'logic-expression' }, expression.tex
      ? [math(`${expression.name} = ${expression.tex}`, true)]
      : [math(expression.name), el('span', { class: 'field-hint', text: ' is Z or X in places: no expression.' })]))),
  );
}

/** Whether the table fits a table on the drawing. */
function tableFits(result) {
  const { left, right } = columnsOf(result);
  return result.rows.length <= ANNOTATED_ROWS && left.length + right.length + 1 <= ANNOTATED_COLUMNS;
}

/** The table on the drawing: names over a rule, a row per combination,
 *  a gap between what goes in and what comes out. */
function annotateTable() {
  const result = latest?.result;
  if (!result?.ok || !tableFits(result)) return;
  const { left, right } = columnsOf(result);
  const rows = [
    [...left, '', ...right].join(' & '),
    '\\hline',
    ...result.rows.map((row) => [...row.states, ...row.inputs, '', ...row.next, ...row.outputs].map(String).join(' & ')),
  ];
  const columns = 'c'.repeat(left.length + 1 + right.length);
  const { updated } = annotateMathFigure({ kind: 'table', source: 'logic', text: rows.join('\n'), columns });
  logLine(updated ? `updated the ${result.sequential ? 'state' : 'truth'} table` : `annotated the ${result.sequential ? 'state' : 'truth'} table`);
}

/** The equations on the drawing, each name then its sum of products. */
function annotateEquations() {
  const result = latest?.result;
  if (!result?.ok) return;
  const rows = result.expressions.filter((expression) => expression.tex).map((expression) => `${expression.name} & = ${expression.tex}`);
  if (!rows.length) return;
  const { updated } = annotateMathFigure({ kind: 'equations', source: 'logic', text: rows.join('\n'), columns: 'rl' });
  logLine(updated ? 'updated the logic equations' : 'annotated the logic equations');
}

export function installLogicUi() {
  section = el('div', { id: 'analysis-logic', class: 'signal-flow-section logic-section', hidden: true }, [
    el('p', { class: 'analysis-intro', text: 'Derive gives the truth table, a state table with flip-flops or latches, and each output as a minimized sum of products.' }),
    el('fieldset', { class: 'analysis-approximations' }, [el('legend', { text: 'Signals' }), el('div', { class: 'logic-signals' })]),
    el('p', { class: 'analysis-stale logic-stale', hidden: true, text: 'The circuit changed since this was derived.' }),
    el('div', { class: 'logic-results', 'aria-live': 'polite' }),
  ]);
  registerAnnotations('logic', () => [
    { label: 'Table', identity: { kind: 'table', source: 'logic' }, available: !!latest?.result.ok && tableFits(latest.result), run: annotateTable },
    { label: 'Equations', identity: { kind: 'equations', source: 'logic' }, available: !!latest?.result.ok && latest.result.expressions.some((expression) => expression.tex), run: annotateEquations },
  ]);
  const actions = [
    el('button', { type: 'button', class: 'primary-action logic-derive', 'data-icon': 'check', text: 'Derive', title: 'Derive (Enter)', onclick: derive }),
  ];
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
    renderSignals();
    if (latest) section.querySelector('.logic-stale').hidden = latest.revision === editor.modelRevision;
  });
  registerAnalysisMode({
    mode: 'logic',
    label: 'Logic',
    hint: 'Logic analysis',
    title: 'Logic analysis',
    section,
    actions,
    suggested,
    shown: () => { renderSignals(); renderResult(); },
  });
  // Another design starts with none of this one's results.
  onDocumentShown(() => {
    latest = null;
    if (!section.hidden) { renderSignals(); renderResult(); }
  });
}
