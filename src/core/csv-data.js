/**
 * Columns of numbers read from a CSV or similar text file, for a data plot
 * (docs/figures.md). The file itself is never kept: only the traces built
 * from it go into the design.
 *
 * `readTable(text, options)` guesses what it is not told: the separator
 * (tab, semicolon, comma, or runs of spaces), the decimal sign (a decimal
 * comma when the separator is not a comma), and the rows before the data
 * (a title, a header, a simulator's notes). The last of those rows names the
 * columns when it has a name for each. Lines starting with `#`, `%`, or `//`
 * are comments. A cell is a number as JavaScript reads it, or a value with an
 * SI suffix (`1.2k`, `3n`, part-value.js); anything else is a gap.
 */

import { valueNumber } from './part-value.js';

/** The most traces a data plot draws. */
export const MAX_DATA_TRACES = 8;

const SEPARATORS = ['\t', ';', ',', ' '];
const SAMPLE_LINES = 60;
const COMMENT = /^\s*(#|%|\/\/)/;

/** A cell as a number, or NaN: `decimal` ',' reads 1,5 as 1.5. */
export function cellNumber(cell, decimal = '.') {
  let text = String(cell ?? '').trim();
  if (text.startsWith('"') && text.endsWith('"') && text.length > 1) text = text.slice(1, -1).trim();
  if (!text) return NaN;
  if (decimal === ',') text = text.replace(',', '.');
  if (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(text)) return Number(text);
  if (/^[+-]?(inf|infinity|nan)$/i.test(text)) return NaN;
  return valueNumber(text);
}

/** One line's cells, split at `separator` (' ' is any run of spaces or
 *  tabs); double quotes hold a separator, and "" is a quote. */
export function splitLine(line, separator) {
  if (separator === ' ') return line.trim().split(/\s+/).filter((cell) => cell !== '');
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && !cell.trim()) quoted = true;
    else if (ch === separator) { cells.push(cell.trim()); cell = ''; } else cell += ch;
  }
  cells.push(cell.trim());
  return cells;
}

/** The lines that carry anything: no blank lines, no comments. */
function contentLines(text) {
  return String(text ?? '').replace(/^﻿/, '').split(/\r\n|\r|\n/).filter((line) => line.trim() && !COMMENT.test(line));
}

const mode = (values) => {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  let best = null;
  for (const [value, count] of counts) if (!best || count > best.count || (count === best.count && value > best.value)) best = { value, count };
  return best || { value: 0, count: 0 };
};

/** How well `separator` and `decimal` read the sample: the share of lines
 *  with the usual number of cells, times the share of their cells that are
 *  numbers; 0 for one cell a line. */
function separatorScore(lines, separator, decimal) {
  const rows = lines.map((line) => splitLine(line, separator));
  const usual = mode(rows.map((row) => row.length));
  if (usual.value < 2) return 0;
  const regular = rows.filter((row) => row.length === usual.value);
  const cells = regular.flat();
  const numeric = cells.filter((cell) => Number.isFinite(cellNumber(cell, decimal))).length;
  return (usual.count / rows.length) * (numeric / Math.max(1, cells.length));
}

/** The separator and decimal sign that read the most numbers in the file's
 *  last lines (its data, past any header). */
export function guessFormat(text) {
  const lines = contentLines(text);
  const sample = lines.slice(-SAMPLE_LINES);
  let best = { separator: ',', decimal: '.', score: 0 };
  for (const separator of SEPARATORS) {
    for (const decimal of separator === ',' ? ['.'] : ['.', ',']) {
      const score = separatorScore(sample, separator, decimal);
      if (score > best.score + 1e-9) best = { separator, decimal, score };
    }
  }
  if (best.score > 0) return { separator: best.separator, decimal: best.decimal };
  // One number a line: a single column.
  const decimal = sample.some((line) => /^\s*[+-]?\d+,\d+\s*$/.test(line)) ? ',' : '.';
  return { separator: ',', decimal };
}

/** Whether a row is data: at least half its cells (and one) are numbers. */
function isDataRow(row, decimal) {
  const numbers = row.filter((cell) => Number.isFinite(cellNumber(cell, decimal))).length;
  return numbers > 0 && numbers * 2 >= row.length;
}

/** The rows before the data: the first row from which this one and the
 *  next are data. */
function guessSkip(rows, decimal) {
  for (let i = 0; i < rows.length; i++) {
    if (isDataRow(rows[i], decimal) && (i + 1 >= rows.length || isDataRow(rows[i + 1], decimal))) return i;
  }
  return rows.length;
}

/** A column's suggested scale: log when it is all positive and spans more
 *  than three decades. */
export function suggestScale(values) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length || finite.some((v) => v <= 0)) return 'linear';
  let low = Infinity;
  let high = -Infinity;
  for (const v of finite) { if (v < low) low = v; if (v > high) high = v; }
  return high / low > 1e3 ? 'log' : 'linear';
}

/**
 * The table a text file holds: `{ separator, decimal, skip, header, rows,
 * names, columns, numeric, x, y, scale: { x, y } }`. `rows` are the content
 * lines' cells (comments and blank lines out), `skip` how many of them come
 * before the data, `header` whether the last of those names the columns.
 * `columns[c]` are column c's numbers in the data rows (NaN for a gap),
 * `numeric` the columns at least half numbers. `x` and `y` suggest the
 * columns to plot: the first numeric column against the next ones. Every
 * guess can be given in `options` instead.
 */
export function readTable(text, options = {}) {
  const guessed = guessFormat(text);
  const separator = SEPARATORS.includes(options.separator) ? options.separator : guessed.separator;
  const decimal = options.decimal === ',' || options.decimal === '.' ? options.decimal : guessed.decimal;
  const rows = contentLines(text).map((line) => splitLine(line, separator));
  const skip = Number.isInteger(options.skip) && options.skip >= 0 ? Math.min(options.skip, rows.length) : guessSkip(rows, decimal);
  const data = rows.slice(skip);
  const width = data.length ? mode(data.map((row) => row.length)).value : (rows[skip - 1]?.length || 0);
  const columns = Array.from({ length: width }, (_, c) => data.map((row) => cellNumber(row[c], decimal)));
  const numeric = columns.map((values, c) => [values, c]).filter(([values]) => values.length
    && values.filter(Number.isFinite).length * 2 >= values.length).map(([, c]) => c);
  const last = rows[skip - 1];
  const named = !!last && last.length >= width && last.slice(0, width).every((cell) => cell && !Number.isFinite(cellNumber(cell, decimal)));
  const header = typeof options.header === 'boolean' ? options.header && !!last : named;
  const names = Array.from({ length: width }, (_, c) => (header && last?.[c] ? last[c].replace(/^"|"$/g, '') : `Column ${c + 1}`));
  const x = numeric.length > 1 ? numeric[0] : null;
  const y = numeric.filter((c) => c !== x).slice(0, MAX_DATA_TRACES);
  return {
    separator, decimal, skip, header, rows, names, columns, numeric, x, y,
    scale: { x: x === null ? 'linear' : suggestScale(columns[x]), y: suggestScale(y.flatMap((c) => columns[c])) },
  };
}

/** Traces of `table`'s columns `y` against column `x` (null: the row
 *  number): `[{ label, points: [[x, y]] }]`, points in file order, the rows
 *  missing either number left out. */
export function tableTraces(table, x, y) {
  const xs = x === null || x === undefined ? null : table.columns[x];
  return y.slice(0, MAX_DATA_TRACES).map((c) => {
    const ys = table.columns[c] || [];
    const points = [];
    ys.forEach((value, i) => {
      const at = xs ? xs[i] : i;
      if (Number.isFinite(at) && Number.isFinite(value)) points.push([at, value]);
    });
    return { label: table.names[c] || `Column ${c + 1}`, points };
  }).filter((trace) => trace.points.length > 1);
}
