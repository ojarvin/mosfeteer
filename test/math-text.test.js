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

test('a plot text takes TeX between $ signs: letters, symbols, scripts', async () => {
  const { plotTextMarkup, texToLabelMarkup } = await import('../src/core/tex-markup.js');
  assert.equal(plotTextMarkup('$2\\cdot f_s$'), '2·f_{s}');
  assert.equal(plotTextMarkup('Gain $A_v$ (dB)'), 'Gain A_{v} (dB)');
  assert.equal(plotTextMarkup('$\\phi_1$ costs \\$5'), 'ϕ_{1} costs $5');
  assert.equal(plotTextMarkup('$\\text{noise}\\ \\le -100$'), 'noise ≤-100');
  assert.equal(plotTextMarkup('DC'), 'DC');
  assert.equal(texToLabelMarkup('$f_{c}\\approx 1\\,\\mathrm{kHz}$'), 'f_{c}≈1 kHz');
  // As runs: the subscript its own, the letters italic, no $ or \ left.
  const runs = mathRuns('$2\\cdot f_s$');
  assert.deepEqual(runs.map((r) => !!r.sub), [false, true]);
  assert.equal(runs.map((r) => r.text).join(''), `2·${mathItalic('f')}${mathItalic('s')}`);
});

import { GREEK_LOWER, GREEK_UPPER, TEX_STRUCTURES, TEX_SYMBOLS, texToLabelMarkup } from '../src/core/tex-markup.js';
import { texToMathML } from '../src/core/render.js';

test('every symbol Learn lists draws as its character on the drawing and in the plots alike', () => {
  const visible = (mathml) => mathml.replace(/<[^>]+>/g, '');
  for (const table of [GREEK_LOWER, GREEK_UPPER, TEX_SYMBOLS]) {
    for (const [name, char] of Object.entries(table)) {
      if (name === 'sqrt') continue; // a root on the drawing, its sign in a plot's text
      assert.equal(visible(texToMathML(`$\\${name}$`)), char, `\\${name} on the drawing`);
      assert.equal(texToLabelMarkup(`$\\${name}$`), char, `\\${name} in a plot`);
    }
  }
  // \bar is \overline on the drawing, as in the plots' markup.
  assert.equal(texToMathML('$\\bar{Q}$'), texToMathML('$\\overline{Q}$'));
});

test('every structure Learn lists draws with no command left as text', () => {
  for (const { tex } of TEX_STRUCTURES) {
    const text = texToMathML(`$${tex}$`).replace(/<[^>]+>/g, '');
    assert.doesNotMatch(text, /\\|frac|sqrt|mathrm|operatorname|overline|left|right|quad/, tex);
  }
});
