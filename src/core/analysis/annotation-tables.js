/**
 * What each analysis puts on the drawing as its table (math-figure.js): the
 * TeX rows and column alignment, built from a result. The analysis window
 * and the analyze commands' --annotate share these, so a table annotated
 * from either reads the same.
 */

import { annotationAssumptions } from './options.js';
import { logicNameTex } from './logic.js';
import { rowCount } from './logic-synthesis.js';
import { transferTex } from './signal-flow.js';

/** Rows and columns a truth table on the drawing holds (render.js), one
 *  column the gap between inputs and outputs. */
export const ANNOTATED_ROWS = 64;
export const ANNOTATED_COLUMNS = 16;

const text = (words) => `\\text{${words}}`;

// ----- small-signal ------------------------------------------------------------

/** An equation as a math label takes it: parallel bars as \Vert, the
 *  larger ones beside a fraction, quantity subscripts braced. */
export function equationForLabel(equation) {
  const normalized = String(equation || '')
    .replace(/\\parallel/g, '\\Vert')
    .replace(/\\Big\\\|\\\|/g, '\\Big\\Vert')
    .replace(/\\\|\\\|/g, '\\Vert')
    // Keep labels editable as valid TeX even if a legacy report or manually
    // entered equation still contains the plain `||` spelling.
    .replace(/(?<!\\)\|\|/g, '\\Vert')
    .replace(/\b([AGZ])_([imv])\b/g, '$1_{$2}')
    .replace(/\s+/g, ' ')
    .trim();
  // A parallel operator sharing a line with a fraction needs the larger
  // delimiter form to reach the fraction's numerator/denominator height.
  return /\\frac\b/.test(normalized)
    ? normalized.replace(/(?<!\\Big)\\Vert/g, '\\Big\\Vert')
    : normalized;
}

/** The "where" lines the equations use, directly or through another one. */
function neededDefinitionLines(lines, equations) {
  const nameOf = (line) => line.slice(0, line.indexOf(' = '));
  const needed = new Set();
  let texts = equations;
  for (let grown = true; grown;) {
    grown = false;
    for (const line of lines) {
      if (needed.has(line) || !texts.some((t) => t.includes(nameOf(line)))) continue;
      needed.add(line);
      grown = true;
    }
    texts = [...equations, ...needed];
  }
  return lines.filter((line) => needed.has(line));
}

/**
 * The rows a small-signal report puts on the drawing: every row whose title
 * `excluded` does not hold, and after them the definitions those rows use
 * (and the ones those use), whatever their own rows say -- a named symbol
 * must never reach the drawing undefined.
 */
export function smallSignalAnnotationEntries(report, excluded = new Set()) {
  const entries = (Array.isArray(report?.equationEntries) ? report.equationEntries : []).filter(({ result }) => result?.ok && result.equation);
  const chosen = entries.filter(({ group, title }) => group !== 'definitions' && !excluded.has(title));
  const where = entries.find(({ group }) => group === 'definitions');
  const lines = where ? neededDefinitionLines(where.result.lines, chosen.map(({ result }) => result.equation)) : [];
  return [
    ...chosen.map(({ title, result }) => ({ title, equation: result.equation })),
    ...(lines.length ? [{ title: where.title, lines }] : []),
  ];
}

/**
 * The small-signal analysis's table: a row each, its name then its
 * equation; the definitions under their heading, the assumptions under a
 * rule. Null with nothing to show. `count` is the equations in it.
 */
export function smallSignalTable(report, { excluded = new Set() } = {}) {
  if (!report?.ok) return null;
  const entries = smallSignalAnnotationEntries(report, excluded);
  if (!entries.length) return null;
  const rows = [];
  for (const entry of entries) {
    if (entry.lines) entry.lines.forEach((line, index) => rows.push(`${index ? '' : text(entry.title)} & ${equationForLabel(line)}`));
    else rows.push(`${text(entry.title)} & ${equationForLabel(entry.equation)}`);
  }
  const assumptions = annotationAssumptions(report);
  if (assumptions.length) {
    rows.push('\\hline');
    assumptions.forEach((line, index) => rows.push(`${index ? '' : text('Assumptions')} & ${line}`));
  }
  return { kind: 'equations', source: 'small-signal', text: rows.join('\n'), columns: 'll', count: entries.length, assumptions: assumptions.length };
}

// ----- logic -------------------------------------------------------------------

function logicColumns(result) {
  return {
    left: [...result.states.map((state) => logicNameTex(state.name)), ...result.inputs.map((input) => logicNameTex(input.name))],
    right: [...result.states.map((state) => state.next), ...result.outputs.map((output) => logicNameTex(output.name))],
  };
}

/** Whether the logic analysis's table fits on the drawing. */
export function logicTableFits(result) {
  const { left, right } = logicColumns(result);
  return result.rows.length <= ANNOTATED_ROWS && left.length + right.length + 1 <= ANNOTATED_COLUMNS;
}

/** The truth (or state) table: names over a rule, a row per combination, a
 *  gap between what goes in and what comes out. Null when it does not fit. */
export function logicTable(result) {
  if (!result?.ok || !logicTableFits(result)) return null;
  const { left, right } = logicColumns(result);
  const rows = [
    [...left, '', ...right].join(' & '),
    '\\hline',
    ...result.rows.map((row) => [...row.states, ...row.inputs, '', ...row.next, ...row.outputs].map(String).join(' & ')),
  ];
  return { kind: 'table', source: 'logic', text: rows.join('\n'), columns: 'c'.repeat(left.length + 1 + right.length) };
}

/** Each output (and next state) as its sum of products, whole. */
export function logicEquations(result) {
  if (!result?.ok) return null;
  const rows = result.expressions.filter((expression) => expression.tex).map((expression) => `${expression.name} = ${expression.tex}`);
  return rows.length ? { kind: 'equations', source: 'logic', text: rows.join('\n'), columns: 'l' } : null;
}

// ----- logic synthesis -----------------------------------------------------------

/** Whether a synthesis spec's truth table fits on the drawing. */
export function synthesisTableFits(spec) {
  return rowCount(spec.inputs) <= ANNOTATED_ROWS && spec.inputs.length + spec.outputs.length + 1 <= ANNOTATED_COLUMNS;
}

/** The spec `{ inputs: [name], outputs: [{ name, values }] }` as the logic
 *  mode draws a table; Z as Z, - as a dash. Null when it does not fit. */
export function synthesisTable(spec) {
  if (!spec.inputs.length || !spec.outputs.length || !synthesisTableFits(spec)) return null;
  const rows = rowCount(spec.inputs);
  const cell = (value) => (value === '-' ? '\\text{–}' : value);
  const lines = [
    [...spec.inputs.map(logicNameTex), '', ...spec.outputs.map((output) => logicNameTex(output.name))].join(' & '),
    '\\hline',
  ];
  for (let row = 0; row < rows; row++) {
    const bits = spec.inputs.map((_, k) => String((row >> (spec.inputs.length - 1 - k)) & 1));
    lines.push([...bits, '', ...spec.outputs.map((output) => cell(output.values.slice(0, rows).padEnd(rows, '0')[row]))].join(' & '));
  }
  return { kind: 'table', source: 'synthesis', text: lines.join('\n'), columns: 'c'.repeat(spec.inputs.length + 1 + spec.outputs.length) };
}

/** A synthesis result's outputs, each name then its expression. */
export function synthesisEquations(result) {
  if (!result?.ok) return null;
  const rows = result.outputs.filter((output) => output.tex !== null).map((output) => `${logicNameTex(output.name)} = ${output.tex}`);
  return rows.length ? { kind: 'equations', source: 'synthesis', text: rows.join('\n'), columns: 'l' } : null;
}

// ----- switched-capacitor and signal-flow ----------------------------------------

/** The switched-capacitor analysis's table: H(z), where it is read, how the
 *  input is sampled, and the kT/C noise when it was derived. */
export function switchedCapTable(result) {
  if (!result?.ok) return null;
  const tex = (name) => (/^\$.*\$$/.test(name) ? name.replace(/^\$+|\$+$/g, '') : text(name));
  const rows = [
    `${text('Transfer function')} & ${result.equation}`,
    `${text('Read at the end of')} & ${tex(result.states[result.readout].name)}`,
    result.sampling === 'slot' ? `${text('Input sampled')} & \\text{every slot, } w = z^{1/${result.slots}}` : `${text('Input sampled')} & ${text('once a period')}`,
  ];
  if (result.noise?.ok) rows.push(`${text('kT/C noise')} & \\frac{\\overline{v^2_{n,in}}}{kT} = ${transferTex(result.noise.total.input, 'z', { symbolicLead: true })}`);
  return { kind: 'equations', source: 'switched-cap', text: rows.join('\n'), columns: 'll' };
}

/** The signal-flow equations, one a row. `equationOf(entry)` writes a
 *  sampled entry at its numbers (the window's coefficients). */
export function signalFlowTable(report, equationOf = (entry) => entry.equation) {
  if (!report?.ok || !report.entries?.length) return null;
  return { kind: 'equations', source: 'signal-flow', text: report.entries.map(equationOf).join('\n'), columns: 'l' };
}
