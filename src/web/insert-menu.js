/**
 * Choosing a part to place: the insert menu (i) with its fuzzy search,
 * categories, and recent placements, and the quick-add menu a pin drag or a
 * double-click opens in empty space.
 */

import { Circuit } from '../core/model.js';
import { getSymbol, symbolTypeNames } from '../core/components/index.js';
import { svgString } from '../core/render.js';
import { INSERT_RECENT_LIMIT, PLACEMENT_LABELS, fuzzyScore, placementSearchScore, withRecentType } from './toolbar.js';
import { arrivalDirection, quickAddPlacement } from './gestures.js';
import { canvasEl } from './elements.js';
import { ICON_PATHS } from './icons.js';
import { logLine } from './status-bar-ui.js';
import { worldToClient } from './canvas-view.js';
import { editor } from './editor-state.js';
import { placeNetLabelAt } from './annotation-tools.js';
import { applyJson, clearSymmetry, commit, commitWireAtCursor, connectWireToTerminal, draftRoutePath, endGestureWire, markModelChanged, moveCursor, placePending, recordHistoryEntry, render, setSymmetry, snapshot, transformPendingComponent, undo } from './main.js';

const PLACEMENT = {
  r: 'resistor',
  c: 'capacitor',
  L: 'inductor',
  d: 'diode',
  n: 'nmos',
  p: 'pmos',
  N: 'npn',
  P: 'pnp',
  g: 'ground',
  s: 'supply',
  x: 'switch_open',
  X: 'switch_closed',
  i: 'current_source',
  v: 'voltage_source',
  u: 'opamp',
  A: 'and2_gate',
  b: 'buffer',
  I: 'input',
  o: 'output',
  O: 'inputoutput',
  a: 'solder',
};

// Human-facing names keep the picker useful at a glance. Aliases stay out of
// the menu while the underlying type remains the stable placement value.
// The registry is the single source of truth for insertable components.
// Grouping is derived from the type name, so adding a symbol to symbolTypes
// automatically adds it to the appropriate menu section.
const INSERT_COMPONENT_TYPES = [...symbolTypeNames];

// Browse order is analog first, digital second, with the interface ports kept
// above both macros and the digital cells. A query reorders the groups by their
// best match instead, so this is the order of the unfiltered list.
const INSERT_CATEGORY_RULES = [
  ['Passives', /^(variable_)?(resistor|capacitor|inductor)$|^diode$/],
  ['Semiconductors / actives', /^(nmos|pmos|nmosb|pmosb|npn|pnp)$/],
  ['Switches', /^switch_/],
  ['Sources & power', /^(current_source|voltage_source|vccs|supply|ground|vcm)$/],
  ['Interfaces / ports', /^(input|output|inputoutput|port)$/],
  ['Macros', /^(opamp|opamp_diff|adc|dac)$/],
  ['Logic', /^(inverter|buffer|tristate_(inverter|buffer)|mux2|.*_gate)$/],
  ['Sequential', /^(?:dff|latch)(?:_|$)/],
  ['Blocks / shells', /^block$/],
  ['Signal flow', /^signal_(sum|multiply)$/],
];

// Arrow-key highlight in the insert picker. It belongs to one query string, so
// typing or deleting a character returns the highlight to the best match.
let insertNav = { query: '', index: 0 };

function insertHighlightIndex(entries = insertMenuEntries()) {
  if (insertNav.query !== editor.insertQuery || !entries.length) return 0;
  return Math.min(insertNav.index, entries.length - 1);
}

/** Up/Down step through matches; Left/Right jump to the previous/next category. */
function moveInsertHighlight(key) {
  const groups = insertMenuGroups();
  const entries = groups.flatMap((group) => group.entries);
  if (!entries.length) return;
  let index = insertHighlightIndex(entries);
  if (key === 'ArrowDown') index = (index + 1) % entries.length;
  else if (key === 'ArrowUp') index = (index - 1 + entries.length) % entries.length;
  else {
    const starts = [];
    let offset = 0;
    for (const group of groups) { starts.push(offset); offset += group.entries.length; }
    const current = starts.findLastIndex((start) => start <= index);
    if (key === 'ArrowRight') index = starts[(current + 1) % starts.length];
    else if (index !== starts[current]) index = starts[current];
    else index = starts[(current - 1 + starts.length) % starts.length];
  }
  insertNav = { query: editor.insertQuery, index };
}

function selectInsertMatch() {
  const entries = insertMenuEntries();
  if (!entries.length) return false;
  return pickInsertType(entries[insertHighlightIndex(entries)]);
}

/** Arm the ghost for one picked entry.  Shared by Enter/Tab and menu clicks. */
function pickInsertType(type) {
  if (!type) return false;
  const startWorld = { ...editor.cursor };
  insertNav = { query: '', index: 0 };
  editor.pendingPlace = type === 'label'
    ? { kind: 'label', startWorld }
    : { kind: 'component', type, rotation: 0, mirrorX: null, mirrorY: null, startWorld };
  if (editor.altHeld && editor.pendingPlace.kind === 'component') setSymmetry(true);
  editor.insertQuery = '';
  return true;
}

export function onInsertKey(key, shiftKey = false) {
  if (key === 'u' && editor.pendingPlace) {
    undo();
    return;
  }
  // Arrow keys browse the picker; once a ghost exists they move the cursor and ghost.
  const arrow = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[key];
  if (arrow && !editor.pendingPlace) {
    moveInsertHighlight(key);
    render();
    return;
  }
  if (arrow) {
    moveCursor(arrow[0], arrow[1]);
    render();
    return;
  }
  // With a ghost selected, r rotates CW and Shift+r mirrors horizontally.
  if (editor.pendingPlace && editor.pendingPlace.kind === 'component' && key === 'r' && !shiftKey) {
    transformPendingComponent('rotate');
    render();
    return;
  }
  if (editor.pendingPlace && editor.pendingPlace.kind === 'component' && (key === 'R' || shiftKey && key.toLowerCase() === 'r')) {
    transformPendingComponent('mirrorX');
    render();
    return;
  }

  // Escape peels one layer at a time: the mirror axis first, so a new one can
  // be started without losing the ghost, then the ghost, then insert mode.
  if (editor.symmetry && key === 'Escape') {
    clearSymmetry();
    logLine('symmetry axis cleared');
    render();
    return;
  }

  // A placement ghost is pending: Enter/click commits it; Esc drops it back to
  // the search picker so a different component can be typed.
  if (editor.pendingPlace) {
    if (key === 'Enter') {
      commit(() => placePending());
      render();
    } else if (key === 'Escape' || key === 'Backspace') {
      editor.pendingPlace = null;
      clearSymmetry();
      editor.insertQuery = '';
      render();
    }
    return;
  }

  // Fuzzy search picker (no ghost): Enter or Tab selects the best match.
  if (key === 'Enter' || key === 'Tab') {
    if (selectInsertMatch()) render();
    return;
  }
  if (key === 'Escape') {
    editor.mode = 'normal';
    editor.insertQuery = '';
    insertNav = { query: '', index: 0 };
    render();
    return;
  }
  if (key === 'Backspace') {
    editor.insertQuery = editor.insertQuery.slice(0, -1);
    render();
    return;
  }
  if (key.length === 1) {
    editor.insertQuery += key;
    render();
    return;
  }
}

// A dropdown listing every placable component, shown in insert mode until a
// ghost is armed. It is anchored where insert mode opened rather than dragged
// along by the pointer, so the mouse can reach it: hovering highlights an
// entry and clicking arms it, exactly like the keyboard highlight and Enter.
let insertMenu = null;

let insertMenuAnchor = null; // world point the menu hangs from

// The types most recently placed, newest first. It is session state, never
// persisted and never part of a document: it follows what is being drawn right
// now, so reopening a file does not inherit someone else's shortcuts.
let insertRecentTypes = [];

/** Record one committed placement at the head of the Recent group. */
export function rememberInsertType(type) {
  insertRecentTypes = withRecentType(insertRecentTypes, type, INSERT_RECENT_LIMIT);
}

// Every registered symbol type appears in the menu automatically; the list is
// fuzzy-filtered by the live `insertQuery` while typing.
function insertMenuEntries() {
  return insertMenuGroups().flatMap((group) => group.entries);
}

function insertMenuGroups() {
  const availableTypes = INSERT_COMPONENT_TYPES;
  const groups = INSERT_CATEGORY_RULES.map(([title, rule]) => ({
    title,
    entries: availableTypes.filter((type) => rule.test(type)),
  }));
  groups.push({ title: 'Annotations', entries: ['solder', 'label'] });
  if (!editor.insertQuery) {
    const placeable = new Set(groups.flatMap((group) => group.entries));
    const recent = insertRecentTypes.filter((type) => placeable.has(type));
    // The recents repeat their category entry rather than being moved out of
    // it, so the list below stays the complete, stable index it is browsed as.
    const listed = recent.length ? [{ title: 'Recent', entries: recent }, ...groups] : groups;
    return listed.filter((group) => group.entries.length);
  }
  for (const group of groups) {
    group.entries = group.entries
      .map((type) => [type, placementSearchScore(editor.insertQuery, type)])
      .filter(([, score]) => score >= 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([type]) => type);
  }
  const filtered = groups.filter((group) => group.entries.length);
  return filtered.sort((a, b) => (
    placementSearchScore(editor.insertQuery, b.entries[0]) - placementSearchScore(editor.insertQuery, a.entries[0])
  ));
}

const symbolPreviewCache = new Map();

/** Small cached drawing of a placeable type for the insert menu. */
function symbolPreviewSvg(type) {
  if (symbolPreviewCache.has(type)) return symbolPreviewCache.get(type);
  let svg = '';
  if (type === 'label') {
    svg = '<svg viewBox="0 0 24 24"><path d="M5 5h14M12 5v14M8 19h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  } else if (type === 'block') {
    svg = '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="1" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
  } else {
    try {
      const preview = new Circuit();
      preview.addComponent(type, { x: 0, y: 0, noLabel: true });
      const b = preview.bounds(6);
      svg = svgString(preview, { grid: false, terminals: false, junctions: false, background: false, themeInk: true })
        .replace(/viewBox="[^"]*"/, `viewBox="${b.x} ${b.y} ${b.w} ${b.h}" preserveAspectRatio="xMidYMid meet"`);
    } catch { svg = ''; }
  }
  symbolPreviewCache.set(type, svg);
  return svg;
}

export function updateInsertMenu() {
  // The picker only needs to be visible when insert mode has no ghost selected;
  // once a placement (component/label) is pending it would just be in the way.
  if (editor.mode !== 'insert' || editor.pendingPlace) {
    if (insertMenu) insertMenu.remove();
    insertMenu = null;
    return;
  }
  if (!insertMenu) {
    insertNav = { query: '', index: 0 };
    insertMenuAnchor = { ...editor.cursor };
    insertMenu = document.createElement('div');
    insertMenu.id = 'insert-menu';
    insertMenu.className = 'insert-menu';
    document.body.appendChild(insertMenu);
  }
  // Rebuild the entries every render so the live query filter is reflected.
  insertMenu.textContent = '';
  const query = document.createElement('div');
  query.className = 'insert-menu-query';
  query.textContent = editor.insertQuery ? `~ ${editor.insertQuery}` : 'type to filter…';
  insertMenu.appendChild(query);
  const groups = insertMenuGroups();
  insertMenu._entries = groups.flatMap((group) => group.entries);
  if (!insertMenu._entries.length) {
    const none = document.createElement('div');
    none.className = 'insert-menu-none';
    none.textContent = 'no match';
    insertMenu.appendChild(none);
  }
  const highlight = insertHighlightIndex(insertMenu._entries);
  const body = document.createElement('div');
  body.className = 'insert-menu-body';
  insertMenu.appendChild(body);
  const items = [];
  for (const group of groups) {
    const section = document.createElement('div');
    section.className = 'insert-menu-group';
    const heading = document.createElement('div');
    heading.className = 'insert-menu-category';
    heading.textContent = group.title;
    section.appendChild(heading);
    for (const type of group.entries) {
      const index = items.length;
      const item = document.createElement('div');
      item.className = `insert-menu-item${index === highlight ? ' active' : ''}`;
      const preview = document.createElement('span');
      preview.className = 'insert-menu-preview';
      preview.innerHTML = symbolPreviewSvg(type);
      const name = document.createElement('span');
      name.textContent = PLACEMENT_LABELS[type] || type;
      const hint = document.createElement('kbd');
      hint.textContent = 'Enter';
      item.append(preview, name, hint);
      // Hovering moves the same highlight the arrow keys move, in place: a
      // rebuild under the pointer would restart hover on every mouse move.
      item.addEventListener('mousemove', () => {
        if (insertNav.query === editor.insertQuery && insertNav.index === index) return;
        insertNav = { query: editor.insertQuery, index };
        for (const [i, el] of items.entries()) el.classList.toggle('active', i === index);
      });
      item.addEventListener('mousedown', (ev) => {
        ev.preventDefault(); // keep the canvas focused so keys still reach the editor
        if (!pickInsertType(type)) return;
        render();
      });
      items.push(item);
      section.appendChild(item);
    }
    body.appendChild(section);
  }
  insertMenu.style.display = 'block';
  // The body is one scrolling column, so most of the list is out of sight:
  // the highlight scrolls itself into view to stay reachable by keyboard.
  items[highlight]?.scrollIntoView({ block: 'nearest' });

  const p = worldToClient(insertMenuAnchor?.x ?? editor.cursor.x, insertMenuAnchor?.y ?? editor.cursor.y);
  const rect = insertMenu.getBoundingClientRect();
  let left = p.x + 14;
  let top = p.y - rect.height / 2;
  if (left + rect.width > window.innerWidth - 8) left = p.x - rect.width - 14;
  left = Math.max(8, Math.min(left, window.innerWidth - rect.width - 8));
  top = Math.max(8, Math.min(window.innerHeight - rect.height - 8, top));
  insertMenu.style.left = `${left}px`;
  insertMenu.style.top = `${top}px`;
}

// Dropping a pin-drag wire in empty space offers the parts that usually end a
// wire there. The chosen part is placed so one of its pins lands exactly on the
// drop point, turned so its body continues the wire, and wired in the same
// undo entry. Typing filters every placeable type.
const QUICK_ADD_DEFAULTS = ['ground', 'supply', 'input', 'output', 'port', 'resistor', 'capacitor', 'nmos', 'pmos', 'current_source'];

const QUICK_ADD_SPECIAL = {
  '@netlabel': { label: 'Net label', icon: 'tag', words: ['net', 'label', 'name'] },
  '@open': { label: 'Leave an open end', icon: 'wire', words: ['open', 'end', 'wire', 'leave'] },
};

function quickAddEntries(query) {
  const specials = editor.quickAdd?.fromWire ? Object.keys(QUICK_ADD_SPECIAL) : [];
  if (!query) return [...QUICK_ADD_DEFAULTS.filter((type) => symbolTypeNames.includes(type)), ...specials];
  const scored = INSERT_COMPONENT_TYPES
    .filter((type) => type !== 'solder')
    .map((type) => [type, placementSearchScore(query, type)])
    .filter(([, score]) => score >= 0);
  for (const key of specials) {
    const score = Math.max(...[QUICK_ADD_SPECIAL[key].label, ...QUICK_ADD_SPECIAL[key].words].map((word) => fuzzyScore(query, word)));
    if (score >= 0) scored.push([key, score]);
  }
  return scored.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10).map(([type]) => type);
}

export function openQuickAdd({ clientX, clientY, point, fromWire = false }) {
  closeQuickAdd({ cancel: false });
  const el = document.createElement('div');
  el.className = 'quick-add glass';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Add a part at the wire end');
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'quick-add-input';
  input.placeholder = 'Add part…';
  input.setAttribute('aria-label', 'Filter parts');
  input.autocomplete = 'off';
  input.spellcheck = false;
  const list = document.createElement('div');
  list.className = 'quick-add-list';
  list.setAttribute('role', 'listbox');
  el.append(input, list);
  document.body.appendChild(el);
  editor.quickAdd = { point, fromWire, query: '', index: 0, el, input, list };
  renderQuickAdd();
  const rect = el.getBoundingClientRect();
  const left = Math.max(8, Math.min(clientX + 12, window.innerWidth - rect.width - 8));
  const top = Math.max(8, Math.min(clientY - 18, window.innerHeight - rect.height - 8));
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  input.addEventListener('input', () => {
    editor.quickAdd.query = input.value.trim();
    editor.quickAdd.index = 0;
    renderQuickAdd();
  });
  input.addEventListener('keydown', (ev) => {
    const entries = quickAddEntries(editor.quickAdd.query);
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      const step = ev.key === 'ArrowDown' ? 1 : -1;
      editor.quickAdd.index = (editor.quickAdd.index + step + entries.length) % Math.max(1, entries.length);
      renderQuickAdd();
    } else if (ev.key === 'Enter' || ev.key === 'Tab') {
      ev.preventDefault();
      if (entries[editor.quickAdd.index]) pickQuickAdd(entries[editor.quickAdd.index]);
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      closeQuickAdd();
    }
  });
  input.focus();
}

function renderQuickAdd() {
  if (!editor.quickAdd) return;
  const entries = quickAddEntries(editor.quickAdd.query);
  editor.quickAdd.index = Math.min(editor.quickAdd.index, Math.max(0, entries.length - 1));
  editor.quickAdd.list.replaceChildren();
  if (!entries.length) {
    const none = document.createElement('div');
    none.className = 'quick-add-none';
    none.textContent = 'no match';
    editor.quickAdd.list.appendChild(none);
  }
  entries.forEach((type, index) => {
    const item = document.createElement('div');
    item.className = `quick-add-item${index === editor.quickAdd.index ? ' active' : ''}`;
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(index === editor.quickAdd.index));
    const preview = document.createElement('span');
    preview.className = 'quick-add-preview';
    const special = QUICK_ADD_SPECIAL[type];
    preview.innerHTML = special
      ? `<svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true">${ICON_PATHS[special.icon]}</svg>`
      : symbolPreviewSvg(type);
    const name = document.createElement('span');
    name.textContent = special ? special.label : (PLACEMENT_LABELS[type] || type);
    item.append(preview, name);
    item.addEventListener('mousemove', () => {
      if (editor.quickAdd.index === index) return;
      editor.quickAdd.index = index;
      for (const [i, el] of [...editor.quickAdd.list.children].entries()) el.classList.toggle('active', i === index);
    });
    item.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      pickQuickAdd(type);
    });
    editor.quickAdd.list.appendChild(item);
  });
  editor.quickAdd.list.children[editor.quickAdd.index]?.scrollIntoView?.({ block: 'nearest' });
}

export function closeQuickAdd({ cancel = true } = {}) {
  if (!editor.quickAdd) return;
  editor.quickAdd.el.remove();
  editor.quickAdd = null;
  if (cancel) {
    endGestureWire();
    render();
  }
  canvasEl.focus({ preventScroll: true });
}

function pickQuickAdd(type) {
  if (!editor.quickAdd) return;
  const { point, fromWire } = editor.quickAdd;
  closeQuickAdd({ cancel: false });
  editor.cursor = { ...point };
  if (type === '@open' || type === '@netlabel') {
    if (editor.wire?.source) commitWireAtCursor();
    endGestureWire();
    if (type === '@netlabel') placeNetLabelAt(point);
    render();
    return;
  }
  const def = getSymbol(type);
  const direction = fromWire && editor.wire?.source ? arrivalDirection(draftRoutePath(editor.wire, point)) : null;
  const sourceComp = fromWire && editor.wire?.source?.refdes ? editor.circuit.components.get(editor.wire.source.refdes) : null;
  const source = sourceComp ? { ...sourceComp.transform, defaultMirrorX: !!sourceComp.def?.defaultMirrorX, defaultMirrorY: !!sourceComp.def?.defaultMirrorY } : null;
  const placement = quickAddPlacement(def, point, direction, source);
  const before = snapshot();
  try {
    const comp = editor.circuit.addComponent(type, {
      x: placement.x, y: placement.y, rotation: placement.rotation,
      mirrorX: placement.mirrorX, mirrorY: placement.mirrorY, noLabel: false,
    });
    markModelChanged();
    if (fromWire && editor.wire?.source && placement.terminal) {
      connectWireToTerminal({ refdes: comp.refdes, term: placement.terminal, x: point.x, y: point.y }, before);
    } else {
      editor.circuit.connectCoincident(comp.refdes);
      recordHistoryEntry(before, true);
    }
    rememberInsertType(type);
    logLine(`placed ${comp.refdes} (${type}) at the wire end`);
  } catch (err) {
    applyJson(before);
    logLine(`Could not add ${PLACEMENT_LABELS[type] || type}: ${err.message || err}`, 'error');
  }
  endGestureWire();
  render();
}
