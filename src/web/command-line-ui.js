/**
 * The `:` command line: history, Tab completion with a suggestion list, and
 * the editor commands (panels, view toggles, menus, dialogs). Everything else
 * goes to the shared document command language through runLine. The
 * vocabulary and completion rules are command-line.js.
 */

import { canonicalDocumentLine, commandCompletions, commandWord, didYouMean, resolveEditorCommand, tabComplete } from './command-line.js';
import { analysisDialog, canvasEl, cmdInput, cmdSuggestionsEl, scrollSchemeButton, tipsButton } from './elements.js';
import { editor } from './editor-state.js';
import { applyLogDrawerEvent, logCommand, logLine } from './status-bar-ui.js';
import { toggleTheme, setGrid, setCrosshair, setGuides } from './toolbar-ui.js';
import { setSidePanelVisible, sidePanelVisible } from './side-panel.js';
import { toggleAnalysisDock } from './analysis-ui.js';
import { openPresenter, toggleBeatStrip } from './beats-ui.js';
import { fitView } from './canvas-view.js';
import { showHelp } from './help.js';
import { runCheck } from './design-check-ui.js';
import { openFind, openReplace } from './find-replace-ui.js';
import { toggleAtlas, toggleSymbolSheet } from './atlas.js';
import { redo, render, runLine, undo } from './main.js';

const click = (id) => document.getElementById(id)?.click();
const checked = (button) => button?.getAttribute('aria-checked') === 'true';

/** Flip a toggle unless it already shows the requested state. */
function toggleTo(state, current, flip) {
  if (state === undefined || state !== current) flip();
}

function openMenu(buttonId) {
  const button = document.getElementById(buttonId);
  if (button?.getAttribute('aria-expanded') !== 'true') button?.click();
}

/** What each editor command does. `state` is resolveEditorCommand's. */
const ACTIONS = {
  settings: () => openMenu('btn-settings'),
  more: () => openMenu('btn-document-menu'),
  panel: (state) => setSidePanelVisible(state ?? !sidePanelVisible()),
  analysis: (state) => toggleTo(state, !analysisDialog.hidden, () => toggleAnalysisDock()),
  grid: (state) => setGrid(state ?? !editor.showGrid),
  guides: (state) => setGuides(state ?? !editor.guidesVisible),
  crosshair: (state) => setCrosshair(state ?? !editor.crosshairVisible),
  dark: (state) => toggleTo(state, document.documentElement.classList.contains('dark'), toggleTheme),
  beats: (state) => toggleTo(state, editor.beatStripOpen, toggleBeatStrip),
  tips: (state) => toggleTo(state, checked(tipsButton), () => tipsButton?.click()),
  trackpad: (state) => toggleTo(state, checked(scrollSchemeButton), () => scrollSchemeButton?.click()),
  'page-guide': (state) => (state
    ? document.querySelector(`[data-page-guide="${state === 'none' ? '' : state}"]`)?.click()
    : openMenu('btn-settings')),
  atlas: () => toggleAtlas(),
  symbols: () => toggleSymbolSheet(),
  fit: () => fitView({ animate: true }),
  shortcuts: () => showHelp(),
  check: () => runCheck(),
  find: () => openFind(),
  replace: () => openReplace(),
  undo: () => undo(),
  redo: () => redo(),
  save: () => click('btn-save'),
  'save-as': () => click('btn-save-as'),
  open: () => click('btn-open-file'),
  new: () => click('btn-new-document'),
  export: () => click('btn-export'),
  present: () => openPresenter(),
  workspace: () => click('btn-workspace'),
  tutorial: () => click('btn-tutorial'),
};

/** Run one command line: an editor command here, anything else as a
 *  document command (its synonyms mapped to the command's own name). */
export function runCommandLine(line) {
  const command = resolveEditorCommand(line);
  if (!command) {
    const canonical = canonicalDocumentLine(line);
    const error = runLine(canonical);
    // An unknown word gets a pointer at what it might have meant.
    const hint = /^unknown command/.test(error || '') && didYouMean(commandWord(canonical).word);
    if (hint) logLine(hint);
    return;
  }
  logCommand(line);
  ACTIONS[command.name](command.state);
  render();
}

// ----- completion list ------------------------------------------------------

let completion = null; // the Tab session: typed word, candidates, index

function renderSuggestions() {
  if (!cmdSuggestionsEl) return;
  const { word, spaced } = commandWord(cmdInput.value);
  const candidates = completion?.candidates || (spaced ? [] : commandCompletions(word));
  const shown = candidates.slice(0, 8);
  cmdSuggestionsEl.replaceChildren(...shown.map((entry, index) => {
    const item = document.createElement('li');
    item.setAttribute('role', 'option');
    item.id = `cmd-suggestion-${index}`;
    item.setAttribute('aria-selected', String(completion?.index === index));
    const name = document.createElement('span');
    name.className = 'cmd-suggestion-name';
    name.textContent = entry.name;
    item.append(name);
    if (entry.via) {
      const via = document.createElement('span');
      via.className = 'cmd-suggestion-via';
      via.textContent = `(${entry.via})`;
      item.append(via);
    }
    const help = document.createElement('span');
    help.className = 'cmd-suggestion-help';
    help.textContent = entry.help;
    item.append(help);
    // Keep focus in the input: a press there would blur it and close the drawer.
    item.addEventListener('pointerdown', (ev) => ev.preventDefault());
    item.addEventListener('click', () => {
      completion = { word, candidates, index: index - 1 };
      stepCompletion(1);
    });
    return item;
  }));
  const open = shown.length > 0 && document.activeElement === cmdInput;
  cmdSuggestionsEl.hidden = !open;
  cmdInput.setAttribute('aria-expanded', String(open));
  if (open && completion && completion.index < shown.length) cmdInput.setAttribute('aria-activedescendant', `cmd-suggestion-${completion.index}`);
  else cmdInput.removeAttribute('aria-activedescendant');
}

function stepCompletion(step) {
  const next = tabComplete(cmdInput.value, completion, step);
  if (!next) return;
  completion = next.session;
  cmdInput.value = next.line;
  cmdInput.setSelectionRange(next.line.length, next.line.length);
  renderSuggestions();
}

function closeSuggestions() {
  completion = null;
  if (cmdSuggestionsEl) cmdSuggestionsEl.hidden = true;
  cmdInput.setAttribute('aria-expanded', 'false');
  cmdInput.removeAttribute('aria-activedescendant');
}

// ----- wiring ---------------------------------------------------------------

// The command line keeps its own history; the drawer stays open after Enter
// so the output lands right above the input.
const commandHistory = [];
let commandHistoryIndex = -1;

export function installCommandLine() {
  cmdInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Tab' && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
      // Tab never leaves the command line: it completes, or does nothing.
      ev.preventDefault();
      ev.stopPropagation();
      stepCompletion(ev.shiftKey ? -1 : 1);
    } else if (ev.key === 'Enter') {
      const line = cmdInput.value.replace(/^:+/, '').trim();
      cmdInput.value = '';
      commandHistoryIndex = -1;
      closeSuggestions();
      if (!line) {
        cmdInput.blur();
        return;
      }
      if (commandHistory.at(-1) !== line) commandHistory.push(line);
      runCommandLine(line);
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      cmdInput.value = '';
      commandHistoryIndex = -1;
      closeSuggestions();
      cmdInput.blur();
      applyLogDrawerEvent({ type: 'command-done' });
      canvasEl.focus();
    } else if ((ev.key === 'ArrowUp' || ev.key === 'ArrowDown') && commandHistory.length) {
      ev.preventDefault();
      const last = commandHistory.length - 1;
      commandHistoryIndex = ev.key === 'ArrowUp'
        ? (commandHistoryIndex < 0 ? last : Math.max(0, commandHistoryIndex - 1))
        : (commandHistoryIndex < 0 || commandHistoryIndex >= last ? -1 : commandHistoryIndex + 1);
      cmdInput.value = commandHistoryIndex < 0 ? '' : commandHistory[commandHistoryIndex];
      closeSuggestions();
    }
  });
  cmdInput.addEventListener('input', () => {
    completion = null;
    renderSuggestions();
  });
  cmdInput.addEventListener('focus', renderSuggestions);
  cmdInput.addEventListener('blur', closeSuggestions);
}
