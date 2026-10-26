/**
 * Learn (?): the one place to learn the editor. Its tabs are the keymap and
 * command reference (searchable), the tutorials, every symbol (to look at:
 * hovering one names its type and pins), and every tip. Settings holds
 * preferences only.
 */

import { commandHelp } from '../core/commands.js';
import { getSymbol, symbolTypeNames } from '../core/components/index.js';
import { symbolCategories } from '../core/components/categories.js';
import { PLACEMENT_LABELS, editorKeymap } from './toolbar.js';
import { helpDialog, helpDialogContent, helpSearch } from './elements.js';
import { symbolPreviewSvg } from './insert-menu.js';
import { offerTutorial, openReportExample, tipStates, tipsOn } from './onboarding.js';
import { TUTORIALS } from './tutorial.js';

let helpCommandText = '';

function helpKeyNodes(keys) {
  const container = document.createElement('span');
  container.className = 'help-keys';
  keys.split(' / ').forEach((alternative, index) => {
    if (index) container.append(document.createTextNode(' / '));
    const note = alternative.match(/^(.*?)\s+(\([^)]*\))$/);
    const combo = note ? note[1] : alternative;
    // Named gestures and console commands read as text; key combinations get caps.
    if (/\s/.test(combo) && !/^(Arrow keys)$/.test(combo)) {
      const code = document.createElement('code');
      code.textContent = combo;
      container.append(code);
    } else {
      combo.split(/\+(?=.)/).forEach((part, partIndex) => {
        if (partIndex) container.append(document.createTextNode('+'));
        const kbd = document.createElement('kbd');
        kbd.textContent = part;
        container.append(kbd);
      });
    }
    if (note) container.append(document.createTextNode(` ${note[2]}`));
  });
  return container;
}

export function renderHelpSearch() {
  if (!helpDialogContent) return;
  const query = helpSearch?.value.trim().toLowerCase() || '';
  const matches = (...parts) => !query || parts.some((part) => part.toLowerCase().includes(query));
  helpDialogContent.replaceChildren();
  const grid = document.createElement('div');
  grid.className = 'help-sections';
  let count = 0;
  for (const [section, entries] of editorKeymap()) {
    const rows = entries.filter(([keys, description]) => matches(keys, description, section));
    if (!rows.length) continue;
    const block = document.createElement('section');
    block.className = 'help-section';
    const title = document.createElement('h3');
    title.textContent = section;
    block.appendChild(title);
    for (const [keys, description] of rows) {
      const row = document.createElement('div');
      row.className = 'help-row';
      const text = document.createElement('span');
      text.className = 'help-description';
      text.textContent = description;
      row.append(helpKeyNodes(keys), text);
      block.appendChild(row);
      count++;
    }
    grid.appendChild(block);
  }
  if (grid.childElementCount) helpDialogContent.appendChild(grid);
  const commandLines = helpCommandText.split('\n').filter((line) => matches(line));
  if (commandLines.length) {
    const commands = document.createElement('details');
    commands.className = 'help-commands';
    commands.open = !!query;
    const summary = document.createElement('summary');
    summary.textContent = 'Console commands';
    const pre = document.createElement('pre');
    pre.textContent = commandLines.join('\n');
    commands.append(summary, pre);
    helpDialogContent.appendChild(commands);
    count += commandLines.length;
  }
  if (!count) {
    const empty = document.createElement('p');
    empty.className = 'help-empty';
    empty.textContent = `Nothing matches "${helpSearch.value.trim()}".`;
    helpDialogContent.appendChild(empty);
  }
}

/** Every placeable symbol by category: a tile each, to look at -- no click
 *  action; hovering one tells what it is, the type to search for when
 *  inserting it, and its pins. */
function renderSymbols() {
  const host = document.getElementById('help-symbols');
  if (!host || host.childElementCount) return;
  for (const { title, types } of symbolCategories(symbolTypeNames.filter((type) => type !== 'solder'))) {
    const section = document.createElement('section');
    section.className = 'help-symbol-group';
    const heading = document.createElement('h3');
    heading.textContent = title;
    const grid = document.createElement('div');
    grid.className = 'help-symbol-grid';
    grid.setAttribute('role', 'list');
    for (const type of types) {
      const tile = document.createElement('div');
      tile.className = 'help-symbol';
      tile.setAttribute('role', 'listitem');
      const def = getSymbol(type);
      tile.title = `${def.description || PLACEMENT_LABELS[type] || type}\ntype: ${type}\npins: ${def.terminals.map((t) => t.name).join(', ') || 'none'}`;
      tile.innerHTML = `<span class="help-symbol-art" aria-hidden="true">${symbolPreviewSvg(type)}</span>`;
      const name = document.createElement('span');
      name.textContent = PLACEMENT_LABELS[type] || type;
      tile.append(name);
      grid.append(tile);
    }
    section.append(heading, grid);
    host.append(section);
  }
}

function renderTips() {
  const list = document.getElementById('help-tips');
  if (!list) return;
  list.replaceChildren(...tipStates().map((tip) => {
    const item = document.createElement('li');
    item.className = `help-tip${tip.retired ? ' retired' : ''}`;
    const text = document.createElement('span');
    text.textContent = tip.text;
    const state = document.createElement('span');
    state.className = 'help-tip-state';
    state.textContent = tip.retired ? 'learned' : tip.shown ? 'seen' : 'new';
    item.append(text, state);
    return item;
  }));
  if (!tipsOn()) {
    const off = document.createElement('li');
    off.className = 'help-tip-off';
    off.textContent = 'Tips are off: Settings → Show tips turns them back on.';
    list.prepend(off);
  }
}

function showTab(name) {
  for (const tab of helpDialog.querySelectorAll('[data-help-tab]')) {
    const on = tab.dataset.helpTab === name;
    tab.setAttribute('aria-selected', String(on));
    tab.setAttribute('aria-pressed', String(on));
  }
  for (const panel of helpDialog.querySelectorAll('[data-help-panel]')) panel.hidden = panel.dataset.helpPanel !== name;
  if (name === 'symbols') renderSymbols();
  if (name === 'tips') renderTips();
  if (name === 'keys') helpSearch?.focus();
  else helpDialog.querySelector(`[data-help-tab="${name}"]`)?.focus();
}

/** Open Learn on a tab: keys (the default), tutorial, symbols, or tips. */
export function showHelp(tab = 'keys') {
  if (!helpDialog) return;
  try {
    helpCommandText = commandHelp();
  } catch (err) {
    helpCommandText = String(err.message || err);
  }
  if (helpSearch) helpSearch.value = '';
  renderHelpSearch();
  if (!helpDialog.open) helpDialog.showModal();
  showTab(tab);
}

/** Learn's report example: two designs saved to the workspace and opened. */
function reportExampleEntry() {
  const open = Object.assign(document.createElement('button'), { type: 'button', className: 'confirm-action', textContent: 'Open', id: 'btn-report-example' });
  open.addEventListener('click', () => {
    helpDialog.close();
    void openReportExample();
  });
  const entry = document.createElement('section');
  entry.className = 'help-tutorial';
  entry.append(
    Object.assign(document.createElement('h3'), { textContent: 'Report example' }),
    Object.assign(document.createElement('p'), { textContent: 'A delta-sigma modulator and the switched-capacitor integrator inside it, with notes written as a report: figures, beats, math, a citation, and the integrator as a section of the modulator\'s report. Saved to the workspace as report-example-modulator and report-example-integrator.' }),
    open,
  );
  return entry;
}

export function installHelp() {
  helpSearch?.addEventListener('input', renderHelpSearch);
  helpSearch?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') ev.preventDefault();
  });
  for (const tab of helpDialog?.querySelectorAll('[data-help-tab]') || []) {
    tab.addEventListener('click', () => showTab(tab.dataset.helpTab));
  }
  // Starting something from Learn leaves it. Each tutorial is an entry;
  // the first's button keeps the id the command line clicks.
  const tutorials = document.getElementById('help-tutorials');
  tutorials?.replaceChildren(...TUTORIALS.map((tutorial, index) => {
    const start = Object.assign(document.createElement('button'), { type: 'button', className: 'confirm-action', textContent: 'Start' });
    start.dataset.tutorial = tutorial.id;
    if (index === 0) start.id = 'btn-tutorial';
    start.addEventListener('click', () => {
      helpDialog.close();
      offerTutorial(tutorial.id);
    });
    const entry = document.createElement('section');
    entry.className = 'help-tutorial';
    entry.append(
      Object.assign(document.createElement('h3'), { textContent: tutorial.title }),
      Object.assign(document.createElement('p'), { textContent: tutorial.blurb }),
      start,
    );
    return entry;
  }) || [], reportExampleEntry());
  document.getElementById('btn-symbols')?.addEventListener('click', () => helpDialog.close(), true);
  document.getElementById('btn-built-in-drawings')?.addEventListener('click', () => helpDialog.close(), true);
}
