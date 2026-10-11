import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/web/style.css', import.meta.url), 'utf8');

test('colours live in the theme tokens: no raw colour outside a custom property', () => {
  const raw = css.split('\n')
    .map((line, i) => ({ line: line.trim(), at: i + 1 }))
    .filter(({ line }) => !line.startsWith('--') && !line.startsWith('/*') && !line.startsWith('*'))
    // An attribute selector naming an SVG's fill is not a colour used.
    .map(({ line, at }) => ({ line: line.replace(/\[fill="#[0-9a-f]+"\]/gi, ''), at }))
    // Darkening a token by mixing in black is the theme's own colour.
    .filter(({ line }) => /#[0-9a-f]{3,8}\b|rgba?\(/i.test(line.replace(/, #000\)/g, ')')));
  assert.deepEqual(raw, []);
});

test('every text field and select takes its size from the field tokens, dense rows a smaller one', () => {
  const base = css.slice(css.indexOf('select,\ninput[type="text"],'), css.indexOf('}', css.indexOf('select,\ninput[type="text"],')));
  assert.match(base, /height: var\(--field-h\);/);
  assert.match(base, /padding: 0 var\(--field-pad-x\);/);
  assert.match(css, /\.signal-flow-section, \.plots-window[^{]*\{\s*--field-h: var\(--control-h-sm\);/);
  // No field rule sets its own height beside the tokens.
  assert.doesNotMatch(css, /(?:input|select)[^{}]*\{[^}]*\bheight: var\(--control-h(?:-sm)?\)/);
});
