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
import { newFigureId, placeFigure, settlePlaced } from './figures.js';
import { labelFontSize } from './style.js';
import { THIN_SPACE, VALUE_TYPES, valueText } from './part-value.js';

export { VALUE_TYPES, valueText };

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
  return [...circuit.components.values()].filter((component) => !component.drawingOnly && partKind(component)).sort(comparePartRows);
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

/** A stored length (`2u`, `400n`) as a table shows it: 2 µm, 400 nm. */
export function lengthText(length) {
  const match = String(length || '').match(/^(.*?)([fpnum])$/);
  return match ? `${match[1]}${THIN_SPACE}${PREFIX_TEXT[match[2]]}m` : String(length || '');
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

// Text widths without a DOM, in em, measured in Chromium in Latin Modern
// (the math font), in which the whole table is set. Every column is as wide
// as its widest text, so the gaps between columns are equal where the text
// is.
const FACE = { digit: 0.5, narrow: 0.278, lower: 0.52, wide: 0.833, upper: 0.74, M: 0.917, W: 1.028, space: 0.333, thin: 0.2 };
const SCRIPT = 0.62;

function glyphWidth(ch) {
  if (/[0-9]/.test(ch)) return FACE.digit;
  if (/[.,:;'|!iljtf()\[\]-]/.test(ch)) return FACE.narrow;
  if (ch === THIN_SPACE) return FACE.thin;
  if (ch === ' ') return FACE.space;
  if (/[mw]/.test(ch)) return FACE.wide;
  if (ch === 'M') return FACE.M;
  if (ch === 'W') return FACE.W;
  if (/[A-ZΩ]/.test(ch)) return FACE.upper;
  return FACE.lower;
}

function textWidth(runs, fontSize) {
  return runs.reduce((sum, run) => sum + [...run.text].reduce((w, ch) => w + glyphWidth(ch), 0) * fontSize * (run.sub || run.super ? SCRIPT : 1), 0);
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
    return { w: ceilGrid(textWidth(runs, fontSize)), h: ROW_PITCH, items };
  }
  const nameWidth = Math.max(...rows.map((r) => textWidth(r.name, fontSize)));
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
      textWidth([{ text: head }], fontSize),
      ...block.rows.map((r) => textWidth(cellRuns(r.cells[key]), fontSize)),
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

/** A parts table's figure identity (figures.js): which parts it lists. */
export const partsTableFigure = (parts) => ({ kind: 'table', source: 'sizing', ...(parts?.length ? { key: [...parts].sort().join(',') } : {}) });

/**
 * Put a parts table on the drawing: `parts` (names; null or empty for every
 * sized or valued part) at `at` ({ x, y }, its top-left corner), or where a
 * table goes (figures.js: right of the circuit, under the tables there).
 * Every listed name must be a part the table shows; a bad one changes
 * nothing. Returns the table's box annotation.
 */
export function addPartsTable(circuit, { parts = null, at = null } = {}) {
  const list = parts?.length ? parts.map((refdes) => {
    const component = circuit.getComponent(refdes);
    if (!partKind(component)) throw new Error(`${component.refdes} is a ${component.type}; a parts table lists transistors, passives, and sources`);
    return component.refdes;
  }) : null;
  const corner = at || placeFigure(circuit, 'table', { size: partsTableLayout(circuit, { parts: list }) });
  const x = ceilGrid(corner.x);
  const y = Math.floor(corner.y / GRID) * GRID;
  const figure = { id: newFigureId(circuit), ...partsTableFigure(list) };
  const box = circuit.addAnnotation('box', { x, y, end: { x: x + GRID, y: y + GRID }, table: { parts: list }, style: { lineStyle: 'solid' }, figure });
  box.syncTableBox();
  if (!at) settlePlaced(circuit, figure.id);
  return box;
}
