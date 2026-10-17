/**
 * The history window: the open design's save points and checkpoints, kept
 * in its file (core/save-history.js). Every Save adds a save point (the
 * last ten are kept); a pinned one is a named checkpoint that is never
 * rotated out. Each can be viewed in a reference window, restored into the
 * drawing (one undo step; saving keeps it), or started afresh as a new
 * design; save points and checkpoints are removed with their ×.
 *
 * The history is the file's, read from it whenever the window shows it,
 * and every change to it is written at once -- pinning or removing never
 * makes the design unsaved, and leaves unsaved drawing edits as they are.
 * More → History…, or `:history`, shows or hides it.
 */

import {
  checkpointHistory, historyEntries, historyEntryState, historyText, pinHistoryEntry, removeHistoryEntry, textHash, unpinHistoryEntry,
} from '../core/save-history.js';
import { canvasEl } from './elements.js';
import { editor } from './editor-state.js';
import { floatingWindow } from './floating-window.js';
import { confirmChoice } from './file-dialog.js';
import { formatModifiedTime } from './modified-time.js';
import { appendContextItem, openMenuAt } from './context-menu.js';
import { hasUnsavedChanges, openStateAsNewDesign, persistence, saveCircuit } from './document-session.js';
import { showStateInReference } from './reference-window.js';
import { logLine } from './status-bar-ui.js';
import { applyJson, recordHistoryEntry, render, snapshot } from './main.js';
import { element as el } from './dom.js';

let win = null; // { el, list, message, checkpoint, chrome }
let file = null; // { path, state, base, entries } as last read
let readKey = null; // what the list was read for
let form = null; // the open pin form: { id | null (the file's drawing) }
let busy = false;

const label = (entry) => entry.name || 'Saved';
const when = (entry) => {
  const time = Date.parse(entry.time);
  return Number.isFinite(time) ? formatModifiedTime(time) : '';
};
const exactTime = (entry) => {
  const time = Date.parse(entry.time);
  return Number.isFinite(time) ? new Date(time).toLocaleString() : '';
};

// ----- reading and writing the file's history ----------------------------------------------

/** Read the open design's file and list its history. */
async function refresh() {
  if (!win || win.el.hidden) return;
  const path = editor.currentDocumentPath;
  readKey = { path, revision: editor.lastSeenRevision };
  if (!path) {
    file = null;
    renderList();
    return;
  }
  try {
    const data = await persistence.load(path);
    if (path !== editor.currentDocumentPath) return;
    const base = historyText(data.state);
    file = { path, state: data.state, base, entries: historyEntries(data.state.history, base) };
  } catch (err) {
    file = { path, error: err.message };
  }
  renderList();
}

/** Write `history` into the file in place of the one there. */
async function writeHistory(history, done) {
  if (!file?.state || busy) return false;
  const { path, state, base } = file;
  busy = true;
  try {
    editor.syncGeneration += 1;
    const data = await persistence.save({ path }, { ...state, history }, { overwrite: true, historyBase: base });
    if (path === editor.currentDocumentPath) {
      // The open design carries the file's history from now on.
      editor.circuit.history = data.history ?? data.state?.history ?? history;
      editor.lastSeenRevision = data.revision || editor.lastSeenRevision;
      editor.lastCircuitTag = data.etag || editor.lastCircuitTag;
    }
    if (done) logLine(done);
    return true;
  } catch (err) {
    logLine(`Could not change the history: ${err.message}`, 'error');
    return false;
  } finally {
    busy = false;
    editor.syncGeneration += 1;
    await refresh();
  }
}

// ----- actions ---------------------------------------------------------------------

function entryNamed(id) {
  return file?.entries?.find((entry) => entry.id === id) || null;
}

function titleOf(entry) {
  return `${editor.currentCircuitName || 'design'} @ ${entry.name || when(entry)}`;
}

function view(entry) {
  showStateInReference(titleOf(entry), historyEntryState(entry));
}

/** The drawing as it was at `entry`: one undo step, unsaved until saved. */
function restore(entry) {
  const state = historyEntryState(entry);
  const current = editor.circuit;
  const restored = {
    ...state,
    // Not the drawing: the design's own, as they are now.
    ...(current.tags.length ? { tags: [...current.tags] } : {}),
    ...(current.savedNames.length ? { names: [...current.savedNames] } : {}),
  };
  const before = snapshot();
  applyJson(JSON.stringify(restored));
  if (snapshot() === before) {
    logLine('The drawing is already as it was then.');
    return;
  }
  recordHistoryEntry(before, true, 'none');
  render();
  logLine(`Restored "${label(entry)}" from ${when(entry)}. Undo (u) takes it back; Save keeps it.`);
}

async function startNewDesign(entry) {
  const stem = editor.currentCircuitName || 'design';
  const tail = (entry.name || entry.time.slice(0, 10)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const name = `${stem}-${tail || 'copy'}`.slice(0, 100);
  await openStateAsNewDesign(historyEntryState(entry), name, `A new design from "${label(entry)}" of ${stem}. Save (Ctrl/Cmd+S) to keep it.`);
}

async function remove(entry) {
  if (entry.pinned && !await confirmChoice({
    title: 'Remove this checkpoint?',
    message: `"${label(entry)}" (${exactTime(entry)}) is taken out of the design's history for good.`,
    confirmLabel: 'Remove',
    danger: true,
  })) return;
  const history = removeHistoryEntry(file.state.history, file.base, entry.id);
  if (history) await writeHistory(history, entry.pinned ? `Removed the checkpoint "${label(entry)}".` : 'Removed the save point.');
}

async function removeSavePoints() {
  const points = file?.entries?.filter((entry) => !entry.pinned) || [];
  if (!points.length) return;
  let history = file.state.history;
  for (const entry of points) history = removeHistoryEntry(history, file.base, entry.id);
  if (history) await writeHistory(history, `Removed ${points.length} save point${points.length === 1 ? '' : 's'}; the checkpoints stay.`);
}

/** An unreadable history out of the file, after asking: the next Save starts a new one. */
async function startAfresh() {
  if (!await confirmChoice({
    title: 'Remove the unreadable history?',
    message: 'Its save points and checkpoints cannot be read against this drawing. The next Save starts a new history.',
    confirmLabel: 'Remove',
    danger: true,
  })) return;
  await writeHistory({ base: textHash(file.base), entries: [] }, 'Removed the unreadable history.');
}

async function unpin(entry) {
  const history = unpinHistoryEntry(file.state.history, file.base, entry.id);
  if (history) await writeHistory(history, `"${label(entry)}" is a save point again.`);
}

/** Pin entry `id` (or, with null, the file's drawing) with the form's name. */
async function submitPin(id, name, comment) {
  form = null;
  if (id) {
    const history = pinHistoryEntry(file.state.history, file.base, id, { name, comment });
    if (history) await writeHistory(history, `Pinned "${name || 'checkpoint'}".`);
    return;
  }
  // The drawing as it is: saved first when it has unsaved changes.
  if (hasUnsavedChanges() && !await saveCircuit()) return;
  await refresh();
  if (!file?.state || !file.entries) return;
  const { history } = checkpointHistory(file.state.history, file.base, { name, comment });
  if (history) await writeHistory(history, `Checkpoint "${name || 'checkpoint'}" pinned.`);
}

function openMenu(entry, ev) {
  const rect = ev.currentTarget.getBoundingClientRect();
  const menu = openMenuAt(rect.left, rect.bottom + 4, label(entry));
  if (!menu) return;
  if (entry.pinned) {
    appendContextItem(menu, 'Rename checkpoint…', () => { form = { id: entry.id }; renderList(); });
    appendContextItem(menu, 'Unpin (a save point again)', () => void unpin(entry));
  } else {
    appendContextItem(menu, 'Pin as checkpoint…', () => { form = { id: entry.id }; renderList(); });
  }
  appendContextItem(menu, 'New design from this', () => void startNewDesign(entry));
  appendContextItem(menu, entry.pinned ? 'Remove checkpoint…' : 'Remove save point', () => void remove(entry), { danger: true });
}

// ----- the list ---------------------------------------------------------------------

function pinForm(entry) {
  const name = el('input', { type: 'text', class: 'history-name', 'aria-label': 'Checkpoint name', placeholder: 'Name, e.g. before cascoding', value: entry?.name || '' });
  const comment = el('input', { type: 'text', class: 'history-comment', 'aria-label': 'Comment', placeholder: 'Comment (optional)', value: entry?.comment || '' });
  const pin = el('button', { type: 'submit', class: 'primary-action', text: entry?.pinned ? 'Rename' : 'Pin' });
  const cancel = el('button', { type: 'button', text: 'Cancel', onclick: () => { form = null; renderList(); } });
  const node = el('form', { class: 'history-form' }, [name, comment, el('div', { class: 'history-form-actions' }, [cancel, pin])]);
  node.addEventListener('submit', (ev) => {
    ev.preventDefault();
    void submitPin(entry?.id ?? null, name.value.trim(), comment.value.trim());
  });
  node.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Escape') { ev.preventDefault(); form = null; renderList(); }
  });
  queueMicrotask(() => name.focus());
  return node;
}

function row(entry) {
  const current = entry.text === file.base;
  const heading = el('div', { class: 'history-heading' }, [
    el('span', { class: `history-label${entry.pinned ? ' pinned' : ''}`, text: label(entry) }),
    el('span', { class: 'history-time', text: when(entry), title: exactTime(entry) }),
    ...(current ? [el('span', { class: 'history-current', text: 'the file', title: 'The file holds this drawing now' })] : []),
  ]);
  const actions = el('div', { class: 'history-actions' }, [
    el('button', { type: 'button', text: 'View', title: 'Show it in a reference window', onclick: () => view(entry) }),
    el('button', { type: 'button', text: 'Restore', title: 'Restore', onclick: () => restore(entry) }),
    el('button', { type: 'button', class: 'history-more', text: '⋯', 'aria-label': 'More', title: 'More', onclick: (ev) => openMenu(entry, ev) }),
    el('button', { type: 'button', class: 'history-remove', text: '×', 'aria-label': entry.pinned ? 'Remove checkpoint' : 'Remove save point', title: entry.pinned ? 'Remove this checkpoint' : 'Remove this save point', onclick: () => void remove(entry) }),
  ]);
  const item = el('li', { class: `history-entry${entry.pinned ? ' pinned' : ''}` }, [
    heading,
    ...(entry.comment ? [el('p', { class: 'history-entry-comment', text: entry.comment })] : []),
    form?.id === entry.id ? pinForm(entry) : actions,
  ]);
  item.dataset.id = entry.id;
  return item;
}

function renderList() {
  if (!win) return;
  const message = (text) => {
    win.message.textContent = text;
    win.message.hidden = !text;
  };
  win.checkpoint.disabled = !file?.state || !file.entries;
  win.clear.hidden = !(file?.entries?.some((entry) => !entry.pinned));
  win.top.replaceChildren(...(form && form.id === null ? [pinForm(null)] : []));
  if (!file) {
    win.list.replaceChildren();
    message('Save the design to start its history: every save is kept (the last ten), and any of them can be pinned as a named checkpoint that stays.');
    return;
  }
  if (file.error) {
    win.list.replaceChildren();
    message(`Could not read the history: ${file.error}`);
    return;
  }
  if (!file.entries) {
    message('This file\'s history does not fit its drawing (was the file edited outside Mosfeteer?), so it cannot be read. It stays in the file until you remove it.');
    win.list.replaceChildren(el('li', {}, [el('button', { type: 'button', class: 'history-afresh', text: 'Remove it and start afresh', onclick: () => void startAfresh() })]));
    return;
  }
  message(file.entries.length ? '' : 'No save points yet: the next Save is the first.');
  const pinned = file.entries.filter((entry) => entry.pinned);
  const points = file.entries.filter((entry) => !entry.pinned);
  win.list.replaceChildren(
    ...(pinned.length ? [el('li', { class: 'history-group', text: 'Checkpoints' }), ...pinned.map(row)] : []),
    ...(points.length ? [el('li', { class: 'history-group', text: 'Save points' }), ...points.map(row)] : []),
  );
}

/** The list follows the file: a save, another window's checkpoint. */
export function renderHistoryWindow() {
  if (!win || win.el.hidden || busy) return;
  if (readKey && readKey.path === editor.currentDocumentPath && readKey.revision === editor.lastSeenRevision) return;
  void refresh();
}

function build() {
  const close = el('button', { type: 'button', class: 'floating-window-close', 'aria-label': 'Close the history', title: 'Close', text: '×' });
  const checkpoint = el('button', { type: 'button', class: 'history-checkpoint', title: 'Pin as a checkpoint', text: 'Checkpoint…' });
  const clear = el('button', { type: 'button', class: 'history-clear', title: 'Remove save points', text: 'Remove save points', hidden: true });
  const top = el('div', { class: 'history-top' });
  const message = el('p', { class: 'field-hint history-message' });
  const list = el('ul', { class: 'history-list' });
  const node = el('section', { class: 'floating-window history-window', 'aria-labelledby': 'history-title', hidden: true }, [
    el('header', { class: 'floating-window-header' }, [el('h2', { id: 'history-title', class: 'floating-window-title', text: 'History' }), checkpoint, close]),
    el('div', { class: 'history-body' }, [top, message, list, clear]),
  ]);
  checkpoint.addEventListener('click', () => { form = { id: null }; renderList(); });
  clear.addEventListener('click', () => void removeSavePoints());
  canvasEl.closest('.canvas-pane').append(node);
  // At the left, so a save point viewed (a reference window, at the right) sits beside it.
  const chrome = floatingWindow(node, { key: 'history', onClose: hide, resizable: true, place: (pane, size) => ({ x: 64, y: 56 }) });
  win = { el: node, list, message, checkpoint, clear, top, chrome };
}

export function historyShown() {
  return !!win && !win.el.hidden;
}

function syncButton() {
  document.getElementById('btn-history')?.setAttribute('aria-checked', String(historyShown()));
}

function show() {
  if (!win) build();
  win.el.hidden = false;
  form = null;
  renderList();
  win.chrome.place();
  void refresh();
  syncButton();
}

function hide() {
  if (!win || win.el.hidden) return;
  win.el.hidden = true;
  form = null;
  syncButton();
  canvasEl.focus({ preventScroll: true });
}

/** More → History…: show or hide the design's history. */
export function toggleHistory() {
  if (historyShown()) hide();
  else show();
}

export function installHistory() {
  document.getElementById('btn-history')?.addEventListener('click', toggleHistory);
}

/** Another design shown: its own history. */
export function historyDocumentShown() {
  form = null;
  readKey = null;
  if (historyShown()) void refresh();
}

