/**
 * The notes window: a design's notes (`Circuit#notes`, core/notes.js) shown
 * rendered (core/notes-markdown.js) and edited as Markdown source. Shift+N (or
 * the toolbar's Notes) shows or hides it; Edit, a double-click, or Enter
 * on the rendered notes opens the source, and Esc or Ctrl/Cmd+Enter
 * finishes; there Tab and Shift+Tab indent and unindent lines (lists nest
 * by indentation). The notes are document data that never go stale: typing marks
 * the design unsaved (`markSettingsChanged`), and each finished edit -- a
 * pause or leaving the field -- is one undo step.
 *
 * A mention (`@M1`, `@V_{out}`) glows its part or net on the canvas while
 * the pointer is over it and selects it on a click; a `[[design]]` link
 * opens that design, and its right-click menu also shows it in a
 * reference window. Copy puts them on the clipboard as plain Markdown
 * (`notesMarkdown`). A figure (`![[circuit]]`) shows as its number and what
 * it draws; Report… exports the notes with their figures (core/report.js).
 */

import { normalizeNotes, notesMarkdown, resolveMention } from '../core/notes.js';
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
import { attachNoteCompletion } from './notes-completion.js';
import { appendContextItem, openMenuAt } from './context-menu.js';
import { showDesignInReference } from './reference-window.js';
import { notesOutline, reportTargets, resolveReportTarget } from '../core/report.js';
import { exportCircuit } from './export-ui.js';

/** A pause this long ends one edit (one undo step). */
const EDIT_PAUSE_MS = 1000;

let win = null; // { el, view, source, edit, copy, empty, chrome }
let editing = false;
let pauseTimer = null;
let shownKey = null; // what the rendered view was drawn from

const notes = () => editor.circuit.notes || '';

function designNamed(name) {
  const key = String(name).trim().toLowerCase();
  return workspaceDesigns().find((doc) => doc.name.toLowerCase() === key) || null;
}

/** What the source completes: the other designs, the parts (not those an
 *  analysis drew), and the named nets. */
function completionNames() {
  const current = String(editor.currentCircuitName || '').toLowerCase();
  const components = [...editor.circuit.components.values()].filter((c) => c.type !== 'solder' && !c.figure);
  return {
    designs: workspaceDesigns().map((doc) => doc.name).filter((name) => name.toLowerCase() !== current),
    parts: components.map((c) => ({ name: c.refdes, type: c.type })),
    nets: [...editor.circuit.nets.values()].map((net) => net.name).filter(Boolean),
    // After `![[`: a figure of this drawing, or another design's notes as a section.
    figures: [
      ...reportTargets(editor.circuit).map(({ name, detail }) => ({ name, detail })),
      ...workspaceDesigns().map((doc) => doc.name).filter((name) => name.toLowerCase() !== current).map((name) => ({ name, detail: 'design, as a section', section: true })),
    ],
  };
}

function mentionTarget(name) {
  return resolveMention(editor.circuit, name);
}

/** Draw the rendered notes again when they, or what they mention, changed. */
function renderView() {
  if (!win) return;
  const key = { text: notes(), circuit: editor.circuit, revision: editor.modelRevision, designs: workspaceDesigns().length };
  win.copy.disabled = !key.text;
  win.outline.hidden = !!key.text;
  if (shownKey && Object.keys(key).every((field) => shownKey[field] === key[field])) return;
  shownKey = key;
  const html = renderNotes(key.text, {
    mention: mentionTarget,
    design: (name) => !!designNamed(name) || name.toLowerCase() === String(editor.currentCircuitName || '').toLowerCase(),
    figure: (name) => resolveReportTarget(editor.circuit, name),
    isDesign: (name) => !resolveReportTarget(editor.circuit, name) && !!designNamed(name),
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
  win.copy.disabled = !next;
  win.outline.hidden = !!next;
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
  win.edit.title = 'Done (Esc)';
  win.source.value = notes();
  win.source.focus();
}

function stopEditing() {
  if (!win || !editing) return;
  finishEditStep();
  editing = false;
  win.el.classList.remove('editing');
  win.source.hidden = true;
  win.edit.textContent = 'Edit';
  win.edit.title = 'Edit (double-click)';
  shownKey = null;
  renderView();
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
    // The notes keep the keyboard, read now (the window itself when they
    // are empty): Esc again closes them.
    stopEditing();
    (win.view.hidden ? win.el : win.view).focus({ preventScroll: true });
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

function openLinkedDesign(name) {
  const doc = designNamed(name);
  if (!doc) logLine(`No design named "${name}" in the workspace.`, 'error');
  else if (doc.path !== editor.currentDocumentPath) void openDocumentPath(doc.path);
}

/** A design link's menu: open the design, or show it in a reference window. */
function onViewContextMenu(ev) {
  const link = ev.target?.closest?.('.note-design');
  if (!link) return;
  ev.preventDefault();
  ev.stopPropagation();
  const name = link.dataset.design;
  const doc = designNamed(name);
  const menu = openMenuAt(ev.clientX, ev.clientY, doc ? name : `${name} · no design of this name`);
  if (!menu) return;
  const group = el('div', { class: 'context-menu-group' });
  const own = doc?.path === editor.currentDocumentPath;
  appendContextItem(group, `Open ${name}`, () => openLinkedDesign(name), { disabled: !doc || own });
  appendContextItem(group, 'Show in a reference window', () => showDesignInReference(doc), { disabled: !doc });
  menu.appendChild(group);
  menu.querySelector('button:not(:disabled)')?.focus();
}

function onViewClick(ev) {
  // A figure's number, a citation, or a contents entry: to what it names.
  const reference = ev.target?.closest?.('.note-figure-ref, .note-cite, .note-toc a');
  if (reference) {
    ev.preventDefault();
    win.view.querySelector(reference.getAttribute('href'))?.scrollIntoView({ block: 'nearest' });
    return;
  }
  const mention = mentionAt(ev.target);
  const design = ev.target?.closest?.('.note-design');
  if (!mention && !design) return;
  ev.preventDefault();
  if (design) {
    openLinkedDesign(design.dataset.design);
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
  const close = el('button', { type: 'button', class: 'floating-window-close', 'aria-label': 'Close the notes', title: 'Close (Shift+N)', text: '×' });
  const edit = el('button', { type: 'button', class: 'notes-edit window-action', title: 'Edit (double-click)', text: 'Edit' });
  const copy = el('button', { type: 'button', class: 'notes-copy window-action', title: 'Copy as Markdown', text: 'Copy' });
  const report = el('button', { type: 'button', class: 'notes-report window-action', title: 'Export the notes and their figures', text: 'Report…' });
  const outline = el('button', { type: 'button', class: 'notes-outline window-action', title: 'Start the notes with every figure of the drawing', text: 'Outline' });
  const view = el('div', { class: 'notes-view', tabindex: '0', 'aria-label': 'Notes' });
  const empty = el('p', { class: 'field-hint notes-empty', text: 'Double-click to write. Markdown with $math$; @M1 mentions a part or net, [[amp]] links a design, ![[circuit]] places a figure.' });
  const source = el('textarea', { class: 'notes-source', 'aria-label': 'Notes (Markdown)', spellcheck: 'true', hidden: true, placeholder: 'Markdown: # headings, $math$, @M1 for a part or net, [[design]] for a link' });
  const node = el('section', { class: 'floating-window notes-window', 'aria-labelledby': 'notes-title', hidden: true }, [
    el('header', { class: 'floating-window-header' }, [el('h2', { id: 'notes-title', class: 'floating-window-title', text: 'Notes' }), close]),
    el('div', { class: 'notes-body' }, [empty, view, source]),
    el('footer', { class: 'window-footer' }, [outline, report, copy, edit]),
  ]);
  edit.addEventListener('click', () => (editing ? stopEditing() : startEditing()));
  copy.addEventListener('click', copyMarkdown);
  report.addEventListener('click', () => exportCircuit({ content: 'report' }));
  outline.addEventListener('click', writeOutline);
  source.addEventListener('input', onInput);
  // Before the field's own keys: an open list takes Tab and Esc.
  attachNoteCompletion(source, completionNames);
  source.addEventListener('keydown', onSourceKey);
  source.addEventListener('blur', finishEditStep);
  view.addEventListener('mouseover', onViewOver);
  view.addEventListener('mouseout', onViewOut);
  view.addEventListener('click', onViewClick);
  view.addEventListener('contextmenu', onViewContextMenu);
  view.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && ev.target === view) { ev.preventDefault(); startEditing(); }
  });
  const body = node.querySelector('.notes-body');
  body.addEventListener('dblclick', (ev) => {
    if (!editing && !ev.target.closest('a')) startEditing();
  });
  canvasEl.closest('.canvas-pane').append(node);
  const chrome = floatingWindow(node, { key: 'notes', onClose: hide, resizable: true, toggleKey: 'N' });
  win = { el: node, view, source, edit, copy, outline, empty, chrome };
}

/** Empty notes started as a report (core/report.js `notesOutline`): one
 *  undo step, the source open to write in. */
function writeOutline() {
  if (notes()) return;
  beginSettingsEdit();
  editor.circuit.notes = normalizeNotes(notesOutline(editor.circuit, { name: editor.currentCircuitName || 'Design' }));
  markSettingsChanged();
  endSettingsEdit();
  if (!editing) startEditing();
  win.source.value = notes();
  win.source.setSelectionRange(0, 0);
  win.source.scrollTop = 0;
  win.copy.disabled = false;
  win.outline.hidden = true;
}

/** The notes on the clipboard as plain Markdown. */
async function copyMarkdown() {
  if (!notes()) return;
  try {
    await navigator.clipboard.writeText(notesMarkdown(notes()));
    logLine('Notes copied as Markdown');
  } catch (err) {
    logLine(`Could not copy the notes: ${err.message || err}`, 'error');
  }
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

/** Show the notes, if they are not shown already. */
export function showNotes() {
  if (!notesShown()) show();
}

/** Shift+N: show or hide the notes. */
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
