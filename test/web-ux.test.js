import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { editorSource, functionSource } from './helpers/editor-source.js';

const read = (path) => readFileSync(new URL(`../src/web/${path}`, import.meta.url), 'utf8');

test('a finished analysis adjustment is one undo step, and undoing it keeps the results current', () => {
  const main = editorSource();
  // Bracketed by the window: pressed or focused opens, a change or a button's click closes.
  const analysis = read('analysis-ui.js');
  assert.match(analysis, /root\.addEventListener\('pointerdown', begin, true\);/);
  assert.match(analysis, /root\.addEventListener\('change', end\);/);
  assert.match(analysis, /installSettingsUndo\(analysisDialog\);/);
  // Recorded only when the settings alone changed; a drawing edit closes it.
  const end = functionSource('endSettingsEdit', main);
  assert.match(end, /if \(after === before \|\| drawingOf\(after\) !== drawingOf\(before\)\) return;/);
  assert.match(functionSource('recordHistoryEntry', main), /settingsBefore = null;/);
  // Undo and redo of settings alone leave what was derived current and redraw the sliders.
  assert.match(functionSource('settingsRestored', main), /settingsRevisions\.add\(modelRevision\);\s*signalFlowSettingsRestored\(\);\s*bodeSettingsRestored\(\);/);
  for (const name of ['undo', 'redo']) assert.match(functionSource(name, main), /settingsRestored\(current, target\);/);
});

test('long explanations in the analysis window fold to their first sentence', () => {
  const hints = read('hints.js');
  assert.match(hints, /const FOLD_FROM = 150;/);
  // Only plain hints: a status line has its own class and always shows in full.
  assert.match(hints, /node\.matches\('p\.field-hint'\) && node\.classList\.length === 1/);
  assert.match(read('analysis-ui.js'), /installHintFolding\(analysisDialog\);/);
});

test('the context menu ends with Delete in its own group, and has no Close item', () => {
  const menu = read('context-menu.js');
  assert.doesNotMatch(menu, /appendContextItem\(menu, 'Close'/);
  assert.match(menu, /appendContextSmallSignalMenu\(menu, target\);\s*\/\/[^\n]*\n\s*appendContextDelete\(menu\);/);
});

test('the signal-flow window: setup, then results and plots, then the coefficients and the optimizer', () => {
  const all = read('signal-flow-ui.js');
  const ui = all.slice(all.indexOf("section = el('div', { id: 'analysis-signal-flow'"));
  const order = ['signal-flow-stale', 'signal-flow-results', 'signal-flow-plots', 'signal-flow-coefficients', 'optimizeSection({'].map((key) => ui.indexOf(key));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
});

test('the theme is a setting, and a narrow window keeps its controls inside', () => {
  const html = read('index.html');
  const settings = html.slice(html.indexOf('id="settings-menu"'), html.indexOf('</div>', html.indexOf('id="btn-github"')));
  assert.match(settings, /id="btn-theme" type="button" role="menuitemcheckbox"/);
  const css = read('style.css');
  assert.match(css, /@container optimize \(max-width: 420px\)/);
});

test('every card opens with the same header, inside it; headings within a card are quieter', () => {
  const css = read('style.css');
  // A fieldset's legend is the card's first line, in the section-label style, in every window.
  for (const legend of ['.analysis-dock legend', '.export-dialog legend']) {
    const rule = css.slice(css.indexOf(`${legend} {`), css.indexOf('}', css.indexOf(`${legend} {`)));
    assert.match(rule, /float: left;[\s\S]*width: 100%;[\s\S]*text-transform: uppercase;/);
  }
  // Cards without a legend carry the same header: the plots, the optimizer's summary.
  assert.match(read('signal-flow-ui.js'), /el\('div', \{ class: 'card-heading', text: 'Plots' \}\)/);
  const optimizer = css.slice(css.indexOf('.signal-flow-optimize > summary {'), css.indexOf('}', css.indexOf('.signal-flow-optimize > summary {')));
  assert.match(optimizer, /text-transform: uppercase;/);
  const sub = css.slice(css.indexOf('.signal-flow-optimize-heading {'), css.indexOf('}', css.indexOf('.signal-flow-optimize-heading {')));
  assert.match(sub, /text-transform: none;/);
  // One card for the signals: the output row, then the sources (both modes).
  assert.match(read('signal-flow-ui.js'), /el\('legend', \{ text: 'Signals' \}\),\s*el\('div', \{ class: 'signal-flow-source signal-flow-output-row' \}/);
  assert.match(read('index.html'), /<fieldset class="analysis-approximations analysis-signals">\s*<legend>Signals<\/legend>/);
  // A scrollbar appearing never reflows the window; a segmented control shrinks rather than wrap.
  assert.match(css, /\.analysis-scroll \{[^}]*scrollbar-gutter: stable;/);
  assert.match(css, /\.segmented \{[^}]*flex-wrap: nowrap;/);
});

test('a hint stands below what it explains, pulled up only inside a spaced container', () => {
  const css = read('style.css');
  assert.match(css, /\.analysis-dock \.field-hint \{[^}]*margin-top: 4px;/);
  assert.match(css, /\.analysis-dock :is\(fieldset, \.signal-flow-optimize-group, \.signal-flow-plots\) > \.field-hint \{\s*margin-top: -4px;/);
});

test('Update plots sits in the footer beside Derive; explanations open while the optimizer runs', () => {
  const ui = read('signal-flow-ui.js');
  const actions = ui.slice(ui.indexOf('  actions = ['), ui.indexOf('];', ui.indexOf('  actions = [')));
  assert.match(actions, /class: 'signal-flow-update-plots'[\s\S]*class: 'signal-flow-annotate'[\s\S]*class: 'primary-action signal-flow-derive'/);
  assert.match(read('optimize-ui.js'), /if \(node !== button && !node\.classList\.contains\('hint-more'\)\) node\.disabled = true;/);
});

test('the optimizer\'s value lists are tables, and each coefficient\'s n sits with the fractions', () => {
  const ui = read('optimize-ui.js');
  assert.match(ui, /function gridTable\(head, rows\)/);
  assert.match(ui, /return \[gridTable\(\['', startLabel, endLabel\]/);
  assert.match(ui, /gridTable\(\['', 'm\/n', 'Value'\], rows\)/);
  assert.match(ui, /gridTable\(\['Coefficient', 'Change'\], entries\.map\(row\)\)/);
  // n (≤ or =) left the coefficient table for the fractions.
  assert.match(ui, /\['', '', 'Min', 'Max', 'Now', 'Found'\]/);
  assert.match(ui, /el\('summary', \{ text: `n per coefficient/);
  assert.match(ui, /el\('option', \{ value: 'max', text: '≤' \}\), el\('option', \{ value: 'fixed', text: '=' \}\)/);
});

test('a run opens its own window: the start and the best so far, progress, Stop', () => {
  const win = read('optimize-window.js');
  assert.match(win, /export function openRunWindow\(\{ title, plotAt, onStop, onClose = \(\) => \{\} \}\)/);
  assert.match(win, /stop\.textContent = 'Close';/);
  const ui = read('optimize-ui.js');
  assert.match(ui, /const runWindow = openRunWindow\(\{\s*title, plotAt: runPlotter\(\), onStop: \(\) => running\?\.stop\(\),/);
  // Closing the window leaves the run going, its progress back in the analysis window.
  assert.match(ui, /progress\.hidden = runWindow\.isOpen\(\);/);
  // Only the latest best is drawn beside the start.
  assert.match(ui, /if \(optimizer\.best && optimizer\.best !== shownBest\) \{\s*shownBest = optimizer\.best;\s*showBest\(shownBest\.values\);/);
  assert.match(ui, /title: 'Optimizer',/);
  // Rounding is part of the run, not a run of its own.
  assert.doesNotMatch(ui, /title: 'Rounding',/);
  // Fractions are kept during the search: each candidate snapped before it is scored.
  assert.match(ui, /const snap = current\.rounding\.on \? fractionsFor\(circuit, parameters, current\) : null;/);
  assert.match(ui, /stopEarly: !goals, verify: swingOn, snap \}\)/);
});

test('fields show what is typed: no ligatures join their characters', () => {
  assert.match(read('style.css'), /input,\ntextarea \{\n  font-variant-ligatures: none;\n  font-feature-settings: "liga" 0, "calt" 0;/);
});
