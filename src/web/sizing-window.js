/**
 * The sizing window: every transistor's W, L and multiplier, the label its
 * size draws, and every passive's or source's value, in one grid to fill
 * like a spreadsheet (core/parts-table.js lists the parts). `Shift+Z` (or
 * the toolbar's Sizing) shows or hides it.
 *
 * Cells are picked with the mouse (drag or Shift+click for a range) or the
 * arrows (Shift extends); the range's parts are selected on the canvas too.
 * Typing replaces the cells, Enter or F2 edits the one in focus, and the
 * text goes to every cell of the range that takes it: one undo step,
 * whatever it set. Delete clears them. Ctrl/Cmd+C copies the range as tab-
 * separated text; Ctrl/Cmd+V pastes one value into every cell of the range,
 * or a block (a column from a spreadsheet) from its top-left cell down.
 * A W or L typed as a whole size (`2u/400n x4`) sets all three.
 *
 * A W without an L (or the other way) has no size yet: the window keeps it,
 * marked, until the other is given. Nothing else is kept here; the grid is
 * drawn from the design on every change, so undo, a script, or the canvas
 * show at once. "Annotate" puts a parts table on the drawing.
 *
 * A double-click on a name renames the part as the canvas does. The Link
 * column names the design a part links to: a click picks one, as the
 * canvas menu does; typed or pasted, the name is taken as it is.
 *
 * A heading sorts the rows by its column, again the other way, a third
 * time back to the table's order; By type groups them under their type.
 * Both are saved with the design (`Circuit#windows`). The order is taken
 * when it is chosen and kept while cells are edited, so a row never moves
 * out from under the range; parts added, removed, or filtered take it again.
 */

import { MOS_SIZE_TYPES, parseLength, parseMosSize, parseMultiplier } from '../core/mos-size.js';
import { addPartsTable, groupPartRows, partKind, partLabelMode, partsTableFigure, sortPartRows, tableParts } from '../core/parts-table.js';
import { chooseFigure } from '../core/figures.js';
import { setPartValue } from '../core/part-moves.js';
import { componentNameIdentity, parseLabelRuns } from '../core/model.js';
import { canvasEl } from './elements.js';
import { editor } from './editor-state.js';
import { floatingWindow } from './floating-window.js';
import { logLine } from './status-bar-ui.js';
import { commit, markSettingsChanged, redo, render, setLabelSelection, setSelection, undo } from './main.js';
import { openLinkPicker } from './hierarchy.js';
import { appendContextItem, openMenuAt } from './context-menu.js';
import { element as el } from './dom.js';

const LABEL_MODES = { hidden: 'Hidden', below: 'Below the name', name: 'Instead of the name' };

/** A size label's placement from what was typed: below, name, or hidden. */
function parseLabelMode(text) {
  const word = String(text).trim().toLowerCase();
  if (/^(b|below|beside|under)/.test(word)) return 'below';
  if (/^(r|replace|na|name|i|instead)/.test(word)) return 'name';
  if (/^(h|hid|hide|hidden|of|off|no|none|-)/.test(word)) return 'hidden';
  throw new Error('a size label is below (the name), name (in its place), or hidden');
}

/** Whether a part has a size or value a label could show. */
const labeled = (c) => partLabelMode(c) !== null;

/** Where a part's size or value label stands: hidden, below, or name. */
const labelMode = partLabelMode;

// ----- columns --------------------------------------------------------------------

/** Partial sizes typed here (a W with no L yet), by part. */
const drafts = new Map();

const sized = (c) => partKind(c) === 'size';
const valued = (c) => partKind(c) === 'value';

/** What a W, L, or m cell holds: the size's, else a draft's. */
const sizePart = (c, key) => c.size?.[key] ?? drafts.get(c.refdes)?.[key] ?? '';

/**
 * The editable columns: which parts take each, its text, a check of typed
 * text (throws with the reason), and how it is set. `set` runs inside one
 * commit for all the cells of an edit.
 */
const COLUMNS = [
  {
    key: 'w', head: 'W', title: 'Width (2u, 400n; μm when bare)', takes: sized,
    text: (c) => String(sizePart(c, 'w')),
    check: (text) => (text.includes('/') ? parseMosSize(text) : parseLength(text, 'W')),
    set: (c, text) => setLength(c, 'w', text),
  },
  {
    key: 'l', head: 'L', title: 'Length (2u, 400n; μm when bare)', takes: sized,
    text: (c) => String(sizePart(c, 'l')),
    check: (text) => (text.includes('/') ? parseMosSize(text) : parseLength(text, 'L')),
    set: (c, text) => setLength(c, 'l', text),
  },
  {
    key: 'm', head: 'm', title: 'Multiplier', takes: sized,
    text: (c) => (c.size || drafts.has(c.refdes) ? String(sizePart(c, 'm') || 1) : ''),
    check: (text) => parseMultiplier(text),
    set: (c, text) => setLength(c, 'm', text),
  },
  {
    key: 'label', head: 'Label', title: 'Label on the drawing', takes: (c) => sized(c) || valued(c),
    text: (c) => (labeled(c) ? LABEL_MODES[labelMode(c)] : ''),
    check: parseLabelMode,
    set: (c, text) => setLabelMode(c, parseLabelMode(text)),
    clear: (c) => labeled(c) && setLabelMode(c, 'hidden'),
  },
  {
    key: 'value', head: 'Value', title: 'Value (10k, 1p)', takes: valued,
    text: (c) => String(c.value ?? ''),
    check: () => true,
    set: (c, text) => setPartValue(editor.circuit, c.refdes, text),
  },
  {
    key: 'link', head: 'Link', title: 'The design it links to', takes: () => true,
    text: (c) => c.link || '',
    check: () => true,
    set: (c, text) => editor.circuit.setLink(c.refdes, text),
    clear: (c) => c.link && editor.circuit.setLink(c.refdes, null),
  },
];

/** The columns a click opens a menu in, rather than an editor. */
const MENU_COLUMNS = new Set(['label', 'link']);

function setLabelMode(c, mode) {
  if (!labeled(c)) throw new Error(sized(c) ? 'needs W and L first' : 'needs a value first');
  if (sized(c)) editor.circuit.setComponentSize(c.refdes, c.size, { replacesName: mode === 'name', hidden: mode === 'hidden' });
  else editor.circuit.setValueLabel(c.refdes, mode === 'name' ? 'replace' : mode === 'below' ? 'beside' : null);
}

/** Set one of W, L, m: a whole size typed into W or L sets all three; a
 *  part with no size keeps what it has until W and L are both given. A
 *  size made here draws no label: the table is where it is read. */
function setLength(c, key, text) {
  const made = c.size ? {} : { hidden: true };
  if (key !== 'm' && text.includes('/')) {
    drafts.delete(c.refdes);
    editor.circuit.setComponentSize(c.refdes, text, made);
    return;
  }
  const value = key === 'm' ? parseMultiplier(text) : parseLength(text, key.toUpperCase());
  const next = { w: sizePart(c, 'w'), l: sizePart(c, 'l'), m: sizePart(c, 'm') || 1, [key]: value };
  if (next.w && next.l) {
    drafts.delete(c.refdes);
    editor.circuit.setComponentSize(c.refdes, next, made);
  } else drafts.set(c.refdes, next);
}

/** Empty a cell: no size (W or L), a multiplier of 1, no value. */
function clearCell(c, column) {
  if (column.clear) return column.clear(c);
  if (column.key === 'value') return setPartValue(editor.circuit, c.refdes, '');
  if (column.key === 'm') return c.size ? editor.circuit.setComponentSize(c.refdes, { ...c.size, m: 1 }) : drafts.get(c.refdes) && (drafts.get(c.refdes).m = 1);
  drafts.delete(c.refdes);
  if (c.size) editor.circuit.setComponentSize(c.refdes, null);
}

// ----- state ---------------------------------------------------------------------

let win = null; // { el, grid, body, head, filter, group, status, chrome }
let rows = []; // the parts shown, in order
let order = null; // their names, in the order taken when it was chosen
let groupStarts = new Map(); // name -> the title of the group it starts
let renaming = null; // { input, refdes, original }
let anchor = null; // { refdes, key }: where the range started
let focus = null; // { refdes, key }: the cell in focus
let editing = null; // { input, cell, original }
let shownKey = null;
let dragging = false;

const columnIndex = (key) => COLUMNS.findIndex((column) => column.key === key);
const rowIndex = (refdes) => rows.findIndex((c) => c.refdes === refdes);

/** The range as indices: { r0, r1, c0, c1 }, or null. */
function range() {
  if (!focus || rowIndex(focus.refdes) < 0) return null;
  const from = anchor && rowIndex(anchor.refdes) >= 0 ? anchor : focus;
  const [ra, rb] = [rowIndex(from.refdes), rowIndex(focus.refdes)];
  const [ca, cb] = [columnIndex(from.key), columnIndex(focus.key)];
  return { r0: Math.min(ra, rb), r1: Math.max(ra, rb), c0: Math.min(ca, cb), c1: Math.max(ca, cb) };
}

/** The cells of the range that take a value, row by row. */
function rangeCells() {
  const r = range();
  if (!r) return [];
  const cells = [];
  for (let i = r.r0; i <= r.r1; i++) {
    for (let j = r.c0; j <= r.c1; j++) if (COLUMNS[j].takes(rows[i])) cells.push({ part: rows[i], column: COLUMNS[j] });
  }
  return cells;
}

function inRange(cell) {
  const r = range();
  const i = rowIndex(cell.refdes);
  const j = columnIndex(cell.key);
  return !!r && i >= r.r0 && i <= r.r1 && j >= r.c0 && j <= r.c1;
}

function rangeParts() {
  const r = range();
  return r ? rows.slice(r.r0, r.r1 + 1) : [];
}

function say(text, kind = '') {
  if (!win) return;
  win.status.textContent = text;
  win.status.dataset.kind = kind;
}

// ----- drawing the grid ---------------------------------------------------------------

function nameNode(c) {
  const name = editor.circuit.labelOf(c.refdes)?._text || c.refdes;
  const source = /^\$.*\$$/.test(name) ? name.slice(1, -1) : name;
  return parseLabelRuns(source).map((run) => (run.sub ? el('sub', { text: run.text }) : run.super ? el('sup', { text: run.text }) : document.createTextNode(run.text)));
}

function matches(c) {
  const query = win.filter.value.trim().replace(/[_^{}$]/g, '').toLowerCase();
  if (!query) return true;
  const name = (editor.circuit.labelOf(c.refdes)?._text || '').replace(/[_^{}$]/g, '');
  return [c.refdes, name, c.type, c.value].some((text) => text && String(text).toLowerCase().includes(query));
}

/** The window's saved order: `{ sort: { key, reverse }, group }`. */
const ordering = () => editor.circuit.windows.sizing || {};

/** The parts in the saved order: sorted by a column, and grouped. */
function orderedRows(parts) {
  const { sort, group } = ordering();
  const sorted = sort ? sortPartRows(editor.circuit, parts, sort.key, { reverse: !!sort.reverse }) : parts;
  if (!group) return { list: sorted, starts: new Map() };
  const groups = groupPartRows(sorted);
  return { list: groups.flatMap((g) => g.parts), starts: new Map(groups.map((g) => [g.parts[0].refdes, g.title])) };
}

function saveOrdering({ sort, group }) {
  const value = { ...(sort ? { sort } : {}), ...(group ? { group: true } : {}) };
  if (Object.keys(value).length) editor.circuit.windows.sizing = value;
  else delete editor.circuit.windows.sizing;
  order = null;
  markSettingsChanged();
  redraw();
}

/** A heading clicked: sorted by its column, then the other way, then not. */
function sortBy(key) {
  const { sort, group } = ordering();
  const next = sort?.key !== key ? { key } : !sort.reverse ? { key, reverse: true } : null;
  saveOrdering({ sort: next, group });
}

function toggleGroup() {
  const { sort, group } = ordering();
  saveOrdering({ sort, group: !group });
}

/** The headings' arrows and the By type toggle, as the order is. */
function paintHeadings() {
  const { sort, group } = ordering();
  for (const th of win.head.querySelectorAll('th[data-key]')) {
    const active = sort?.key === th.dataset.key;
    th.setAttribute('aria-sort', active ? (sort.reverse ? 'descending' : 'ascending') : 'none');
    th.querySelector('.sizing-arrow').textContent = active ? (sort.reverse ? '▼' : '▲') : '';
  }
  win.group.setAttribute('aria-pressed', String(!!group));
}

function buildRows() {
  const shown = tableParts(editor.circuit).filter(matches);
  // The order taken stays while the same parts are shown: an edit never
  // moves a row.
  const byName = new Map(shown.map((c) => [c.refdes, c]));
  if (order && order.length === shown.length && order.every((refdes) => byName.has(refdes))) {
    rows = order.map((refdes) => byName.get(refdes));
  } else {
    const { list, starts } = orderedRows(shown);
    rows = list;
    groupStarts = starts;
    order = rows.map((c) => c.refdes);
  }
  paintHeadings();
  // Drafts of parts gone, or sized since by other means, are dropped.
  for (const refdes of drafts.keys()) {
    const c = editor.circuit.components.get(refdes);
    if (!c || !MOS_SIZE_TYPES.has(c.type) || c.size) drafts.delete(refdes);
  }
  const body = win.body;
  const groupRow = (c) => (groupStarts.has(c.refdes)
    ? [el('tr', { class: 'sizing-group' }, [el('th', { scope: 'rowgroup', colspan: String(COLUMNS.length + 2), text: groupStarts.get(c.refdes) })])]
    : []);
  body.replaceChildren(...rows.flatMap((c) => [...groupRow(c), el('tr', { 'data-refdes': c.refdes }, [
    el('th', { scope: 'row', class: 'sizing-name', title: `${c.refdes} (${c.type})` }, nameNode(c)),
    ...COLUMNS.map((column) => {
      const takes = column.takes(c);
      const draft = takes && ['w', 'l', 'm'].includes(column.key) && !c.size && drafts.has(c.refdes);
      const td = el('td', {
        class: `sizing-cell sizing-${column.key}${takes ? '' : ' sizing-none'}${draft ? ' sizing-draft' : ''}`,
        'data-key': column.key,
        ...(draft ? { title: 'Needs both W and L' } : {}),
        text: takes && !MENU_COLUMNS.has(column.key) ? column.text(c) : '',
      });
      if ((column.key === 'label' && labeled(c)) || column.key === 'link') {
        td.append(el('span', { class: 'sizing-choice', text: column.text(c) }), el('span', { class: 'sizing-chevron', 'aria-hidden': 'true', text: '▾' }));
      }
      return td;
    }),
    el('td', { class: 'sizing-fill' }),
  ])]));
  win.empty.hidden = rows.length > 0;
  win.empty.textContent = win.filter.value.trim() ? 'No part matches the filter.' : 'No transistors, passives, or sources.';
}

/** A size label's placement, chosen from the editor's menu under its
 *  cell. Chosen in a cell of the range, it goes to every sized part of it. */
function openLabelMenu(cell) {
  const part = rows[rowIndex(cell.refdes)];
  const td = win.body.querySelector(`tr[data-refdes="${CSS.escape(cell.refdes)}"] td[data-key="label"]`);
  if (!part || !labeled(part) || !td) return;
  const parts = inRange(cell) ? rangeParts().filter(labeled) : [part];
  const box = td.getBoundingClientRect();
  const menu = openMenuAt(box.left, box.bottom + 2, parts.length > 1 ? `Label of ${parts.length} parts` : 'Label');
  if (!menu) return;
  const group = el('div', { class: 'context-menu-group' });
  const modes = new Set(parts.map(labelMode));
  for (const [mode, text] of Object.entries(LABEL_MODES)) {
    appendContextItem(group, text, () => {
      applyEdits(parts.map((c) => ({ part: c, column: COLUMNS[columnIndex('label')], text: mode })), 'Set');
      win.grid.focus();
    }, { active: modes.size === 1 && modes.has(mode), mixed: modes.size > 1 && modes.has(mode) });
  }
  menu.append(group);
  menu.querySelector('button:not(:disabled)')?.focus();
}

/** The design a part links to, picked from the canvas's list under its
 *  cell; picked in a cell of the range, for every part of it. */
function openLinkMenu(cell) {
  const part = rows[rowIndex(cell.refdes)];
  const td = win.body.querySelector(`tr[data-refdes="${CSS.escape(cell.refdes)}"] td[data-key="link"]`);
  if (!part || !td) return;
  const box = td.getBoundingClientRect();
  openLinkPicker(inRange(cell) ? rangeParts() : [part], box.left, box.bottom + 2);
}

function openCellMenu(cell) {
  if (cell.key === 'link') openLinkMenu(cell);
  else openLabelMenu(cell);
}

/** Mark the range, the focus, and the parts selected on the canvas. */
function paintSelection() {
  const r = range();
  const onCanvas = editor.multi?.size ? editor.multi : new Set(editor.selected ? [editor.selected] : []);
  [...win.body.querySelectorAll('tr[data-refdes]')].forEach((tr, i) => {
    tr.classList.toggle('selected', onCanvas.has(tr.dataset.refdes));
    [...tr.cells].slice(1, COLUMNS.length + 1).forEach((td, j) => {
      const inRange = !!r && i >= r.r0 && i <= r.r1 && j >= r.c0 && j <= r.c1;
      td.classList.toggle('in-range', inRange);
      td.classList.toggle('focus', !!focus && tr.dataset.refdes === focus.refdes && COLUMNS[j].key === focus.key);
    });
  });
}

/** The window follows the document: undo, redo, another design, a script. */
export function renderSizingWindow() {
  if (!win || win.el.hidden || editing || renaming) return;
  const key = { circuit: editor.circuit, revision: editor.modelRevision, filter: win.filter.value, drafts: drafts.size };
  if (!shownKey || Object.keys(key).some((field) => shownKey[field] !== key[field])) {
    shownKey = key;
    buildRows();
  }
  paintSelection();
}

function redraw() {
  shownKey = null;
  renderSizingWindow();
}

// ----- selection ---------------------------------------------------------------------

function cellOf(target) {
  const td = target?.closest?.('td.sizing-cell');
  if (!td) return null;
  return { refdes: td.parentElement.dataset.refdes, key: td.dataset.key };
}

function focusCellEl() {
  if (!focus) return null;
  return win.body.querySelector(`tr[data-refdes="${CSS.escape(focus.refdes)}"] td[data-key="${focus.key}"]`);
}

/** Pick a cell (or extend the range to it) and select its parts on the canvas. */
function pick(cell, extend = false) {
  if (!cell) return;
  if (!extend || !anchor) anchor = cell;
  focus = cell;
  const refs = rangeParts().map((c) => c.refdes);
  setSelection(refs);
  render();
  paintSelection();
  focusCellEl()?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function move(dr, dc, extend) {
  if (!rows.length) return;
  const at = focus && rowIndex(focus.refdes) >= 0 ? focus : { refdes: rows[0].refdes, key: COLUMNS[0].key };
  const r = Math.max(0, Math.min(rows.length - 1, rowIndex(at.refdes) + dr));
  const c = Math.max(0, Math.min(COLUMNS.length - 1, columnIndex(at.key) + dc));
  pick({ refdes: rows[r].refdes, key: COLUMNS[c].key }, extend);
}

// ----- editing -----------------------------------------------------------------------

/** Run edits as one undo step; a cell that cannot take its text is left
 *  and counted. Returns how many were set. */
function applyEdits(edits, verb) {
  let set = 0;
  const skipped = [];
  const before = drafts.size;
  commit(() => {
    for (const { part, column, text } of edits) {
      try {
        if (text === null) clearCell(part, column);
        else column.set(part, text);
        set += 1;
      } catch (error) {
        skipped.push(`${part.refdes} ${column.head}: ${error.message}`);
      }
    }
  });
  render();
  if (drafts.size !== before || set) redraw();
  if (skipped.length) say(`${verb} ${set} cell${set === 1 ? '' : 's'}; ${skipped.length} skipped (${skipped.slice(0, 3).join('; ')}${skipped.length > 3 ? '; ...' : ''})`, 'error');
  else if (edits.length > 1) say(`${verb} ${set} cells.`);
  else say('');
  return set;
}

function startEditing(initial = null) {
  const td = focusCellEl();
  const part = focus && rows[rowIndex(focus.refdes)];
  const column = focus && COLUMNS[columnIndex(focus.key)];
  if (!td || !part || !column?.takes(part)) {
    if (part && column?.key === 'label') say(`${part.refdes} needs ${sized(part) ? 'W and L' : 'a value'} first.`, 'error');
    return;
  }
  const original = column.text(part);
  const input = el('input', { type: 'text', class: 'sizing-input', 'aria-label': `${part.refdes} ${column.head}`, spellcheck: 'false', value: initial ?? original });
  td.replaceChildren(input);
  td.classList.add('editing');
  editing = { input, td, original, column };
  input.focus();
  if (initial === null) input.select();
  else input.setSelectionRange(input.value.length, input.value.length);
  input.addEventListener('keydown', onInputKey);
  input.addEventListener('blur', () => { if (editing?.input === input) finishEditing({ keep: true }); });
}

/** End the edit: with `apply`, the text goes to every cell of the range
 *  its column's check accepts; a text no cell accepts keeps the editor
 *  open with the reason. `keep` (a blur) drops a bad text instead. */
function finishEditing({ apply = true, keep = false } = {}) {
  if (!editing) return false;
  const { input, td, original, column } = editing;
  const text = input.value.trim();
  const changed = apply && text !== original;
  if (changed && text) {
    try {
      column.check(text);
    } catch (error) {
      if (!keep) {
        say(error.message, 'error');
        input.focus();
        return false;
      }
      say(`Not set: ${error.message}`, 'error');
      editing = null;
      td.classList.remove('editing');
      redraw();
      return false;
    }
  }
  editing = null;
  td.classList.remove('editing');
  if (changed) {
    // Every cell of the range in a column that takes this text.
    const edits = rangeCells().filter(({ column: other }) => {
      if (!text) return true;
      return accepts(other, text);
    }).map(({ part, column: other }) => ({ part, column: other, text: text || null }));
    applyEdits(edits.length ? edits : [{ part: rows[rowIndex(focus.refdes)], column, text: text || null }], 'Set');
  }
  redraw();
  return true;
}

function onInputKey(ev) {
  if (ev.key === 'Escape') {
    ev.preventDefault();
    ev.stopPropagation();
    finishEditing({ apply: false });
    win.grid.focus();
    return;
  }
  if (ev.key === 'Enter' || ev.key === 'Tab') {
    ev.preventDefault();
    ev.stopPropagation();
    const single = rangeCells().length <= 1;
    if (!finishEditing()) return;
    win.grid.focus();
    // A single cell moves on, as a spreadsheet's does; a range stays picked.
    if (ev.key === 'Tab') move(0, ev.shiftKey ? -1 : 1, false);
    else if (single) move(ev.shiftKey ? -1 : 1, 0, false);
  }
}

// ----- renaming ----------------------------------------------------------------------

const IDENTITY = /^[A-Za-z][A-Za-z0-9_]*$/;

/** Rename a part in its name cell, as the canvas does: Enter renames, Esc
 *  or leaving the field with a name that cannot be keeps it. */
function startRename(refdes) {
  if (editing) finishEditing({ keep: true });
  const th = win.body.querySelector(`tr[data-refdes="${CSS.escape(refdes)}"] th.sizing-name`);
  if (!th || !editor.circuit.components.has(refdes)) return;
  const original = editor.circuit.labelOf(refdes)?.text || refdes;
  const input = el('input', { type: 'text', class: 'sizing-input sizing-rename', 'aria-label': `Rename ${refdes}`, spellcheck: 'false', value: original });
  th.replaceChildren(input);
  renaming = { input, refdes, original };
  input.focus();
  input.select();
  input.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' && ev.key !== 'Escape') return;
    ev.preventDefault();
    ev.stopPropagation();
    if (ev.key === 'Escape' ? endRename() : finishRename()) win.grid.focus();
  });
  input.addEventListener('blur', () => {
    if (renaming?.input === input && !finishRename()) endRename();
  });
}

function endRename() {
  renaming = null;
  redraw();
  return true;
}

/** Rename the part to what was typed; a name that cannot be, or is taken,
 *  keeps the field open with the reason. */
function finishRename() {
  const { input, refdes, original } = renaming;
  const text = input.value.trim();
  if (!text || text === original) return endRename();
  const next = componentNameIdentity(text);
  if (!IDENTITY.test(next)) {
    say(`Invalid component name "${text}".`, 'error');
    return false;
  }
  if (next !== refdes && editor.circuit.components.has(next)) {
    say(`Component name "${next}" is already in use.`, 'error');
    return false;
  }
  renaming = null;
  commit(() => editor.circuit.renameComponent(refdes, next, { displayLabel: text }));
  followRename(refdes, next);
  say('');
  render();
  redraw();
  return true;
}

/** What the editor and the window hold by a part's name, renamed. */
function followRename(previous, next) {
  if (previous === next) return;
  if (editor.selected === previous) editor.selected = next;
  if (editor.multi.has(previous)) {
    editor.multi.delete(previous);
    editor.multi.add(next);
  }
  if (editor.componentRangeAnchor === previous) editor.componentRangeAnchor = next;
  for (const cell of [anchor, focus]) if (cell?.refdes === previous) cell.refdes = next;
  if (order) order = order.map((refdes) => (refdes === previous ? next : refdes));
  if (groupStarts.has(previous)) {
    groupStarts.set(next, groupStarts.get(previous));
    groupStarts.delete(previous);
  }
}

// ----- the keyboard and the clipboard ----------------------------------------------------

function onGridKey(ev) {
  if (editing || renaming) return;
  // Ctrl/Cmd+C, X, V: the browser's copy, cut, and paste events on the
  // grid do them; the canvas must not copy or paste its parts as well.
  if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && !ev.shiftKey && ['c', 'x', 'v'].includes(ev.key.toLowerCase())) {
    ev.stopPropagation();
    return;
  }
  // What the grid does with a key, the canvas must not do too (Delete
  // would delete the parts the range selects).
  if (gridKey(ev)) {
    ev.preventDefault();
    ev.stopPropagation();
  }
}

/** Handle a key on the grid; true when it was the grid's. */
function gridKey(ev) {
  const mod = ev.ctrlKey || ev.metaKey;
  const arrows = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
  if (arrows[ev.key] && !mod && !ev.altKey) {
    move(...arrows[ev.key], ev.shiftKey);
    return true;
  }
  if (ev.key === 'Tab' && !mod && focus) {
    move(0, ev.shiftKey ? -1 : 1, false);
    return true;
  }
  if (mod && !ev.altKey && ev.key.toLowerCase() === 'a') {
    if (rows.length) {
      anchor = { refdes: rows[0].refdes, key: COLUMNS[0].key };
      pick({ refdes: rows.at(-1).refdes, key: COLUMNS.at(-1).key }, true);
    }
    return true;
  }
  if (mod && !ev.altKey && ev.key.toLowerCase() === 'z') {
    if (ev.shiftKey) redo(); else undo();
    return true;
  }
  if (mod && !ev.altKey && ev.key.toLowerCase() === 'y') {
    redo();
    return true;
  }
  if (ev.key === 'Enter' || ev.key === 'F2') {
    if (MENU_COLUMNS.has(focus?.key)) openCellMenu(focus);
    else startEditing();
    return true;
  }
  if (ev.key === 'Delete' || ev.key === 'Backspace') {
    const cells = rangeCells();
    if (cells.length) applyEdits(cells.map((cell) => ({ ...cell, text: null })), 'Cleared');
    return true;
  }
  if (ev.key === 'Escape') {
    if (anchor && focus && (anchor.refdes !== focus.refdes || anchor.key !== focus.key)) pick(focus);
    else canvasEl.focus({ preventScroll: true });
    return true;
  }
  if (ev.key.length === 1 && !mod && !ev.altKey && focus) {
    startEditing(ev.key);
    return true;
  }
  return false;
}

/** The range as tab-separated text: a row a line, a cell that takes no
 *  value empty. */
function rangeText() {
  const r = range();
  if (!r) return '';
  const lines = [];
  for (let i = r.r0; i <= r.r1; i++) {
    const cells = [];
    for (let j = r.c0; j <= r.c1; j++) cells.push(COLUMNS[j].takes(rows[i]) ? COLUMNS[j].text(rows[i]) : '');
    lines.push(cells.join('\t'));
  }
  return lines.join('\n');
}

function onCopy(ev) {
  if (editing || !range()) return;
  ev.preventDefault();
  ev.stopPropagation();
  ev.clipboardData.setData('text/plain', rangeText());
  const r = range();
  const count = (r.r1 - r.r0 + 1) * (r.c1 - r.c0 + 1);
  say(`Copied ${count} cell${count === 1 ? '' : 's'}.`);
}

function accepts(column, text) {
  try { column.check(text); return true; } catch { return false; }
}

/** Pasted text, a line a row and tabs between columns, repeated over the
 *  range as a spreadsheet does: one cell fills it all, one row (copied from
 *  M1, say) fills every row of it. A block larger than the range goes from
 *  its top-left cell, down and right. */
export function pasteText(text) {
  const r = range();
  if (!r) return 0;
  const block = String(text).replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n').map((line) => line.split('\t').map((cell) => cell.trim()));
  const width = Math.max(...block.map((line) => line.length));
  const height = Math.max(block.length, r.r1 - r.r0 + 1);
  const across = Math.max(width, r.c1 - r.c0 + 1);
  const edits = [];
  for (let i = 0; i < height; i++) {
    const part = rows[r.r0 + i];
    if (!part) break;
    for (let j = 0; j < across; j++) {
      const column = COLUMNS[r.c0 + j];
      const cellText = block[i % block.length][j % width];
      if (!column?.takes(part) || cellText === undefined) continue;
      // One value goes only where it reads, as typed text does.
      if (block.length === 1 && width === 1 && cellText && !accepts(column, cellText)) continue;
      edits.push({ part, column, text: cellText || null });
    }
  }
  if (!edits.length) {
    say('Nothing here takes that.', 'error');
    return 0;
  }
  return applyEdits(edits, 'Pasted');
}

function onCut(ev) {
  if (editing || !range()) return;
  onCopy(ev);
  const cells = rangeCells();
  if (cells.length) applyEdits(cells.map((cell) => ({ ...cell, text: null })), 'Cut');
}

function onPaste(ev) {
  if (editing) return;
  ev.preventDefault();
  ev.stopPropagation();
  pasteText(ev.clipboardData.getData('text/plain'));
}

// ----- the mouse -----------------------------------------------------------------------

function onMouseDown(ev) {
  if (ev.button !== 0 || ev.target.closest('.sizing-input')) return;
  const name = ev.target.closest('th.sizing-name');
  if (name) {
    // A name picks its whole row.
    ev.preventDefault();
    const refdes = name.parentElement.dataset.refdes;
    if (!ev.shiftKey || !anchor) anchor = { refdes, key: COLUMNS[0].key };
    pick({ refdes, key: COLUMNS.at(-1).key }, true);
    win.grid.focus();
    return;
  }
  const cell = cellOf(ev.target);
  if (!cell) return;
  ev.preventDefault();
  if (editing) finishEditing({ keep: true });
  // A label's or link's cell in the range keeps the range: its menu is for all.
  if (MENU_COLUMNS.has(cell.key) && !ev.shiftKey && inRange(cell)) {
    win.grid.focus();
    return;
  }
  win.grid.focus();
  pick(cell, ev.shiftKey);
  dragging = true;
}

function onMouseOver(ev) {
  if (!dragging) return;
  const cell = cellOf(ev.target);
  if (cell && (cell.refdes !== focus?.refdes || cell.key !== focus?.key)) pick(cell, true);
}

// ----- column widths -------------------------------------------------------------------
//
// Each column is as wide as it was made, in pixels: dragging a heading's
// right edge resizes it, a double-click there fits it to what it holds.
// What room is left goes to an empty column at the right; columns wider
// than the window scroll sideways. Kept in this browser, as the windows'
// places are: a way of looking, not part of the design.

const WIDTHS_KEY = 'mosfeteer.sizing.columns';
const DEFAULT_WIDTHS = { name: 72, w: 56, l: 56, m: 36, label: 144, value: 64, link: 96 };
const MIN_WIDTH = 28;
const MAX_WIDTH = 480;

function readWidths() {
  try {
    const saved = JSON.parse(localStorage.getItem(WIDTHS_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      const widths = { ...DEFAULT_WIDTHS };
      for (const key of Object.keys(DEFAULT_WIDTHS)) if (Number.isFinite(saved[key])) widths[key] = clampWidth(saved[key]);
      return widths;
    }
  } catch { /* the defaults */ }
  return { ...DEFAULT_WIDTHS };
}

const clampWidth = (px) => Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, px)));

let widths = readWidths();

function saveWidths() {
  try { localStorage.setItem(WIDTHS_KEY, JSON.stringify(widths)); } catch { /* this visit only */ }
}

/** Every column at its width; the table as wide as they are together. */
function applyWidths() {
  for (const [key, col] of Object.entries(win.cols)) col.style.width = `${widths[key]}px`;
  win.table.style.width = `${Object.values(widths).reduce((sum, px) => sum + px, 0)}px`;
}

/** The width a column's widest heading or cell needs. */
function fittedWidth(key) {
  const index = key === 'name' ? 0 : columnIndex(key) + 1;
  let need = 0;
  for (const tr of win.table.querySelectorAll('thead tr, tbody tr[data-refdes]')) {
    const cell = tr.cells[index];
    if (!cell) continue;
    const style = getComputedStyle(cell);
    const pad = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    const sort = cell.querySelector('.sizing-sort');
    const choice = cell.querySelector('.sizing-choice');
    // A heading's button and a menu cell's choice are cut short inside it:
    // their own width is what they need.
    const content = sort ? sort.scrollWidth + 8 : choice ? choice.scrollWidth + 14 : cell.scrollWidth - pad;
    need = Math.max(need, content + pad);
  }
  return clampWidth(Math.ceil(need) + 2);
}

/** Two presses on one edge this close in time and place fit its column:
 *  read from the presses themselves, since a first press that starts a drag
 *  (and captures the pointer) keeps some browsers from a dblclick. */
const DOUBLE_PRESS_MS = 450;
const DOUBLE_PRESS_PX = 6;
let lastPress = null; // { key, time, x }

/** A heading's right edge: drag to resize, double-click to fit. */
function resizeHandle(key) {
  const handle = el('span', { class: 'sizing-resize', 'aria-hidden': 'true' });
  handle.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    const time = performance.now();
    if (lastPress?.key === key && time - lastPress.time < DOUBLE_PRESS_MS && Math.abs(ev.clientX - lastPress.x) < DOUBLE_PRESS_PX) {
      lastPress = null;
      widths[key] = fittedWidth(key);
      applyWidths();
      saveWidths();
      // The edge has moved: the click this press ends in lands on a heading,
      // which must not sort.
      const swallow = (e) => { e.stopPropagation(); e.preventDefault(); };
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), DOUBLE_PRESS_MS);
      return;
    }
    lastPress = { key, time, x: ev.clientX };
    handle.setPointerCapture(ev.pointerId);
    const start = { x: ev.clientX, width: widths[key] };
    win.el.classList.add('sizing-resizing');
    const move = (e) => {
      widths[key] = clampWidth(start.width + e.clientX - start.x);
      applyWidths();
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      win.el.classList.remove('sizing-resizing');
      saveWidths();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });
  handle.addEventListener('click', (ev) => ev.stopPropagation());
  handle.addEventListener('dblclick', (ev) => ev.stopPropagation());
  return handle;
}

// ----- the window --------------------------------------------------------------------

/** "Annotate": a parts table of the range's parts (of every sized or
 *  valued part, with one row or none picked) right of the drawing. */
function annotate() {
  const parts = rangeParts();
  const listed = parts.length > 1 ? parts.map((c) => c.refdes) : null;
  // A table of the same parts is there already, and always current: shown.
  const there = chooseFigure(editor.circuit, partsTableFigure(listed))?.labels.find((label) => label.table);
  if (there) {
    setLabelSelection([there.id]);
    render();
    logLine('The parts table is on the drawing already; it follows the sizes as they change.');
    return;
  }
  const box = commit(() => addPartsTable(editor.circuit, { parts: listed }));
  if (!box) return;
  setLabelSelection([box.id]);
  render();
  logLine('Parts table added right of the drawing.');
}

function build() {
  const close = el('button', { type: 'button', class: 'floating-window-close', 'aria-label': 'Close the sizing window', title: 'Close (Shift+Z)', text: '×' });
  const filter = el('input', { type: 'search', class: 'sizing-filter', placeholder: 'Filter parts', 'aria-label': 'Filter parts', spellcheck: 'false' });
  const group = el('button', { type: 'button', class: 'sizing-group-toggle', 'aria-pressed': 'false', title: 'Group by type', text: 'By type', onclick: toggleGroup });
  const heading = (key, text, title, cls = '') => el('th', { scope: 'col', class: cls, 'data-key': key }, [
    el('button', { type: 'button', class: 'sizing-sort', title, onclick: () => sortBy(key) }, [text, el('span', { class: 'sizing-arrow', 'aria-hidden': 'true' })]),
    resizeHandle(key),
  ]);
  const head = el('tr', {}, [
    heading('name', 'Name', 'Sort by name'),
    ...COLUMNS.map((column) => heading(column.key, column.head, column.title, `sizing-${column.key}`)),
    el('th', { class: 'sizing-fill', 'aria-hidden': 'true' }),
  ]);
  const body = el('tbody');
  // Fixed columns: a cell opened for typing never reflows the grid. The
  // last, with no width, takes the room left.
  const colOf = Object.fromEntries(['name', ...COLUMNS.map((column) => column.key)].map((key) => [key, el('col')]));
  const cols = el('colgroup', {}, [...Object.values(colOf), el('col')]);
  const table = el('table', { class: 'sizing-table' }, [cols, el('thead', {}, [head]), body]);
  const grid = el('div', { class: 'sizing-grid', tabindex: '0', role: 'grid', 'aria-label': 'Sizes and values' }, [table]);
  const empty = el('p', { class: 'field-hint sizing-empty', hidden: true });
  const status = el('p', { class: 'field-hint sizing-status', role: 'status' });
  const hint = el('p', { class: 'field-hint sizing-hint', text: 'Type to fill the selected cells. Ctrl+C and Ctrl+V work with spreadsheets.' });
  const annotateButton = el('button', { type: 'button', class: 'sizing-annotate', title: 'Put a parts table on the drawing', text: 'Annotate', onclick: annotate });
  const node = el('section', { class: 'floating-window sizing-window', 'aria-labelledby': 'sizing-title', hidden: true }, [
    el('header', { class: 'floating-window-header' }, [el('h2', { id: 'sizing-title', class: 'floating-window-title', text: 'Sizing' }), close]),
    el('div', { class: 'sizing-body' }, [el('div', { class: 'sizing-tools' }, [filter, group]), grid, empty, status, hint]),
    el('footer', { class: 'window-footer' }, [annotateButton]),
  ]);
  filter.addEventListener('input', redraw);
  filter.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown' || ev.key === 'Enter') {
      ev.preventDefault();
      grid.focus();
      if (!focus && rows.length) pick({ refdes: rows[0].refdes, key: COLUMNS[0].key });
    }
  });
  grid.addEventListener('keydown', onGridKey);
  grid.addEventListener('copy', onCopy);
  grid.addEventListener('cut', onCut);
  grid.addEventListener('paste', onPaste);
  grid.addEventListener('mousedown', onMouseDown);
  grid.addEventListener('mouseover', onMouseOver);
  grid.addEventListener('dblclick', (ev) => {
    const name = ev.target.closest('th.sizing-name');
    if (name) startRename(name.parentElement.dataset.refdes);
    else if (cellOf(ev.target) && !MENU_COLUMNS.has(cellOf(ev.target).key)) startEditing();
  });
  // A click on a label's or link's cell opens its menu (a drag ends elsewhere).
  grid.addEventListener('click', (ev) => {
    const cell = cellOf(ev.target);
    if (MENU_COLUMNS.has(cell?.key) && !ev.shiftKey) openCellMenu(cell);
  });
  grid.addEventListener('contextmenu', (ev) => {
    const cell = cellOf(ev.target);
    if (!MENU_COLUMNS.has(cell?.key)) return;
    ev.preventDefault();
    if (!inRange(cell)) pick(cell);
    openCellMenu(cell);
  });
  window.addEventListener('mouseup', () => { dragging = false; });
  canvasEl.closest('.canvas-pane').append(node);
  const chrome = floatingWindow(node, { key: 'sizing', onClose: hide, resizable: true, toggleKey: 'Z' });
  win = { el: node, grid, table, body, head, cols: colOf, filter, group, empty, status, chrome };
  applyWidths();
}

function syncButton() {
  document.getElementById('btn-window-sizing')?.setAttribute('aria-pressed', String(sizingShown()));
}

export function sizingShown() {
  return !!win && !win.el.hidden;
}

function show() {
  if (!win) build();
  win.el.hidden = false;
  order = null;
  redraw();
  win.chrome.place();
  // The parts selected on the canvas come in picked.
  const selected = rows.filter((c) => editor.multi?.has(c.refdes) || c.refdes === editor.selected);
  if (selected.length) {
    anchor = { refdes: selected[0].refdes, key: COLUMNS[0].key };
    focus = { refdes: selected.at(-1).refdes, key: COLUMNS[0].key };
    paintSelection();
  }
  win.grid.focus();
  syncButton();
}

function hide() {
  if (!win || win.el.hidden) return;
  if (editing) finishEditing({ keep: true });
  renaming = null;
  win.el.hidden = true;
  syncButton();
  canvasEl.focus({ preventScroll: true });
}

/** Open the window on one part's cell, ready to type into it. */
export function editInSizing(refdes, key) {
  if (!sizingShown()) show();
  if (rowIndex(refdes) < 0 && win.filter.value) {
    win.filter.value = '';
    redraw();
  }
  if (rowIndex(refdes) < 0) return;
  anchor = null;
  pick({ refdes, key });
  win.grid.focus();
  startEditing();
}

/** Shift+Z: the sizing window, open or closed. */
export function toggleSizing() {
  if (sizingShown()) hide();
  else show();
}

export function installSizing() {
  document.getElementById('btn-window-sizing')?.addEventListener('click', toggleSizing);
}

/** Another design shown: its own parts, nothing half typed from the last. */
export function sizingDocumentShown() {
  drafts.clear();
  anchor = null;
  focus = null;
  order = null;
  renaming = null;
  if (editing) {
    editing = null;
  }
  say('');
  if (win) redraw();
}
