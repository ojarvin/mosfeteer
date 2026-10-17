/**
 * Parts table: the parts a design is sized with -- each transistor's W, L
 * and multiplier (mos-size.js) and each passive's or source's value -- read
 * from the drawing. The Sizing window (web/sizing-window.js) edits them; a
 * table annotation (a box carrying `table`, `LabelInstance#table`) draws them
 * on the drawing, laid out here.
 *
 * A table is a view, never a copy: the annotation keeps only which parts it
 * lists (`parts`, or null for every sized or valued part) and is drawn again
 * from them, so it never goes stale. Its box is the size of what it draws
 * (`partsTableLayout`), not a size of its own.
 */

import { GRID, ceilGrid } from './grid.js';
import { MOS_SIZE_TYPES } from './mos-size.js';
import { parseLabelRuns } from './model.js';
import { labelFontSize } from './style.js';

/** Parts whose value the table shows and edits. */
export const VALUE_TYPES = new Set([
  'resistor', 'capacitor', 'inductor', 'impedance',
  'variable_resistor', 'variable_capacitor', 'variable_inductor',
  'current_source', 'voltage_source',
]);

/** 'size' for a transistor, 'value' for a passive or source, else null. */
export function partKind(component) {
  if (!component) return null;
  if (MOS_SIZE_TYPES.has(component.type)) return 'size';
  if (VALUE_TYPES.has(component.type)) return 'value';
  return null;
}

const natural = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** Transistors first, then the rest; each by name, M2 before M10. */
export function comparePartRows(a, b) {
  const rank = (component) => (partKind(component) === 'size' ? 0 : 1);
  return rank(a) - rank(b) || natural.compare(a.refdes, b.refdes);
}

/** Every part the table can show, in table order. */
export function tableParts(circuit) {
  return [...circuit.components.values()].filter((component) => partKind(component)).sort(comparePartRows);
}

/** A table annotation's data as saved: the parts it lists, by name, or null
 *  for every part with a size or value. */
export function normalizePartsTable(table) {
  if (!table || typeof table !== 'object') return null;
  const parts = Array.isArray(table.parts)
    ? [...new Set(table.parts.filter((refdes) => typeof refdes === 'string' && refdes).map((refdes) => refdes.slice(0, 200)))].slice(0, 1000)
    : null;
  return { parts };
}

/** Whether a part has anything to show. */
function filled(component) {
  return partKind(component) === 'size' ? !!component.size : !!String(component.value ?? '').trim();
}

/** The parts a table draws, in table order: the listed ones that still
 *  exist (empty or not), else every part with a size or value. */
export function partsTableParts(circuit, table) {
  if (table?.parts) {
    return table.parts.map((refdes) => circuit.components.get(refdes)).filter((component) => partKind(component)).sort(comparePartRows);
  }
  return tableParts(circuit).filter(filled);
}

const PREFIX_TEXT = { f: 'f', p: 'p', n: 'n', u: 'µ', m: 'm' };

/** Between a number and its unit, as TeX's \\, sets it. */
const THIN_SPACE = '\u2009';

/** A stored length (`2u`, `400n`) as a table shows it: 2 µm, 400 nm. */
export function lengthText(length) {
  const match = String(length || '').match(/^(.*?)([fpnum])$/);
  return match ? `${match[1]}${THIN_SPACE}${PREFIX_TEXT[match[2]]}m` : String(length || '');
}

/** The unit each valued part's value is in. */
const UNITS = {
  resistor: 'Ω', variable_resistor: 'Ω', impedance: 'Ω',
  capacitor: 'F', variable_capacitor: 'F',
  inductor: 'H', variable_inductor: 'H',
  current_source: 'A', voltage_source: 'V',
};

// SI prefixes as values are typed (as the calculator reads them: M and meg
// are mega, m milli, u micro).
const SI = { a: -18, f: -15, p: -12, n: -9, u: -6, 'µ': -6, 'μ': -6, m: -3, '': 0, k: 3, K: 3, meg: 6, Meg: 6, MEG: 6, M: 6, G: 9, T: 12 };
const PREFIX_OF = { '-18': 'a', '-15': 'f', '-12': 'p', '-9': 'n', '-6': 'µ', '-3': 'm', 0: '', 3: 'k', 6: 'M', 9: 'G', 12: 'T' };
const VALUE = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*(meg|Meg|MEG|[afpnuµμmkKMGT]?)\s*(?:Ω|ohms?|F|H|A|V)?$/i;

/** A value as the table shows it: a number with its unit, 8p as 8 pF and
 *  1M as 1 MΩ, the prefix chosen to keep the number whole where it can
 *  (1.5n as 1500 pF, 0.5p as 500 fF), else from 1 to 999. Anything that
 *  is not a number (R_L, g_m) is shown as typed. */
export function valueText(value, type) {
  const text = String(value ?? '').trim();
  const unit = UNITS[type];
  const match = unit && text.match(VALUE);
  if (!match) return text;
  const suffix = match[2];
  const exponent = SI[suffix] ?? SI[suffix.toLowerCase()];
  if (exponent === undefined) return text;
  const number = Number(match[1]) * 10 ** exponent;
  if (!Number.isFinite(number)) return text;
  if (number === 0) return `0${THIN_SPACE}${unit}`;
  const clean = (x) => Number(x.toPrecision(12));
  // From 1 to 999 in the largest prefix; down a prefix or two while that
  // makes a whole number below 10000 -- never below the bare unit for a
  // value of one or more (3.3 Ω, not 3300 mΩ).
  let step = Math.max(-18, Math.min(12, Math.floor(Math.log10(Math.abs(number)) / 3) * 3));
  let mantissa = clean(number / 10 ** step);
  const lowest = Math.abs(number) >= 1 ? 0 : -18;
  for (let down = step - 3; down >= Math.max(lowest, step - 6) && !Number.isInteger(mantissa); down -= 3) {
    const candidate = clean(number / 10 ** down);
    if (Number.isInteger(candidate) && Math.abs(candidate) < 10000) {
      step = down;
      mantissa = candidate;
    }
  }
  return `${mantissa}${THIN_SPACE}${PREFIX_OF[step]}${unit}`;
}

/** The cells of one part as text: name (label markup), and W, L, m or
 *  value; a missing one is a dash. */
export function partCells(circuit, component) {
  const name = circuit.labelOf(component.refdes)?._text || component.refdes;
  if (partKind(component) === 'size') {
    const size = component.size;
    return { name, w: size ? lengthText(size.w) : '–', l: size ? lengthText(size.l) : '–', m: size ? String(size.m) : '' };
  }
  const value = valueText(component.value, component.type);
  return { name, value: value || '–' };
}

/** A name shown as label markup: math delimiters dropped, the rest kept. */
function nameMarkup(text) {
  const source = String(text).trim();
  return source.length >= 2 && source.startsWith('$') && source.endsWith('$') ? source.slice(1, -1) : source;
}

// Text widths without a DOM, in em, measured in Chromium: names and
// headers in the labels' bold italic sans-serif, cells in Latin Modern
// (the math font). Every column is as wide as its widest text, so the gaps
// between columns are equal where the text is.
const FACES = {
  sans: { digit: 0.556, narrow: 0.278, lower: 0.58, wide: 0.889, upper: 0.722, M: 0.833, W: 0.944, space: 0.278, thin: 0.2 },
  math: { digit: 0.5, narrow: 0.278, lower: 0.52, wide: 0.833, upper: 0.74, M: 0.917, W: 1.028, space: 0.333, thin: 0.2 },
};
const SCRIPT = 0.62;

function glyphWidth(ch, face) {
  if (/[0-9]/.test(ch)) return face.digit;
  if (/[.,:;'|!iljtf()\[\]-]/.test(ch)) return face.narrow;
  if (ch === THIN_SPACE) return face.thin;
  if (ch === ' ') return face.space;
  if (/[mw]/.test(ch)) return face.wide;
  if (ch === 'M') return face.M;
  if (ch === 'W') return face.W;
  if (/[A-ZΩ]/.test(ch)) return face.upper;
  return face.lower;
}

function textWidth(runs, fontSize, kind) {
  const face = kind === 'cell' ? FACES.math : FACES.sans;
  return runs.reduce((sum, run) => sum + [...run.text].reduce((w, ch) => w + glyphWidth(ch, face), 0) * fontSize * (run.sub || run.super ? SCRIPT : 1), 0);
}

/** A cell's text, a value named in label markup (R_{L}) with its subscript. */
const cellRuns = (text) => parseLabelRuns(nameMarkup(text || ''));

/** One table row: two cells. */
export const ROW_PITCH = 2 * GRID;
const COLUMN_GAP = GRID;
/** The gap between the transistors' block and the values' block. */
const BLOCK_GAP = GRID;

/**
 * Where everything in a table goes, from its top-left corner: a block for
 * the transistors (name, W, L, and m when any is not 1) and one for the
 * values (with their units: valueText), each under its own header and rule. Names line up on the left,
 * numbers on the right. The width and height are whole cells.
 *
 * Returns { w, h, items: [{ type: 'text', x, y, runs, anchor, role } |
 * { type: 'rule', x1, x2, y }] } (role: 'head', 'name', or 'cell').
 */
export function partsTableLayout(circuit, table, { width = 'normal' } = {}) {
  const fontSize = labelFontSize(width);
  const parts = partsTableParts(circuit, table);
  const rows = parts.map((component) => {
    const cells = partCells(circuit, component);
    return { kind: partKind(component), cells, name: parseLabelRuns(nameMarkup(cells.name)) };
  });
  const items = [];
  const baseline = (row) => row * ROW_PITCH + ROW_PITCH / 2 + fontSize * 0.35;
  if (!rows.length) {
    const runs = [{ text: 'No sized parts' }];
    items.push({ type: 'text', x: 0, y: baseline(0), runs, anchor: 'start', role: 'head' });
    return { w: ceilGrid(textWidth(runs, fontSize, 'head')), h: ROW_PITCH, items };
  }
  const nameWidth = Math.max(...rows.map((r) => textWidth(r.name, fontSize, 'name')));
  const sized = rows.filter((row) => row.kind === 'size');
  const valued = rows.filter((row) => row.kind === 'value');
  const blocks = [];
  if (sized.length) {
    const multiplier = sized.some((row) => row.cells.m && row.cells.m !== '1');
    blocks.push({ rows: sized, columns: [['W', 'w'], ['L', 'l'], ...(multiplier ? [['m', 'm']] : [])] });
  }
  if (valued.length) blocks.push({ rows: valued, columns: [['Value', 'value']] });
  let row = 0;
  let tableWidth = nameWidth;
  for (const block of blocks) {
    // Each column is as wide as its widest cell or header.
    const widths = block.columns.map(([head, key]) => (Math.max(
      textWidth([{ text: head }], fontSize, 'head'),
      ...block.rows.map((r) => textWidth(cellRuns(r.cells[key]), fontSize, 'cell')),
    )));
    const rights = [];
    let x = nameWidth;
    for (const w of widths) { x += COLUMN_GAP + w; rights.push(x); }
    tableWidth = Math.max(tableWidth, x);
    block.columns.forEach(([head], index) => {
      items.push({ type: 'text', x: rights[index], y: baseline(row), runs: [{ text: head }], anchor: 'end', role: 'head' });
    });
    items.push({ type: 'rule', x1: 0, x2: x, y: (row + 1) * ROW_PITCH - GRID / 4 });
    row += 1;
    for (const r of block.rows) {
      items.push({ type: 'text', x: 0, y: baseline(row), runs: r.name, anchor: 'start', role: 'name' });
      block.columns.forEach(([, key], index) => {
        if (r.cells[key]) items.push({ type: 'text', x: rights[index], y: baseline(row), runs: cellRuns(r.cells[key]), anchor: 'end', role: 'cell' });
      });
      row += 1;
    }
    // The next block starts a cell lower.
    if (block !== blocks.at(-1)) row += BLOCK_GAP / ROW_PITCH;
  }
  return { w: ceilGrid(tableWidth), h: ceilGrid(row * ROW_PITCH), items };
}

/** The gap a new table keeps from what is drawn, as a timing diagram does. */
const CLEARANCE = 3 * GRID;

/**
 * Put a parts table on the drawing: `parts` (names; null or empty for every
 * sized or valued part) at `at` ({ x, y }, its top-left corner), or right
 * of the drawing, level with its top. Every listed name must be a part the table
 * shows; a bad one changes nothing. Returns the table's box annotation.
 */
export function addPartsTable(circuit, { parts = null, at = null } = {}) {
  const list = parts?.length ? parts.map((refdes) => {
    const component = circuit.getComponent(refdes);
    if (!partKind(component)) throw new Error(`${component.refdes} is a ${component.type}; a parts table lists transistors, passives, and sources`);
    return component.refdes;
  }) : null;
  let corner = at;
  if (!corner) {
    // Right of the drawing, level with its top.
    const drawn = circuit.inkBounds(0);
    corner = drawn.w || drawn.h ? { x: ceilGrid(drawn.x + drawn.w) + CLEARANCE, y: drawn.y } : { x: 0, y: 0 };
  }
  const x = ceilGrid(corner.x);
  const y = Math.floor(corner.y / GRID) * GRID;
  const box = circuit.addAnnotation('box', { x, y, end: { x: x + GRID, y: y + GRID }, table: { parts: list }, style: { lineStyle: 'solid' } });
  box.syncTableBox();
  return box;
}
