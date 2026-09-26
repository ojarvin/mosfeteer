/**
 * Find and replace in the side panel. The Ctrl+F filter also lists every
 * label and block caption containing its text under "Text"; the replace row
 * (Ctrl+H) rewrites all of them at once. What counts as a match and how each
 * text is renamed is core/label-search.js.
 */

import { findInLabels, replaceInLabels } from '../core/label-search.js';
import { confirmChoice } from './file-dialog.js';
import { canvasEl } from './elements.js';
import { logLine } from './status-bar-ui.js';
import { appendMarkupText, setSidePanelVisible, sidePanelVisible } from './side-panel.js';
import { editor } from './editor-state.js';
import { commit, render, setLabelSelection, setSelection } from './main.js';

const filterEl = document.getElementById('panel-filter');
const toggleEl = document.getElementById('panel-replace-toggle');
const rowEl = document.getElementById('panel-replace');
const replaceEl = document.getElementById('panel-replace-input');
const caseEl = document.getElementById('panel-replace-case');
const replaceAllEl = document.getElementById('panel-replace-all');
const sectionEl = document.getElementById('text-matches');
const listEl = document.getElementById('text-matches-list');
const countEl = document.getElementById('text-matches-count');

const ROLE_NAMES = {
  net: 'net', part: 'part', switch: 'phase', rail: 'rail', port: 'port',
  text: 'annotation', equation: 'equation', caption: 'caption', block: 'block',
};

/** The text being searched for: the filter exactly as typed, spaces and all. */
function findText() {
  const value = filterEl?.value || '';
  return value.trim() ? value : '';
}

const matchCase = () => caseEl?.getAttribute('aria-pressed') === 'true';
const replaceOpen = () => !!rowEl && !rowEl.hidden;

function refresh() {
  editor.panelStateKey = '';
  render();
}

function selectMatch(entry) {
  if (entry.refdes) setSelection([entry.refdes]);
  else setLabelSelection([entry.label.id]);
  render();
}

/** List the matching texts, each with what it becomes while replacing. */
export function renderTextMatches() {
  if (!sectionEl || !listEl) return;
  const find = findText();
  sectionEl.hidden = !find;
  listEl.innerHTML = '';
  if (!find) return;
  const replacement = replaceOpen() ? replaceEl.value : null;
  const found = findInLabels(editor.circuit, find, { matchCase: matchCase(), replacement });
  if (countEl) countEl.textContent = String(found.length);
  if (replaceAllEl) replaceAllEl.disabled = !found.length;
  if (!found.length) {
    listEl.innerHTML = '<div class="no-items">No matching text</div>';
    return;
  }
  listEl.setAttribute('role', 'listbox');
  listEl.setAttribute('aria-label', 'Matching text');
  for (const entry of found) {
    const row = document.createElement('div');
    row.className = 'row';
    row.setAttribute('role', 'option');
    row.tabIndex = -1;
    const text = document.createElement('span');
    text.className = 'ref';
    appendMarkupText(text, entry.text);
    if (entry.next !== undefined && entry.next !== entry.text) {
      const next = document.createElement('span');
      next.className = 'text-match-next';
      next.append('→ ');
      appendMarkupText(next, entry.next || '(empty)');
      text.append(' ', next);
    }
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = ROLE_NAMES[entry.role] || entry.role;
    row.title = `${ROLE_NAMES[entry.role] || entry.role}: ${entry.text}${entry.next !== undefined ? ` → ${entry.next}` : ''}`;
    row.append(text, meta);
    row.addEventListener('click', () => selectMatch(entry));
    listEl.appendChild(row);
  }
}

/** Ctrl/Cmd+F: focus the panel filter. A hidden panel is inert and cannot
 *  take focus, so it is revealed first. */
export function openFind() {
  if (!sidePanelVisible()) setSidePanelVisible(true);
  filterEl.focus();
  filterEl.select();
}

export function openReplace() {
  if (!sidePanelVisible()) setSidePanelVisible(true);
  rowEl.hidden = false;
  toggleEl.setAttribute('aria-expanded', 'true');
  const target = findText() ? replaceEl : filterEl;
  target.focus();
  target.select();
  refresh();
}

function closeReplace() {
  rowEl.hidden = true;
  toggleEl.setAttribute('aria-expanded', 'false');
  filterEl.focus();
  refresh();
}

/** Escape while replacing ends the whole find: both fields clear, the replace
 *  row closes, and the keyboard goes back to the drawing. */
function endFindReplace() {
  replaceEl.value = '';
  rowEl.hidden = true;
  toggleEl.setAttribute('aria-expanded', 'false');
  filterEl.value = '';
  filterEl.dispatchEvent(new Event('input'));
  canvasEl.focus({ preventScroll: true });
}

async function replaceAll() {
  const find = findText();
  if (!find) return;
  const replacement = replaceEl.value;
  const options = { matchCase: matchCase() };
  let preview;
  try {
    preview = replaceInLabels(editor.circuit, find, replacement, { ...options, dryRun: true });
  } catch (err) {
    logLine(err.message, 'error');
    return;
  }
  if (!preview.changed.length) {
    logLine(`no text contains "${find}"`);
    return;
  }
  // Equal names are one electrical connection: say so before making one.
  if (preview.joins.length && !await confirmChoice({
    title: 'Join nets by name?',
    message: `After this replace, nets that are now apart share the name ${preview.joins.join(', ')}, which connects them.`,
    confirmLabel: 'Replace and join',
  })) return;
  let result = null;
  commit(() => { result = replaceInLabels(editor.circuit, find, replacement, options); });
  if (result) logLine(`replaced "${find}" in ${result.changed.length} text${result.changed.length === 1 ? '' : 's'}`);
  refresh();
}

export function installFindReplace() {
  if (!filterEl || !rowEl) return;
  toggleEl.addEventListener('click', () => (replaceOpen() ? closeReplace() : openReplace()));
  caseEl.addEventListener('click', () => {
    caseEl.setAttribute('aria-pressed', String(!matchCase()));
    refresh();
  });
  replaceEl.addEventListener('input', refresh);
  replaceAllEl.addEventListener('click', replaceAll);
  replaceEl.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    replaceAll();
  });
  // Captured on the whole find area, ahead of the filter's own Escape (clear,
  // then leave), so one press ends a replace from any of its fields or buttons.
  filterEl.closest('.panel-filter').addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape' || !replaceOpen()) return;
    ev.preventDefault();
    ev.stopPropagation();
    endFindReplace();
  }, { capture: true });
}
