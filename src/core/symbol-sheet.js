/**
 * The symbol reference sheet: every placeable symbol, drawn from the live
 * registry, one row per category (longer categories wrap). It is built on
 * demand, never saved, so it can never go stale; the editor shows it from
 * Settings (and `:symbols`), and `GET /api/symbols.svg` serves it for
 * scripted visual checks.
 */

import { Circuit } from './model.js';
import { runCommand } from './commands.js';
import { getSymbol } from './components/index.js';
import { SYMBOL_SHEET_ROWS, symbolCategories } from './components/categories.js';
import { GRID } from './grid.js';

/** Symbols per row, and the space a symbol gets around its body. */
const PER_ROW = 8;
const COLUMN_GAP = 7 * GRID;
const ROW_GAP = 4 * GRID;
/** Room above and below a row for the parts' own labels. */
const LABEL_ROOM = 2 * GRID;
/** Category captions end this far left of the first column. */
const CAPTION_GAP = 4 * GRID;

const snapUp = (value) => Math.ceil(value / GRID) * GRID;

/** The rows of the sheet: [{ title, types }], each at most PER_ROW long.
 *  A category's families take rows of their own (SYMBOL_SHEET_ROWS); only
 *  a category's first row carries its title. */
export function symbolSheetRows(categories = symbolCategories()) {
  const rows = [];
  for (const { title, types } of categories) {
    const families = [];
    let rest = types;
    for (const rule of SYMBOL_SHEET_ROWS[title] || []) {
      families.push(rest.filter((type) => rule.test(type)));
      rest = rest.filter((type) => !rule.test(type));
    }
    families.push(rest);
    let first = true;
    for (const family of families) {
      for (let at = 0; at < family.length; at += PER_ROW) {
        rows.push({ title: first ? title : null, types: family.slice(at, at + PER_ROW) });
        first = false;
      }
    }
  }
  return rows;
}

/** Build the sheet as a fresh Circuit. */
export function symbolSheet(categories = symbolCategories()) {
  const circuit = new Circuit();
  const rows = symbolSheetRows(categories);
  const boxes = (types) => types.map((type) => getSymbol(type).bbox);
  // Every column is as wide as the widest symbol anywhere, so the columns
  // line up down the whole sheet.
  const pitch = snapUp(Math.max(...rows.flatMap((row) => boxes(row.types).map((box) => box.w))) + COLUMN_GAP);
  const left = Math.min(...rows.flatMap((row) => boxes(row.types).map((box) => box.x)));
  let top = 0;
  for (const row of rows) {
    const rowBoxes = boxes(row.types);
    const above = -Math.min(...rowBoxes.map((box) => box.y));
    const below = Math.max(...rowBoxes.map((box) => box.y + box.h));
    const y = snapUp(top + LABEL_ROOM + above);
    row.types.forEach((type, column) => runCommand(circuit, `add ${type} --at ${column * pitch} ${y}`));
    if (row.title) {
      const id = `category_${row.title.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
      runCommand(circuit, `annotation add ${id} "${row.title}" 0 ${y} --align right --right-edge ${left - CAPTION_GAP}`);
    }
    top = y + below + LABEL_ROOM + ROW_GAP;
  }
  return circuit;
}
