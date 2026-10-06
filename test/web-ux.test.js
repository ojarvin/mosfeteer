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
