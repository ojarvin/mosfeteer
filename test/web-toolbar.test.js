import test from 'node:test';
import assert from 'node:assert/strict';
import { componentPaletteItems, editorKeymapText, fuzzyScore, layerActionForKey, placementSearchScore } from '../src/web/toolbar.js';

test('component palette omits generated solder dots but keeps real components', () => {
  const items = componentPaletteItems([
    { refdes: 'M1', type: 'nmos' },
    { refdes: 'J1', type: 'solder' },
    { refdes: 'R1', type: 'resistor' },
  ]);
  assert.deepEqual(items.map(({ refdes }) => refdes), ['M1', 'R1']);
});

test('layer shortcuts dispatch only in an idle normal editor', () => {
  assert.equal(layerActionForKey({ key: 'ArrowUp', shiftKey: true }), 'bring-front');
  assert.equal(layerActionForKey({ key: 'ArrowDown', shiftKey: true }), 'send-back');
  for (const state of [
    { key: 'ArrowUp' },
    { key: 'ArrowLeft', shiftKey: true },
    { key: 'ArrowUp', shiftKey: true, ctrlKey: true },
    { key: 'ArrowUp', shiftKey: true, mode: 'insert' },
    { key: 'ArrowUp', shiftKey: true, wire: true },
    { key: 'ArrowUp', shiftKey: true, moveMode: 'connected' },
    { key: 'ArrowUp', shiftKey: true, textEntry: true },
  ]) assert.equal(layerActionForKey(state), null);
});

test('block help exposes only block-domain tools', () => {
  const help = editorKeymapText('block');
  assert.match(help, /draw a Connector/);
  assert.doesNotMatch(help, /electrical wire|net label|component or label/i);
});

test('keyboard help is generated from current bindings without Vim movement keys', () => {
  const help = editorKeymapText();
  assert.match(help, /Arrow keys/);
  assert.match(help, /console separator/);
  assert.match(help, /-- draw --\n/);
  assert.match(help, /-- file and console --\n/);
  assert.doesNotMatch(help, /\\n/);
  assert.match(help, /l\s+.*line annotation/);
  assert.match(help, /e\s+.*LaTeX equation label/);
  assert.doesNotMatch(help, /h j k|h j k l|hjkl/i);
});

test('fuzzy ranking prefers prefix, then substring, then subsequence', () => {
  const prefix = fuzzyScore('res', 'resistor');
  const substring = fuzzyScore('sist', 'resistor');
  const subsequence = fuzzyScore('rstr', 'resistor');
  assert.ok(prefix > substring, 'prefix outranks substring');
  assert.ok(substring > subsequence, 'substring outranks subsequence');
  assert.equal(fuzzyScore('zzz', 'resistor'), -1);
  assert.equal(fuzzyScore('', 'resistor'), 0);
  // Within one tier the shorter name wins.
  assert.ok(fuzzyScore('n', 'nmos') > fuzzyScore('n', 'nmosb'));
});

test('insert search matches a symbol by id, display name, or alias', () => {
  assert.ok(placementSearchScore('nmos', 'nmos') > 0);
  assert.ok(placementSearchScore('transistor', 'nmos') > 0, 'display name "NMOS transistor"');
  assert.ok(placementSearchScore('pot', 'variable_resistor') > 0, 'alias "potentiometer"');
  assert.ok(placementSearchScore('bjt', 'npn') > 0, 'alias');
  assert.equal(placementSearchScore('zzzz', 'nmos'), -1);
});
