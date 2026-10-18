import test from 'node:test';
import assert from 'node:assert/strict';
import { mathItalic, mathRuns, mathText } from '../src/core/math-text.js';

test('lone letters are math italic, words and units upright', () => {
  assert.equal(mathText('|H| (dB)'), '|\u200A𝐻\u200A| (dB)');
  assert.equal(mathText('ω (g/C)'), '𝜔 (𝑔/𝐶\u200A)');
  assert.equal(mathText('Re s'), 'Re 𝑠');
  assert.equal(mathText('step response'), 'step response');
  assert.equal(mathText('input (dBFS)'), 'input (dBFS)');
  assert.equal(mathText('PM 45°'), 'PM 45°');
  // Uppercase Greek stays upright, as TeX sets it.
  assert.equal(mathText('∠Ω'), '∠Ω');
});

test('a letter before a digit is a variable too, and h takes Planck\'s constant', () => {
  assert.deepEqual(mathRuns('ω_{p1}').map((run) => run.text), ['𝜔', '𝑝1']);
  assert.deepEqual(mathRuns('V_{out}').map((run) => run.text), ['𝑉', 'out']);
  assert.equal(mathItalic('h'), 'ℎ');
  assert.equal(mathItalic('z'), '𝑧');
  assert.equal(mathItalic('Z'), '𝑍');
});

test('numbers keep upright digits and take a true minus sign', () => {
  assert.equal(mathText('-20'), '−20');
  assert.equal(mathText('-2.5·10'), '−2.5·10');
  assert.deepEqual(mathRuns('10^{-3}').map((run) => run.text), ['10', '−3']);
  // A dash between words is left alone.
  assert.equal(mathText('roll-off'), 'roll-off');
});

test('a bar or closing parenthesis stands a hair off an italic letter, across a subscript too', () => {
  assert.equal(mathText('|T|'), '|\u200A𝑇\u200A|');
  assert.deepEqual(mathRuns('|A_{v}|').map((run) => run.text), ['|\u200A𝐴', '𝑣', '\u200A|']);
  // Upright words keep their bars and parentheses close.
  assert.equal(mathText('|NTF| (dBFS)'), '|NTF| (dBFS)');
});
