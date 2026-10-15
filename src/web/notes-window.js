/**
 * The notes window: a design's notes (`Circuit#notes`, core/notes.js) shown
 * rendered (core/notes-markdown.js) and edited as Markdown source. `n` (or
 * the toolbar's Notes) shows or hides it; Edit, a double-click, or Enter
 * on the rendered notes opens the source, and Esc or Ctrl/Cmd+Enter
 * finishes; there Tab and Shift+Tab indent and unindent lines (lists nest
 * by indentation). The notes are document data that never go stale: typing marks
 * the design unsaved (`markSettingsChanged`), and each finished edit -- a
 * pause or leaving the field -- is one undo step.
 *
 * A mention (`@M1`, `@V_{out}`) glows its part or net on the canvas while
 * the pointer is over it and selects it on a click; a `[[design]]` link
 * opens that design.
 */

import { normalizeNotes, resolveMention } from '../core/notes.js';
import { renderNotes } from '../core/notes-markdown.js';
import { canvasEl } from './elements.js';
import { editor } from './editor-state.js';
import { floatingWindow } from './floating-window.js';
import { setHoverTarget } from './hover-preview.js';
import { workspaceDesigns } from './hierarchy.js';
import { openDocumentPath } from './document-session.js';
import { logLine } from './status-bar-ui.js';
import { beginSettingsEdit, endSettingsEdit, markSettingsChanged, render, setSelection } from './main.js';
import { element as el } from './dom.js';

/** A pause this long ends one edit (one undo step). */
const EDIT_PAUSE_MS = 1000;

let win = null; // { el, view, source, edit, empty, chrome }
let editing = false;
let pauseTimer = null;
let shownKey = null; // what the rendered view was drawn from

const notes = () => editor.circuit.notes || '';

function designNamed(name) {
  const key = String(name).trim().toLowerCase();
  return workspaceDesigns().find((doc) => doc.name.toLowerCase() === key) || null;
}

function mentionTarget(name) {
  return resolveMention(editor.circuit, name);
}

/** Draw the rendered notes again when they, or what they mention, changed. */
function renderView() {
  if (!win) return;
  const key = { text: notes(), circuit: editor.circuit, revision: editor.modelRevision, designs: workspaceDesigns().length };
  if (shownKey && Object.keys(key).every((field) => shownKey[field] === key[field])) return;
  shownKey = key;
  const html = renderNotes(key.text, {
    mention: mentionTarget,
    design: (name) => !!designNamed(name) || name.toLowerCase() === String(editor.currentCircuitName || '').toLowerCase(),
  });
  win.view.innerHTML = html;
  win.empty.hidden = !!key.text;
  win.view.hidden = !key.text;
}

/** The window follows the document: undo, redo, another design, a script. */
export function renderNotesWindow() {
  if (!win || win.el.hidden) return;
  if (editing) {
    // Changed under the field (an undo, a rename's rewritten mention): take it.
    if (normalizeNotes(win.source.value) !== notes()) win.source.value = notes();
    return;
  }
  renderView();
}

// ----- editing --------------------------------------------------------------------

function finishEditStep() {
  clearTimeout(pauseTimer);
  pauseTimer = null;
  endSettingsEdit();
}

function onInput() {
  beginSettingsEdit();
  const next = normalizeNotes(win.source.value);
  if (next !== notes()) {
    editor.circuit.notes = next;
    markSettingsChanged();
  }
  clearTimeout(pauseTimer);
  pauseTimer = setTimeout(finishEditStep, EDIT_PAUSE_MS);
}

function startEditing() {
  if (!win) return;
  editing = true;
  win.el.classList.add('editing');
  win.source.hidden = false;
  win.view.hidden = true;
  win.empty.hidden = true;
  win.edit.textContent = 'Done';
  win.edit.title = 'Show the notes rendered (Esc or Ctrl/Cmd+Enter)';
  win.source.value = notes();
  win.source.focus();
}

function stopEditing({ focusCanvas = false } = {}) {
  if (!win || !editing) return;
  finishEditStep();
  editing = false;
  win.el.classList.remove('editing');
  win.source.hidden = true;
  win.edit.textContent = 'Edit';
  win.edit.title = 'Edit the notes as Markdown (double-click them)';
  shownKey = null;
  renderView();
  if (focusCanvas) canvasEl.focus({ preventScroll: true });
}

/** Tab indents the lines the caret or selection is on by two spaces (a
 *  list item becomes a sublist item); Shift+Tab takes up to two away. */
function indentLines(field, outdent) {
  const { value } = field;
  const start = value.lastIndexOf('\n', field.selectionStart - 1) + 1;
  let end = value.indexOf('\n', Math.max(field.selectionStart, field.selectionEnd - (field.selectionEnd > field.selectionStart ? 1 : 0)));
  if (end < 0) end = value.length;
  const lines = value.slice(start, end).split('\n');
  const changed = lines.map((line) => (outdent ? line.replace(/^ {1,2}|^\t/, '') : `  ${line}`));
  const text = changed.join('\n');
  if (text === value.slice(start, end)) return;
  const caret = field.selectionStart;
  const shift = changed[0].length - lines[0].length;
  const single = field.selectionStart === field.selectionEnd && lines.length === 1;
  field.focus();
  field.setSelectionRange(start, end);
  // insertText keeps the field's own undo (Ctrl+Z) working.
  if (!document.execCommand?.('insertText', false, text)) {
    field.setRangeText(text, start, end, 'end');
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }
  if (single) {
    const at = Math.max(start, caret + shift);
    field.setSelectionRange(at, at);
  } else field.setSelectionRange(start, start + text.length);
}

function onSourceKey(ev) {
  if (ev.key === 'Tab' && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
    ev.preventDefault();
    indentLines(win.source, ev.shiftKey);
    return;
  }
  if (ev.key === 'Escape' || (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey))) {
    ev.preventDefault();
    ev.stopPropagation();
    stopEditing({ focusCanvas: ev.key === 'Escape' });
    if (ev.key !== 'Escape') win.view.focus();
  }
}

// ----- mentions and links -----------------------------------------------------------

function mentionAt(target) {
  return target?.closest?.('.note-mention');
}

function onViewOver(ev) {
  const mention = mentionAt(ev.target);
  if (!mention) return;
  const found = mentionTarget(mention.dataset.mention);
  if (found?.kind === 'component') setHoverTarget({ kind: 'component', refdes: found.refdes }, true);
  else if (found?.kind === 'net') setHoverTarget({ kind: 'net', ids: found.ids }, true);
}

function onViewOut(ev) {
  if (mentionAt(ev.target) && !mentionAt(ev.relatedTarget) && editor.hoverFromPanel) setHoverTarget(null);
}

function onViewClick(ev) {
  const mention = mentionAt(ev.target);
  const design = ev.target?.closest?.('.note-design');
  if (!mention && !design) return;
  ev.preventDefault();
  if (design) {
    const name = design.dataset.design;
    const doc = designNamed(name);
    if (!doc) logLine(`No design named "${name}" in the workspace.`, 'error');
    else if (doc.path !== editor.currentDocumentPath) void openDocumentPath(doc.path);
    return;
  }
  const found = mentionTarget(mention.dataset.mention);
  if (!found) {
    logLine(`Nothing named "${mention.dataset.mention}" in this design.`, 'error');
    return;
  }
  if (found.kind === 'component') {
    setSelection([found.refdes]);
    const part = editor.circuit.components.get(found.refdes);
    if (part) editor.cursor = { x: part.transform.x, y: part.transform.y };
  } else {
    setSelection([]);
    editor.selectedNets = new Set(found.ids);
  }
  render();
}

// ----- the window --------------------------------------------------------------------

function build() {
  const close = el('button', { type: 'button', class: 'floating-window-close', 'aria-label': 'Close the notes', title: 'Close (n)', text: '×' });
  const edit = el('button', { type: 'button', class: 'notes-edit', title: 'Edit the notes as Markdown (double-click them)', text: 'Edit' });
  const view = el('div', { class: 'notes-view', tabindex: '0', 'aria-label': 'Notes' });
  const empty = el('p', { class: 'field-hint notes-empty', text: 'Notes about this design: why it is drawn so, what to check. Markdown with $math$; @M1 or @V_{out} mentions a part or net, [[amp]] links another design. Double-click to write.' });
  const source = el('textarea', { class: 'notes-source', 'aria-label': 'Notes (Markdown)', spellcheck: 'true', hidden: true, placeholder: '# Bias\nM1 sets the tail current: see @M1, [[bias-gen]], $I_D = \\frac{1}{2}\\mu C_{ox} V_{ov}^2$' });
  const node = el('section', { class: 'floating-window notes-window', 'aria-labelledby': 'notes-title', hidden: true }, [
    el('header', { class: 'floating-window-header' }, [el('h2', { id: 'notes-title', class: 'floating-window-title', text: 'Notes' }), edit, close]),
    el('div', { class: 'notes-body' }, [empty, view, source]),
  ]);
  edit.addEventListener('click', () => (editing ? stopEditing() : startEditing()));
  source.addEventListener('input', onInput);
  source.addEventListener('keydown', onSourceKey);
  source.addEventListener('blur', finishEditStep);
  view.addEventListener('mouseover', onViewOver);
  view.addEventListener('mouseout', onViewOut);
  view.addEventListener('click', onViewClick);
  view.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && ev.target === view) { ev.preventDefault(); startEditing(); }
  });
  const body = node.querySelector('.notes-body');
  body.addEventListener('dblclick', (ev) => {
    if (!editing && !ev.target.closest('a')) startEditing();
  });
  canvasEl.closest('.canvas-pane').append(node);
  const chrome = floatingWindow(node, { key: 'notes', onClose: hide, resizable: true });
  win = { el: node, view, source, edit, empty, chrome };
}

function syncButton() {
  document.getElementById('btn-window-notes')?.setAttribute('aria-pressed', String(notesShown()));
}

export function notesShown() {
  return !!win && !win.el.hidden;
}

function show() {
  if (!win) build();
  win.el.hidden = false;
  shownKey = null;
  renderView();
  win.chrome.place();
  // An empty design's notes open ready to write.
  if (!notes()) startEditing();
  syncButton();
}

function hide() {
  if (!win || win.el.hidden) return;
  stopEditing();
  if (editor.hoverFromPanel) setHoverTarget(null);
  win.el.hidden = true;
  syncButton();
  canvasEl.focus({ preventScroll: true });
}

/** `n`: show or hide the notes. */
export function toggleNotes() {
  if (notesShown()) hide();
  else show();
}

export function installNotes() {
  document.getElementById('btn-window-notes')?.addEventListener('click', toggleNotes);
}

/** Another design shown: its own notes, not mid-edit in the last one's. */
export function notesDocumentShown() {
  if (!win) return;
  if (editing) {
    clearTimeout(pauseTimer);
    pauseTimer = null;
    editing = false;
    win.el.classList.remove('editing');
    win.source.hidden = true;
    win.edit.textContent = 'Edit';
  }
  shownKey = null;
  renderNotesWindow();
}
