/**
 * The keyboard help overlay (?): the keymap and command reference, searchable.
 */

import { commandHelp } from '../core/commands.js';
import { editorKeymap } from './toolbar.js';
import { helpDialog, helpDialogContent, helpSearch } from './elements.js';

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

export function showHelp() {
  if (!helpDialog) return;
  try {
    helpCommandText = commandHelp();
  } catch (err) {
    helpCommandText = String(err.message || err);
  }
  if (helpSearch) helpSearch.value = '';
  renderHelpSearch();
  if (!helpDialog.open) helpDialog.showModal();
  helpSearch?.focus();
}

export function installHelp() {
  helpSearch?.addEventListener('input', renderHelpSearch);
  helpSearch?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') ev.preventDefault();
  });
}
