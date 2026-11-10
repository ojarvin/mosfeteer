/** The Atlas desk's text on the GPU (src/web/atlas-text.js): what can be checked without a page. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mathItalic, withRules } from '../src/web/atlas-text.js';

test('a single letter in math is drawn in the math italic it shows as', () => {
  assert.equal(mathItalic('V'), '\u{1D449}');
  assert.equal(mathItalic('a'), '\u{1D44E}');
  // Planck's constant stands in for the missing italic h.
  assert.equal(mathItalic('h'), 'ℎ');
  assert.equal(mathItalic('γ'), '\u{1D6FE}');
  assert.equal(mathItalic('Ω'), '\u{1D6FA}');
  // Digits and signs stay as they are.
  assert.equal(mathItalic('2'), '2');
  assert.equal(mathItalic('+'), '+');
});

test('rules join the ink after its shapes', () => {
  const ink = new Float32Array([1, 2]);
  assert.deepEqual([...withRules(ink, [3, 4])], [1, 2, 3, 4]);
  assert.equal(withRules(ink, []), ink);
});
