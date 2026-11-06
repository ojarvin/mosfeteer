import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GUIDES, guideDocUrl, guideRuns, plainGuideText, searchGuides } from '../src/web/guides.js';
import { TUTORIALS } from '../src/web/tutorial.js';
import { editorKeymap } from '../src/web/toolbar.js';

const sentences = (text) => plainGuideText(text).split(/(?<=[.!?])\s+(?=[A-Z])/).filter(Boolean);

test('each guide has a unique id, a title, a short introduction, and steps that are sentences', () => {
  assert.equal(new Set(GUIDES.map((g) => g.id)).size, GUIDES.length);
  assert.ok(GUIDES.length >= 8 && GUIDES.length <= 15, `a sensible number of guides: ${GUIDES.length}`);
  for (const guide of GUIDES) {
    assert.ok(guide.title && !/[.:]$/.test(guide.title), guide.id);
    const intro = sentences(guide.intro).length;
    assert.ok(intro >= 1 && intro <= 3, `${guide.id}: an introduction of 1-3 sentences, not ${intro}`);
    assert.ok(guide.steps.length >= 3, guide.id);
    for (const text of [guide.intro, ...guide.steps]) {
      assert.match(text, /^[A-Z]/, `${guide.id}: "${text}" starts a sentence`);
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
    for (const run of guide.steps.flatMap(guideRuns)) {
      if (run.kind === 'key') assert.ok(keys.has(run.text), `${guide.id}: key ${run.text}`);
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
