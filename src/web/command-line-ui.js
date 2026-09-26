/**
 * The `:` command line: history, Tab completion with a suggestion list, and
 * the editor commands (panels, view toggles, menus, dialogs). Everything else
 * goes to the shared document command language through runLine. The
 * vocabulary and completion rules are command-line.js.
 */

import { EDITOR_COMMANDS, canonicalDocumentLine, commandLineIntent, commandWord, didYouMean, lineSuggestions, resolveEditorCommand, tabComplete } from './command-line.js';
import { analysisDialog, canvasEl, cmdInput, cmdSuggestionsEl, scrollSchemeButton, tipsButton } from './elements.js';
import { editor } from './editor-state.js';
import { applyLogDrawerEvent, hintLine, logCommand, logLine } from './status-bar-ui.js';
import { toggleTheme, setGrid, setCrosshair, setGuides } from './toolbar-ui.js';
import { setSidePanelVisible, sidePanelVisible } from './side-panel.js';
import { toggleAnalysisDock } from './analysis-ui.js';
import { addBeatHere, flipSelectedSwitches, openPresenter, stepBeat, toggleBeatStrip, toggleSelectionInBeat } from './beats-ui.js';
import { fitView } from './canvas-view.js';
import { showHelp } from './help.js';
import { runCheck } from './design-check-ui.js';
import { openFind, openReplace } from './find-replace-ui.js';
import { toggleAtlas, toggleSymbolSheet } from './atlas.js';
import { activateAlign, activateAnnotation, activateCopy, activateEquation, activateHighlight, activateMove, activateNetLabel, activatePlace,
  activateShapeAnnotation, activateVisual, activateWire, applyLayoutPlan, deleteSelection, editSelectionText, layoutPlan, redo, render,
  repeatLastAction, restackSelected, runLine, selectAll, selectedTransform, stubSelection, swapTargets, tidyNow, undo } from './main.js';
import { removeAllNetHighlights } from './annotation-tools.js';
import { copyAsImage } from './export-ui.js';
import { pasteClipboard } from './copy-paste.js';
import { openSwapPicker } from './insert-menu.js';

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
  'phase-beats': () => click('btn-phase-beats'),
  'show-in-folder': () => click('btn-reveal-document'),
  'delete-document': () => click('btn-delete-circuit'),
  insert: () => activatePlace(),
  wire: () => activateWire(),
  rotate: () => selectedTransform('rotate'),
  'mirror-horizontal': () => selectedTransform('mirror-x'),
  'mirror-vertical': () => selectedTransform('mirror-y'),
  move: () => activateMove('connected'),
  'move-detached': () => activateMove('detached'),
  copy: () => activateCopy(),
  'copy-image': () => copyAsImage(),
  paste: () => pasteClipboard(),
  delete: () => { if (!deleteSelection()) hintLine('delete: select something first'); },
  'select-all': () => selectAll(),
  'box-select': () => activateVisual(),
  'net-label': () => activateNetLabel(),
  'free-text': () => activateAnnotation(),
  equation: () => activateEquation(),
  arrow: () => activateShapeAnnotation('arrow'),
  box: () => activateShapeAnnotation('box'),
  line: () => activateShapeAnnotation('line'),
  'align-to': () => activateAlign(),
  align: (side) => applyLayoutPlan(layoutPlan(side)),
  distribute: (axis) => applyLayoutPlan(layoutPlan(axis)),
  front: () => restackSelected('front'),
  back: () => restackSelected('back'),
  highlight: () => activateHighlight(),
  'clear-highlights': () => removeAllNetHighlights(),
  stubs: () => stubSelection(),
  swap: () => openSwapPicker(swapTargets()),
  repeat: () => repeatLastAction(),
  tidy: () => tidyNow(),
  edit: () => editSelectionText(),
  'add-beat': () => addBeatHere(),
  'next-beat': () => stepBeat(1),
  'previous-beat': () => stepBeat(-1),
  hide: () => toggleSelectionInBeat('hide'),
  dim: () => toggleSelectionInBeat('dim'),
  'flip-switches': () => flipSelectedSwitches(),
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
  // A canvas action hands the keyboard back to the drawing first, so a tool
  // it arms (insert, wire, move) takes the next keys and clicks.
  if (EDITOR_COMMANDS.find((entry) => entry.name === command.name)?.canvas) returnToCanvas();
  ACTIONS[command.name](command.state);
  render();
}

function returnToCanvas() {
  cmdInput.value = '';
  closeSuggestions();
  cmdInput.blur();
  applyLogDrawerEvent({ type: 'command-done' });
  canvasEl.focus({ preventScroll: true });
}

// ----- completion list ------------------------------------------------------

let completion = null; // the Tab session: typed word, candidates, index
let active = 0; // the suggestion Up/Down highlight and Enter runs

function renderSuggestions() {
  if (!cmdSuggestionsEl) return;
  const { word } = commandWord(cmdInput.value);
  const candidates = completion?.candidates || lineSuggestions(cmdInput.value);
  const shown = candidates.slice(0, 8);
  cmdSuggestionsEl.replaceChildren(...shown.map((entry, index) => {
    const item = document.createElement('li');
    item.setAttribute('role', 'option');
    item.id = `cmd-suggestion-${index}`;
    item.setAttribute('aria-selected', String(completion ? completion.index === index : index === active));
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
  const current = completion ? completion.index : active;
  if (open && current >= 0 && current < shown.length) cmdInput.setAttribute('aria-activedescendant', `cmd-suggestion-${current}`);
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
  active = 0;
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
      const typed = cmdInput.value.replace(/^:+/, '').trim();
      // Enter runs what the line says exactly, else the highlighted match;
      // a match that needs arguments is filled in to finish.
      const intent = typed && !completion ? commandLineIntent(typed, active) : { run: typed };
      if (intent.fill) {
        cmdInput.value = intent.fill;
        closeSuggestions();
        renderSuggestions();
        return;
      }
      const line = intent.run;
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
    } else if ((ev.key === 'ArrowUp' || ev.key === 'ArrowDown') && cmdInput.value.trim() && !cmdSuggestionsEl?.hidden
        && commandHistoryIndex < 0) {
      // With matches listed, the arrows walk them; on an empty line they
      // recall history.
      ev.preventDefault();
      const count = Math.min(8, cmdSuggestionsEl.children.length);
      if (completion) { active = Math.max(0, completion.index); completion = null; }
      active = (active + (ev.key === 'ArrowDown' ? 1 : -1) + count) % count;
      renderSuggestions();
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
    active = 0;
    renderSuggestions();
  });
  cmdInput.addEventListener('focus', renderSuggestions);
  cmdInput.addEventListener('blur', closeSuggestions);
}
