import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyExportDarkTheme } from '../src/web/drawing-export.js';

// The dark theme's drawing colors, as the stylesheet sets them for the editor.
function darkTokens() {
  const css = readFileSync(new URL('../src/web/style.css', import.meta.url), 'utf8');
  const block = css.match(/html\.dark \{([^}]*)\}/)[1];
  return Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));
}

test('a drawing baked in the dark theme (exports, the Atlas) takes the editor\'s dark palette', () => {
  const tokens = darkTokens();
  const baked = applyExportDarkTheme('<rect fill="var(--paper, #fff)"/><path stroke="var(--grid, #ddd)"/><path stroke="var(--svg-ink, #111)"/><path stroke="#b8b8b8"/>');
  assert.equal(baked, `<rect fill="${tokens['--paper']}"/><path stroke="${tokens['--grid']}"/><path stroke="${tokens['--svg-ink']}"/><path stroke="${tokens['--svg-dim']}"/>`);
});
