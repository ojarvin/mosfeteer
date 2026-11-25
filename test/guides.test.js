import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GUIDES, guideDocUrl, guideRuns, plainGuideText, searchGuides } from '../src/web/guides.js';
import { TUTORIALS } from '../src/web/tutorial.js';
import { editorKeymap } from '../src/web/toolbar.js';
import { renderNotes } from '../src/core/notes-markdown.js';
import { noteFigures } from '../src/core/notes.js';
import { resolveReportTarget } from '../src/core/report.js';
import { calculate } from '../src/core/calculator.js';
import { Circuit } from '../src/core/model.js';
import { runCommand } from '../src/core/commands.js';
import { newFigureId } from '../src/core/figures.js';

/** Every text of a guide that is a sentence: intro, steps, section items,
 *  and what each table row means. */
const prose = (guide) => [guide.intro, ...guide.steps, ...(guide.sections || []).flatMap((section) => [...(section.rows || []).map((row) => row[1]), ...(section.items || [])])];
const section = (id, title) => GUIDES.find((g) => g.id === id).sections.find((s) => s.title === title);
/** A table row's examples: its syntax split where two spaces part them. */
const examples = (row) => row[0].split(/ {2,}/);
const escapeHtml = (text) => text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
/** The editor's source as text: what a control's name must be found in. */
const webSource = () => [
  ...readdirSync(new URL('../src/web/', import.meta.url)).filter((f) => /\.(js|html)$/.test(f) && f !== 'guides.js').map((f) => new URL(`../src/web/${f}`, import.meta.url)),
  ...readdirSync(new URL('../src/core/components/', import.meta.url)).map((f) => new URL(`../src/core/components/${f}`, import.meta.url)),
].map((url) => readFileSync(url, 'utf8')).join('\n');

const sentences = (text) => plainGuideText(text).split(/(?<=[.!?])\s+(?=[A-Z])/).filter(Boolean);

test('each guide has a unique id, a title, a short introduction, and steps that are sentences', () => {
  assert.equal(new Set(GUIDES.map((g) => g.id)).size, GUIDES.length);
  assert.ok(GUIDES.length >= 8 && GUIDES.length <= 30, `a sensible number of guides: ${GUIDES.length}`);
  for (const guide of GUIDES) {
    assert.ok(guide.title && !/[.:]$/.test(guide.title), guide.id);
    const intro = sentences(guide.intro).length;
    assert.ok(intro >= 1 && intro <= 3, `${guide.id}: an introduction of 1-3 sentences, not ${intro}`);
    assert.ok(guide.steps.length >= 3, guide.id);
    for (const text of prose(guide)) {
      assert.match(plainGuideText(text), /^[A-Z]/, `${guide.id}: "${text}" starts a sentence`);
      assert.match(text, /\.$/, `${guide.id}: "${text}" ends a sentence`);
      assert.equal((text.match(/\*\*/g) || []).length % 2, 0, `${guide.id}: balanced ** in "${text}"`);
      assert.equal((text.match(/`/g) || []).length % 2, 0, `${guide.id}: balanced \` in "${text}"`);
    }
  }
});

test('a guide\'s tutorial and doc exist', () => {
  const tutorials = new Set(TUTORIALS.map((t) => t.id));
  for (const guide of GUIDES) {
    if (guide.tutorial) assert.ok(tutorials.has(guide.tutorial), `${guide.id}: tutorial ${guide.tutorial}`);
    if (guide.doc) {
      assert.ok(existsSync(fileURLToPath(new URL(`../docs/${guide.doc}`, import.meta.url))), `${guide.id}: docs/${guide.doc}`);
      assert.match(guideDocUrl(guide), new RegExp(`/docs/${guide.doc}$`));
    } else assert.equal(guideDocUrl(guide), null);
  }
});

test('every key a guide names is in the editor\'s keymap', () => {
  const keys = new Set(['Enter', 'Esc', 'i', 'w']);
  for (const [, entries] of editorKeymap()) {
    for (const [combo] of entries) {
      for (const alternative of combo.split(' / ')) keys.add(alternative.replace(/\s*\(.*\)$/, '').trim());
    }
  }
  for (const guide of GUIDES) {
    for (const run of prose(guide).flatMap(guideRuns)) {
      if (run.kind === 'key') assert.ok(keys.has(run.text), `${guide.id}: key ${run.text}`);
    }
  }
});

test('every control a guide names is in the editor (its name in the source), so a renamed control fails here', () => {
  const source = webSource();
  for (const guide of GUIDES) {
    for (const run of prose(guide).flatMap(guideRuns)) {
      if (run.kind === 'control') assert.ok(source.includes(run.text), `${guide.id}: no control "${run.text}" in src/web; rename it in guides.js, or mark typed text \`\`so\`\``);
    }
  }
});

test('every tool window opens a guide that exists, and related guides exist', () => {
  const ids = new Set(GUIDES.map((g) => g.id));
  for (const guide of GUIDES) for (const id of guide.related || []) assert.ok(ids.has(id), `${guide.id}: related ${id}`);
  const dir = new URL('../src/web/', import.meta.url);
  let windows = 0;
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.js') && f !== 'floating-window.js')) {
    const text = readFileSync(new URL(file, dir), 'utf8');
    for (const call of text.matchAll(/floatingWindow\(/g)) {
      const args = text.slice(call.index, text.indexOf(');', call.index));
      assert.match(args, /\bhelp:/, `${file}: a floating window without a help guide`);
      windows += 1;
    }
    for (const [, id] of text.matchAll(/\bhelp: '([\w-]+)'/g)) assert.ok(ids.has(id), `${file}: help '${id}'`);
  }
  assert.ok(windows >= 10, `${windows} windows`);
  // The analysis window's guide follows its mode.
  const analysis = readFileSync(new URL('analysis-ui.js', dir), 'utf8');
  const modes = analysis.match(/const MODE_GUIDES = \{([^}]*)\}/)[1];
  for (const [, id] of modes.matchAll(/'([\w-]+)'(?=\s*[,}]|$)/g)) assert.ok(ids.has(id), `analysis mode guide ${id}`);
});

test('the notes guide\'s syntax is what the notes render: no example is left as plain text', () => {
  for (const title of ['Text', 'References']) {
    for (const row of section('notes', title).rows) {
      const syntax = row[0].includes('\n') ? [row[0]] : examples(row);
      for (const example of syntax) {
        const html = renderNotes(example, {});
        assert.notEqual(html.trim(), `<p>${escapeHtml(example)}</p>`, `notes: "${example}" renders as itself`);
      }
    }
  }
});

test('the report guide\'s figures name what a report can show, and its references render', () => {
  const circuit = new Circuit();
  for (const line of ['add switch_open S1 --at 0 0', 'value S1 P1', 'add switch_open S2 --at 400 0', 'value S2 P2', 'timing P1=10 P2=01', 'beat phases']) runCommand(circuit, line);
  circuit.addLabel({ text: 'A_v', math: true, x: 1200, y: 0, figure: { id: newFigureId(circuit), kind: 'equations', source: 'small-signal' } });
  assert.ok(resolveReportTarget(circuit, 'F2'), 'the fixture has F2');
  for (const row of section('report', 'Figures and references').rows) {
    for (const example of examples(row)) {
      const embeds = noteFigures(example);
      if (example.startsWith('![[')) {
        assert.equal(embeds.length, 1, example);
        assert.ok(resolveReportTarget(circuit, embeds[0].name), `report: "${example}" shows nothing`);
      } else assert.notEqual(renderNotes(example, {}).trim(), `<p>${escapeHtml(example)}</p>`, `report: "${example}" renders as itself`);
    }
  }
});

test('the calculator guide\'s examples calculate', () => {
  const steps = GUIDES.find((g) => g.id === 'calculator').steps.flatMap(guideRuns).filter((run) => run.kind === 'typed' && run.text !== 'clear');
  for (const run of steps) assert.ok(Number.isFinite(calculate(run.text, { R: 1 }).value ?? calculate(run.text, { R: 1 })), run.text);
  const value = (line) => {
    const result = calculate(line, { ans: 2 });
    return typeof result === 'number' ? result : result.value;
  };
  for (const row of section('calculator', 'What it reads').rows) {
    for (const example of examples(row)) {
      if (!/[a-z0-9]/i.test(example)) continue;
      for (const token of example.includes('%') || /\d/.test(example) ? [example] : example.split(/\s+/)) {
        const name = token.replace(/\(x\)$/, '');
        const tries = /^[a-z]\w*$/i.test(name) ? [name, `${name}(0.5)`, `${name}(0.5, 0.25)`, `${name}(3)`] : [token];
        assert.ok(tries.some((line) => { try { return Number.isFinite(value(line)); } catch { return false; } }), `calculator: "${token}"`);
      }
    }
  }
});

test('guideRuns splits text into plain words, controls, and keys', () => {
  assert.deepEqual(guideRuns('Click **Derive**, or press `Enter`.'), [
    { kind: 'text', text: 'Click ' },
    { kind: 'control', text: 'Derive' },
    { kind: 'text', text: ', or press ' },
    { kind: 'key', text: 'Enter' },
    { kind: 'text', text: '.' },
  ]);
  assert.equal(plainGuideText('Press `Shift+S` and choose **Logic**.'), 'Press Shift+S and choose Logic.');
});

test('searchGuides matches every word, titles first; an empty query lists all', () => {
  assert.deepEqual(searchGuides('').map((g) => g.id), GUIDES.map((g) => g.id));
  assert.equal(searchGuides('small-signal')[0].id, 'small-signal');
  assert.equal(searchGuides('BEATS')[0].id, 'beats');
  assert.equal(searchGuides('timing diagram')[0].id, 'timing');
  assert.ok(searchGuides('bode').some((g) => g.id === 'small-signal'), 'keywords are searched');
  assert.ok(searchGuides('kT/C').some((g) => g.id === 'switched-cap'), 'steps are searched');
  assert.deepEqual(searchGuides('export logic').map((g) => g.id), []);
  assert.deepEqual(searchGuides('zzzz'), []);
});
