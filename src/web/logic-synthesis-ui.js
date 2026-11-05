/**
 * The analysis window's synthesis mode, the reverse of the logic mode: the
 * inputs and outputs named here, each output's value set in every row of
 * the truth table (0, 1, Z for not driven, - for either), and each output
 * as a minimized equation, in the style and the gates chosen
 * (core/analysis/logic-synthesis.js). Draw puts the gates of the checked
 * equations on the drawing, with their ports. The table and the choices
 * are saved with the design (analysisValues.synthesis).
 */

import {
  MAX_SYNTHESIS_INPUTS, MAX_SYNTHESIS_OUTPUTS, SYNTHESIS_GATES, compactNames, drawSynthesis, gateSummary, rowCount, signalNames, synthesizeLogic,
} from '../core/analysis/logic-synthesis.js';
import { logicNameTex } from '../core/analysis/logic.js';
import { registerAnalysisMode } from './signal-flow-ui.js';
import { editor } from './editor-state.js';
import { commit, markSettingsChanged, onDocumentShown, render, setSelection } from './main.js';
import { logLine } from './status-bar-ui.js';
import { element as el, mathSpan, onFieldCommit } from './dom.js';
import { annotateMathFigure } from './figure-annotate.js';
import { registerAnnotations } from './annotate-menu.js';
import { fitView } from './canvas-view.js';

const STYLES = [
  ['and-or', 'AND–OR (sum of products)'],
  ['nand', 'NAND–NAND'],
  ['or-and', 'OR–AND (product of sums)'],
  ['nor', 'NOR–NOR'],
];
const GATE_NAMES = { inverter: 'Inverter', and: 'AND', nand: 'NAND', or: 'OR', nor: 'NOR' };
// A cell steps through these on a click.
const CYCLE = ['0', '1', 'Z', '-'];

let section = null;
// Outputs left out of Draw: this session's, not the design's.
const unchecked = new Set();

/** The table as saved, or a first one: A and B in, Y out, all 0. */
function settings() {
  const saved = editor.circuit.analysisValues.synthesis;
  return saved || { inputs: ['A', 'B'], outputs: [{ name: 'Y', values: '' }], style: 'and-or', gates: [...SYNTHESIS_GATES], maxInputs: 3 };
}

function save(next) {
  editor.circuit.analysisValues.synthesis = next;
  markSettingsChanged();
}

/** An output's values, one per row, padded with 0. */
function valuesOf(output, rows) {
  return output.values.slice(0, rows).padEnd(rows, '0');
}

/**
 * The values carried over to new inputs: a row takes the value of the old
 * row with the same inputs, an input new to the table counted 0 there.
 */
function remap(values, from, to) {
  const rows = rowCount(to);
  let out = '';
  for (let row = 0; row < rows; row++) {
    let old = 0;
    for (const [k, name] of from.entries()) {
      const at = to.indexOf(name);
      const bit = at >= 0 ? (row >> (to.length - 1 - at)) & 1 : 0;
      old |= bit << (from.length - 1 - k);
    }
    out += values[old] ?? '0';
  }
  return out;
}

function setInputs(text) {
  const current = settings();
  const inputs = signalNames(text).slice(0, MAX_SYNTHESIS_INPUTS);
  const outputs = current.outputs.map((output) => ({ name: output.name, values: remap(valuesOf(output, rowCount(current.inputs)), current.inputs, inputs) }));
  save({ ...current, inputs, outputs });
  refresh();
}

function setOutputs(text) {
  const current = settings();
  const rows = rowCount(current.inputs);
  const outputs = signalNames(text).slice(0, MAX_SYNTHESIS_OUTPUTS).map((name) => {
    const kept = current.outputs.find((output) => output.name === name);
    return { name, values: kept ? valuesOf(kept, rows) : '0'.repeat(rows) };
  });
  save({ ...current, outputs });
  refresh();
}

function setValue(outputIndex, row, value) {
  const current = settings();
  const rows = rowCount(current.inputs);
  const outputs = current.outputs.map((output, i) => {
    if (i !== outputIndex) return output;
    const values = [...valuesOf(output, rows)];
    values[row] = value;
    return { ...output, values: values.join('') };
  });
  save({ ...current, outputs });
  renderEquations();
}

function setOption(patch) {
  save({ ...settings(), ...patch });
  renderEquations();
}

const math = (tex, display = false) => mathSpan(tex, 'logic-math', display);

/** The synthesis of the table as it stands, of the outputs `only` if given. */
function synthesized(only = null) {
  const current = settings();
  const outputs = only ? current.outputs.filter((output) => only.includes(output.name)) : current.outputs;
  return synthesizeLogic({ inputs: current.inputs, outputs }, current);
}

/** The fields from the saved choices. */
function fillForm() {
  const current = settings();
  section.querySelector('#synthesis-inputs').value = compactNames(current.inputs);
  section.querySelector('#synthesis-outputs').value = compactNames(current.outputs.map((output) => output.name));
  section.querySelector('#synthesis-style').value = current.style;
  section.querySelector('#synthesis-fan-in').value = String(current.maxInputs);
  for (const box of section.querySelectorAll('[data-gate]')) box.checked = current.gates.includes(box.dataset.gate);
}

/** The truth table: the inputs counting up, a cell per output to set. */
function renderTable() {
  const host = section.querySelector('.synthesis-table');
  const current = settings();
  const rows = rowCount(current.inputs);
  if (!current.inputs.length || !current.outputs.length) {
    host.replaceChildren(el('p', { class: 'field-hint', text: 'Name at least one input and one output.' }));
    return;
  }
  const head = el('tr', {}, [
    ...current.inputs.map((name) => el('th', { scope: 'col' }, [math(logicNameTex(name))])),
    ...current.outputs.map((output, i) => el('th', { scope: 'col', class: i === 0 ? 'logic-first-out' : undefined }, [math(logicNameTex(output.name))])),
  ]);
  const body = [];
  for (let row = 0; row < rows; row++) {
    body.push(el('tr', {}, [
      ...current.inputs.map((_, k) => el('td', { text: String((row >> (current.inputs.length - 1 - k)) & 1) })),
      ...current.outputs.map((output, i) => {
        const value = valuesOf(output, rows)[row];
        return el('td', { class: i === 0 ? 'logic-first-out' : undefined }, [el('button', {
          type: 'button',
          class: 'synthesis-cell',
          'data-output': i,
          'data-row': row,
          'data-value': value,
          'aria-label': `${output.name} in row ${row}: ${value}`,
          text: value === '-' ? '–' : value,
        })]);
      }),
    ]));
  }
  host.replaceChildren(el('div', { class: 'analysis-noise-table logic-table' }, [
    el('div', { class: 'analysis-noise-table-scroll' }, [el('table', {}, [el('thead', {}, [head]), el('tbody', {}, body)])]),
  ]));
}

function setCell(button, value) {
  button.dataset.value = value;
  button.textContent = value === '-' ? '–' : value;
  const output = settings().outputs[Number(button.dataset.output)];
  button.setAttribute('aria-label', `${output?.name} in row ${button.dataset.row}: ${value}`);
  setValue(Number(button.dataset.output), Number(button.dataset.row), value);
}

/** A cell moved to from `button`: up, down, left, or right. */
function cellBeside(button, dx, dy) {
  const row = Number(button.dataset.row) + dy;
  const output = Number(button.dataset.output) + dx;
  return section.querySelector(`.synthesis-cell[data-row="${row}"][data-output="${output}"]`);
}

/** Each output's equation, a box to leave it out of Draw, and the gates. */
function renderEquations() {
  const host = section.querySelector('.synthesis-results');
  const result = synthesized();
  if (!result.ok) {
    host.replaceChildren(el('div', { class: 'analysis-error', role: 'status', text: result.error }));
    syncDraw(null);
    return;
  }
  const rows = result.outputs.map((output) => {
    const box = el('input', {
      type: 'checkbox',
      checked: !unchecked.has(output.name),
      'aria-label': `Draw ${output.name}`,
      onchange: (ev) => {
        if (ev.target.checked) unchecked.delete(output.name);
        else unchecked.add(output.name);
        syncDraw(synthesized(drawn()));
      },
    });
    const name = logicNameTex(output.name);
    const equation = output.tex === null ? `${name} = Z` : `${name} = ${output.tex}`;
    return el('label', { class: 'logic-expression synthesis-expression' }, [
      box,
      math(equation, true),
      ...(output.enableTex ? [el('span', { class: 'field-hint' }, ['driven when ', math(output.enableTex)])] : []),
    ]);
  });
  host.replaceChildren(
    el('h3', { class: 'logic-title', text: 'Equations' }),
    ...rows,
    el('p', { class: 'field-hint synthesis-gates' }),
  );
  syncDraw(synthesized(drawn()));
}

/** The outputs Draw draws. */
function drawn() {
  return settings().outputs.map((output) => output.name).filter((name) => !unchecked.has(name));
}

function syncDraw(result) {
  const button = document.getElementById('synthesis-draw');
  const ready = !!result?.ok && result.outputs.length > 0;
  if (button) button.disabled = !ready;
  const hint = section.querySelector('.synthesis-gates');
  if (hint) hint.textContent = ready ? `Draw: ${gateSummary(result)}.` : 'Check an equation to draw it.';
}

function draw() {
  const result = synthesized(drawn());
  if (!result.ok || !result.outputs.length) return;
  let drawing = null;
  let error = null;
  commit(() => {
    try {
      drawing = drawSynthesis(editor.circuit, result);
    } catch (err) {
      error = err;
      throw err;
    }
  });
  if (error) {
    logLine(`Could not draw: ${error.message}`, 'error');
    return;
  }
  setSelection(drawing.refs.filter((ref) => editor.circuit.components.get(ref)?.type !== 'solder'));
  render();
  fitView({ animate: true });
  const joined = { rails: '', inputs: '; the inputs joined by name', names: '; joined by name, the wires found no room' }[drawing.mode];
  logLine(`drew ${result.outputs.map((output) => output.name).join(', ')}: ${gateSummary(result)}${joined}`);
}

/** A table this many rows long, or shorter, goes on the drawing (as the
 *  logic mode's: render.js holds 16 columns, one of them the gap). */
const ANNOTATED_ROWS = 64;
const ANNOTATED_COLUMNS = 16;

function tableFits(current) {
  return rowCount(current.inputs) <= ANNOTATED_ROWS && current.inputs.length + current.outputs.length + 1 <= ANNOTATED_COLUMNS;
}

/** The truth table on the drawing, as the logic mode draws one: names over
 *  a rule, a row per combination, a gap between inputs and outputs; Z as
 *  Z, – as a dash. */
function annotateTable() {
  const current = settings();
  if (!current.inputs.length || !current.outputs.length || !tableFits(current)) return;
  const rows = rowCount(current.inputs);
  const cell = (value) => (value === '-' ? '\\text{–}' : value);
  const lines = [
    [...current.inputs.map(logicNameTex), '', ...current.outputs.map((output) => logicNameTex(output.name))].join(' & '),
    '\\hline',
  ];
  for (let row = 0; row < rows; row++) {
    const bits = current.inputs.map((_, k) => String((row >> (current.inputs.length - 1 - k)) & 1));
    lines.push([...bits, '', ...current.outputs.map((output) => cell(valuesOf(output, rows)[row]))].join(' & '));
  }
  const columns = 'c'.repeat(current.inputs.length + 1 + current.outputs.length);
  const { updated } = annotateMathFigure({ kind: 'table', source: 'synthesis', text: lines.join('\n'), columns });
  logLine(updated ? 'updated the truth table' : 'annotated the truth table');
}

/** The equations on the drawing, each name then its expression. */
function annotateEquations() {
  const result = synthesized(drawn());
  if (!result.ok) return;
  const rows = result.outputs.filter((output) => output.tex !== null).map((output) => `${logicNameTex(output.name)} = ${output.tex}`);
  if (!rows.length) return;
  // Each equation whole, as the other tools' equations are drawn.
  const { updated } = annotateMathFigure({ kind: 'equations', source: 'synthesis', text: rows.join('\n'), columns: 'l' });
  logLine(updated ? 'updated the synthesized equations' : 'annotated the synthesized equations');
}

function refresh() {
  fillForm();
  renderTable();
  renderEquations();
}

export function installLogicSynthesisUi() {
  const row = (label, id, control) => el('div', { class: 'signal-flow-source' }, [el('label', { for: id, class: 'signal-flow-source-name', text: label }), control]);
  const inputs = el('input', { type: 'text', id: 'synthesis-inputs', placeholder: 'A B C, or D[3:0]', spellcheck: 'false', autocomplete: 'off' });
  const outputs = el('input', { type: 'text', id: 'synthesis-outputs', placeholder: 'Y, or Q[1:0]', spellcheck: 'false', autocomplete: 'off' });
  onFieldCommit(inputs, setInputs);
  onFieldCommit(outputs, setOutputs);
  const style = el('select', { id: 'synthesis-style', onchange: (ev) => setOption({ style: ev.target.value }) },
    STYLES.map(([value, text]) => el('option', { value, text })));
  const fanIn = el('select', { id: 'synthesis-fan-in', onchange: (ev) => setOption({ maxInputs: Number(ev.target.value) }) }, [
    el('option', { value: '3', text: '3' }),
    el('option', { value: '2', text: '2' }),
  ]);
  const gates = el('div', { class: 'synthesis-allowed', role: 'group', 'aria-label': 'Allowed gates' }, SYNTHESIS_GATES.map((gate) => el('label', {}, [
    el('input', { type: 'checkbox', 'data-gate': gate, onchange: () => setOption({ gates: [...section.querySelectorAll('[data-gate]')].filter((box) => box.checked).map((box) => box.dataset.gate) }) }),
    ` ${GATE_NAMES[gate]}`,
  ])));
  section = el('div', { id: 'analysis-synthesis', class: 'signal-flow-section synthesis-section', hidden: true }, [
    el('p', { class: 'analysis-intro', text: 'Name the inputs and outputs, then set each output in every row: 0, 1, Z (not driven), or – (either). Draw puts the gates on the drawing.' }),
    el('fieldset', { class: 'analysis-approximations' }, [
      el('legend', { text: 'Signals' }),
      row('Inputs', 'synthesis-inputs', inputs),
      row('Outputs', 'synthesis-outputs', outputs),
      el('p', { class: 'field-hint', text: `Names separated by spaces; a bus as its range (D[3:0] or D<3:0>) is a port per bit. Up to ${MAX_SYNTHESIS_INPUTS} inputs, the first the most significant.` }),
    ]),
    el('fieldset', { class: 'analysis-approximations' }, [
      el('legend', { text: 'Gates' }),
      row('Style', 'synthesis-style', style),
      row('Most inputs', 'synthesis-fan-in', fanIn),
      el('div', { class: 'signal-flow-source' }, [el('span', { class: 'signal-flow-source-name', text: 'Allowed' }), gates]),
      el('p', { class: 'field-hint', text: 'A buffer drives an output that is an input or a constant; a tri-state buffer one that is Z in places.' }),
    ]),
    el('h3', { class: 'logic-title', text: 'Truth table' }),
    el('div', { class: 'synthesis-table' }),
    el('p', { class: 'field-hint', text: 'Click a cell to step it through 0, 1, Z, –; or type 0, 1, Z, or - (X) in it, and the arrows move.' }),
    el('div', { class: 'synthesis-results', 'aria-live': 'polite' }),
  ]);
  section.addEventListener('click', (ev) => {
    const button = ev.target.closest('.synthesis-cell');
    if (!button) return;
    setCell(button, CYCLE[(CYCLE.indexOf(button.dataset.value) + 1) % CYCLE.length]);
  });
  section.addEventListener('keydown', (ev) => {
    const button = ev.target.closest?.('.synthesis-cell');
    if (!button || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const typed = { 0: '0', 1: '1', z: 'Z', Z: 'Z', '-': '-', x: '-', X: '-' }[ev.key];
    const move = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[ev.key];
    if (typed) {
      setCell(button, typed);
      // On to the next row, as a column is filled in.
      cellBeside(button, 0, 1)?.focus();
    } else if (move) cellBeside(button, ...move)?.focus();
    else return;
    ev.preventDefault();
    ev.stopPropagation();
  });
  registerAnnotations('synthesis', () => {
    const result = synthesized(drawn());
    const current = settings();
    return [
      { label: 'Table', identity: { kind: 'table', source: 'synthesis' }, available: current.inputs.length > 0 && current.outputs.length > 0 && tableFits(current), run: annotateTable },
      { label: 'Equations', identity: { kind: 'equations', source: 'synthesis' }, available: !!result.ok && result.outputs.some((output) => output.tex !== null), run: annotateEquations },
    ];
  });
  const actions = [
    el('button', { type: 'button', id: 'synthesis-draw', class: 'primary-action', 'data-icon': 'add', text: 'Draw', title: 'Draw the checked equations\' gates, with ports, on the drawing', onclick: draw }),
  ];
  registerAnalysisMode({
    mode: 'synthesis',
    label: 'Synthesis',
    hint: 'Logic synthesis',
    title: 'Logic synthesis',
    section,
    actions,
    shown: refresh,
  });
  onDocumentShown(() => {
    unchecked.clear();
    if (!section.hidden) refresh();
  });
}
