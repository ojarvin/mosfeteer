import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit, nextSavedNames, normalizeSavedNames } from '../src/core/model.js';
import { brokenLinks, formerlyNamed } from '../src/core/workspace-check.js';

test('a document remembers the names it was saved under, its own first', () => {
  assert.deepEqual(nextSavedNames([], 'amp'), ['amp']);
  assert.deepEqual(nextSavedNames(['amp'], 'amp'), ['amp']);
  assert.deepEqual(nextSavedNames(['amp', 'ota'], 'amp2'), ['amp2', 'amp', 'ota']);
  // Saved again under an old name, that name moves to the front.
  assert.deepEqual(nextSavedNames(['amp2', 'amp', 'ota'], 'ota'), ['ota', 'amp2', 'amp']);
  // Eight at most, trimmed and without the .json a file name has.
  const many = Array.from({ length: 12 }, (_, i) => `v${i}`);
  assert.equal(nextSavedNames(many, 'new').length, 8);
  assert.deepEqual(normalizeSavedNames([' amp.json ', '', null, 'amp', 3]), ['amp', '3']);
  // They round-trip with the document, and a document without them saves none.
  const circuit = new Circuit();
  assert.equal('names' in circuit.toJSON(), false);
  circuit.savedNames = ['amp', 'ota'];
  assert.deepEqual(Circuit.fromJSON(circuit.toJSON()).savedNames, ['amp', 'ota']);
});

test('a broken link finds the one design that was saved under its name, and never guesses between two', () => {
  const designs = [
    { id: 'sys', name: 'system', parts: [{ id: 'OA1', link: 'opamp' }, { id: 'OA2', link: 'opamp' }, { id: 'B1', link: 'bias' }, { id: 'R1' }, { id: 'X1', link: 'gone' }] },
    // Renamed in a file manager: the file says it was opamp.
    { id: 'ota', name: 'ota-v2', names: ['opamp'] },
    { id: 'bias', name: 'bias' },
    // Two copies both saved as mixer: a link to mixer has no single answer.
    { id: 'm1', name: 'mixer-a', names: ['mixer'] },
    { id: 'm2', name: 'mixer-b', names: ['mixer'] },
    { id: 'top', name: 'top', parts: [{ id: 'U1', link: 'mixer' }] },
  ];
  assert.deepEqual(brokenLinks(designs), [
    { design: 'sys', name: 'system', link: 'opamp', parts: ['OA1', 'OA2'], to: 'ota-v2', candidates: ['ota-v2'] },
    { design: 'sys', name: 'system', link: 'gone', parts: ['X1'], to: null, candidates: [] },
    { design: 'top', name: 'top', link: 'mixer', parts: ['U1'], to: null, candidates: ['mixer-a', 'mixer-b'] },
  ]);
  // A design still called by the name is no broken link, even when another
  // remembers it too (a copy made under a new name).
  assert.deepEqual(brokenLinks([{ id: 'a', name: 'amp' }, { id: 'b', name: 'amp copy', names: ['amp'] }, { id: 'c', name: 'c', parts: [{ id: 'U1', link: 'amp' }] }]), []);
  assert.deepEqual(formerlyNamed(designs, 'opamp'), { to: 'ota-v2', candidates: ['ota-v2'] });
});
