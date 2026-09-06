import test from 'node:test';
import assert from 'node:assert/strict';
import { layerActionForKey } from '../src/web/toolbar.js';

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
