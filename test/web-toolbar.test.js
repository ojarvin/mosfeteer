import test from 'node:test';
import assert from 'node:assert/strict';
import { componentPaletteItems, editorKeymapText, layerActionForKey } from '../src/web/toolbar.js';

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
  assert.match(help, /normal --\n/);
  assert.doesNotMatch(help, /\\n/);
  assert.match(help, /l\s+.*line annotation/);
  assert.doesNotMatch(help, /h j k|h j k l|hjkl/i);
});
