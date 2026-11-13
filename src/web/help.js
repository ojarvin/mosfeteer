/**
 * Learn (?): the one place to learn the editor. Its tabs are the keymap and
 * command reference (searchable, with the guides that match), the guides
 * (src/web/guides.js), the tutorials, every symbol (to look at:
 * hovering one names its type and pins), the TeX the labels take, and
 * every tip. Settings holds preferences only.
 */

import { commandHelp } from '../core/commands.js';
import { getSymbol, symbolTypeNames } from '../core/components/index.js';
import { symbolCategories } from '../core/components/categories.js';
import { PLACEMENT_LABELS, editorKeymap } from './toolbar.js';
import { helpDialog, helpDialogContent, helpSearch } from './elements.js';
import { symbolPreviewSvg } from './insert-menu.js';
import { offerTutorial, openReportExample, tipStates, tipsOn } from './onboarding.js';
import { TUTORIALS } from './tutorial.js';
import { GUIDES, guideDocUrl, guideRuns, searchGuides } from './guides.js';
import { GREEK_LOWER, GREEK_UPPER, TEX_SPACES, TEX_STRUCTURES, TEX_SYMBOLS } from '../core/tex-markup.js';
import { texToMathML } from '../core/render.js';

let helpCommandText = '';
let shownGuide = GUIDES[0].id;

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
  let count = 0;
  const guides = query ? searchGuides(query) : [];
  if (guides.length) {
    const block = document.createElement('section');
    block.className = 'help-section help-guide-matches';
    const title = document.createElement('h3');
    title.textContent = 'Guides';
    block.appendChild(title);
    for (const guide of guides) {
      const link = Object.assign(document.createElement('button'), { type: 'button', className: 'help-link', textContent: guide.title });
      link.dataset.guide = guide.id;
      link.addEventListener('click', () => showGuide(guide.id));
      const row = document.createElement('div');
      row.className = 'help-row help-guide-match';
      row.append(link);
      block.appendChild(row);
      count++;
    }
    helpDialogContent.appendChild(block);
  }
  const grid = document.createElement('div');
  grid.className = 'help-sections';
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

/** The TeX the labels take: the structures and the spaces with an
 *  example each, then the Greek and the symbols, each drawn as a label draws it beside what
 *  is typed. From the tables the renderer reads, so it lists what works. */
function renderMath() {
  const host = document.getElementById('help-math');
  if (!host || host.childElementCount) return;
  const drawn = (tex) => Object.assign(document.createElement('span'), { className: 'help-math-drawn', innerHTML: texToMathML(`$${tex}$`) });
  const typed = (tex) => Object.assign(document.createElement('code'), { textContent: tex });
  const section = (title, body) => {
    const node = document.createElement('section');
    node.className = 'help-symbol-group';
    node.append(Object.assign(document.createElement('h3'), { textContent: title }), body);
    return node;
  };
  const table = (entries) => {
    const node = document.createElement('table');
    node.className = 'help-math-table';
    for (const { tex, note } of entries) {
      const row = node.insertRow();
      row.insertCell().append(typed(tex));
      row.insertCell().append(drawn(tex));
      row.insertCell().textContent = note;
    }
    return node;
  };
  const grid = (names) => {
    const node = document.createElement('div');
    node.className = 'help-symbol-grid help-math-grid';
    node.setAttribute('role', 'list');
    for (const name of names) {
      const tile = document.createElement('div');
      tile.className = 'help-symbol help-math-tile';
      tile.setAttribute('role', 'listitem');
      tile.append(drawn(`\\${name}`), typed(`\\${name}`));
      node.append(tile);
    }
    return node;
  };
  host.append(
    section('Structures', table(TEX_STRUCTURES)),
    section('Spaces', table(TEX_SPACES)),
    section('Greek', grid([...Object.keys(GREEK_LOWER), ...Object.keys(GREEK_UPPER)])),
    section('Symbols', grid(Object.keys(TEX_SYMBOLS).filter((name) => name !== 'sqrt'))),
  );
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

/** A guide's text: plain words, controls in bold, keys as key caps. */
function appendGuideText(parent, text) {
  for (const run of guideRuns(text)) {
    if (run.kind === 'text') parent.append(document.createTextNode(run.text));
    else parent.append(Object.assign(document.createElement(run.kind === 'key' ? 'kbd' : 'strong'), { textContent: run.text }));
  }
  return parent;
}

function renderGuide(guide) {
  const host = document.getElementById('help-guide');
  if (!host) return;
  host.replaceChildren();
  if (!guide) return;
  const steps = document.createElement('ol');
  steps.className = 'help-guide-steps';
  for (const step of guide.steps) steps.append(appendGuideText(document.createElement('li'), step));
  host.append(
    Object.assign(document.createElement('h3'), { textContent: guide.title }),
    appendGuideText(Object.assign(document.createElement('p'), { className: 'help-guide-intro' }), guide.intro),
    steps,
  );
  const tutorial = TUTORIALS.find((t) => t.id === guide.tutorial);
  const url = guideDocUrl(guide);
  if (!tutorial && !url) return;
  const more = document.createElement('p');
  more.className = 'help-guide-more';
  if (tutorial) {
    const start = Object.assign(document.createElement('button'), { type: 'button', className: 'help-link', textContent: `Start the tutorial: ${tutorial.title}` });
    start.dataset.tutorial = tutorial.id;
    start.addEventListener('click', () => {
      helpDialog.close();
      offerTutorial(tutorial.id);
    });
    more.append(start);
  }
  if (tutorial && url) more.append(document.createTextNode(' · '));
  if (url) {
    more.append(Object.assign(document.createElement('a'), { className: 'help-link', href: url, target: '_blank', rel: 'noopener', textContent: `Read more: ${guide.doc}` }));
  }
  host.append(more);
}

/** The guides matching the guide search, the shown one marked. */
function renderGuides() {
  const list = document.getElementById('help-guide-list');
  if (!list) return;
  const query = document.getElementById('help-guide-search')?.value.trim() || '';
  const guides = searchGuides(query);
  if (guides.length && !guides.some((guide) => guide.id === shownGuide)) shownGuide = guides[0].id;
  list.replaceChildren(...guides.map((guide) => {
    const item = Object.assign(document.createElement('button'), { type: 'button', className: 'help-guide-item', textContent: guide.title });
    item.dataset.guide = guide.id;
    if (guide.id === shownGuide) item.setAttribute('aria-current', 'true');
    item.addEventListener('click', () => {
      shownGuide = guide.id;
      renderGuides();
    });
    return item;
  }));
  if (!guides.length) {
    list.append(Object.assign(document.createElement('p'), { className: 'help-empty', textContent: `Nothing matches "${query}".` }));
  }
  renderGuide(guides.find((guide) => guide.id === shownGuide));
}

/** Open Learn's Guides tab on one guide. */
export function showGuide(id) {
  if (!GUIDES.some((guide) => guide.id === id)) return;
  shownGuide = id;
  const search = document.getElementById('help-guide-search');
  if (search) search.value = '';
  if (helpDialog && !helpDialog.open) showHelp('guides');
  else showTab('guides');
}

function showTab(name) {
  for (const tab of helpDialog.querySelectorAll('[data-help-tab]')) {
    const on = tab.dataset.helpTab === name;
    tab.setAttribute('aria-selected', String(on));
    tab.setAttribute('aria-pressed', String(on));
  }
  for (const panel of helpDialog.querySelectorAll('[data-help-panel]')) panel.hidden = panel.dataset.helpPanel !== name;
  if (name === 'symbols') renderSymbols();
  if (name === 'math') renderMath();
  if (name === 'tips') renderTips();
  if (name === 'guides') renderGuides();
  if (name === 'keys') helpSearch?.focus();
  else if (name === 'guides') document.getElementById('help-guide-search')?.focus();
  else helpDialog.querySelector(`[data-help-tab="${name}"]`)?.focus();
}

/** Open Learn on a tab: keys (the default), guides, tutorial, symbols, math, or tips. */
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
    Object.assign(document.createElement('p'), { textContent: 'A delta-sigma modulator and the switched-capacitor integrator inside it, with notes written as a report: contents, figures, beats, equations, plots, citations, and the integrator as a section of the modulator\'s report. Opens unsaved; saving keeps both designs.' }),
    open,
  );
  return entry;
}

export function installHelp() {
  helpSearch?.addEventListener('input', renderHelpSearch);
  helpSearch?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') ev.preventDefault();
  });
  const guideSearch = document.getElementById('help-guide-search');
  guideSearch?.addEventListener('input', renderGuides);
  guideSearch?.addEventListener('keydown', (ev) => {
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
