import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Circuit } from '../src/core/model.js';
import { svgString } from '../src/core/render.js';
import { withEmbeddedMathFont } from '../src/web/drawing-export.js';
import { bodeSketch } from '../src/core/analysis/bode.js';

const font = readFileSync(new URL('../src/web/fonts/latinmodern-math.woff2', import.meta.url));
globalThis.fetch = async () => ({ arrayBuffer: async () => font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength) });

test('an export carries the math font when its text is set in it, and only then', async () => {
  const plotted = new Circuit();
  plotted.addAnnotation('box', {
    x: 0, y: 0, end: { x: 640, y: 400 },
    plot: { ...bodeSketch([100], [1, 100]), corners: [{ w: 0.01, text: 'ω_{p1}' }], quantity: 'A_{v}', phase: false },
  });
  const embedded = await withEmbeddedMathFont(svgString(plotted));
  assert.match(embedded, /<style>@font-face\{font-family:"Latin Modern Math";src:url\(data:font\/woff2;base64,/);
  const plain = new Circuit();
  plain.addAnnotation('box', { x: 0, y: 0, end: { x: 80, y: 80 } });
  const svg = svgString(plain);
  assert.equal(await withEmbeddedMathFont(svg), svg);
});
