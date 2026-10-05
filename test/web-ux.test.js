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
  assert.match(css, /\.segmented \{[^}]*max-width: 100%;[^}]*flex-wrap: wrap;/);
  assert.match(css, /@container optimize \(max-width: 420px\)/);
});
