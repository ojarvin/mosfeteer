import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit, normalizePlot } from '../src/core/model.js';
import { svgString } from '../src/core/render.js';
import { loadDocument } from '../src/core/document.js';
import { bodeSketch } from '../src/core/analysis/bode.js';
import { copyableLabelPayload } from '../src/web/selection.js';

function plotData() {
  const sketch = bodeSketch([100], [1, 100]);
  return { ...sketch, corners: [{ w: 0.01, text: 'ω_{p1}' }], quantity: 'A_{v}', phase: false };
}

test('a plot is kept as plain rounded numbers, and a broken one is dropped', () => {
  const plot = normalizePlot(plotData());
  assert.equal(plot.quantity, 'A_{v}');
  assert.deepEqual(plot.corners, [{ w: 0.01, text: 'ω_{p1}' }]);
  assert.ok(plot.points.length > 10);
  assert.deepEqual(JSON.parse(JSON.stringify(plot)), plot);
  assert.equal(normalizePlot({ range: { low: 0, high: 0 }, points: [] }), null);
  assert.equal(normalizePlot('nonsense'), null);
});

test('a box carrying a plot saves, loads, and draws the sketch instead of a frame', () => {
  const circuit = new Circuit();
  const box = circuit.addAnnotation('box', { x: 0, y: 0, end: { x: 640, y: 400 }, plot: plotData(), style: { lineStyle: 'solid' } });
  assert.ok(box.plot);
  const loaded = loadDocument(JSON.parse(JSON.stringify(circuit.toJSON())));
  const again = [...loaded.labels.values()].find((label) => label.kind === 'box');
  assert.deepEqual(again.plot, box.plot);
  const svg = svgString(loaded);
  assert.match(svg, /class="plot-annotation"/);
  assert.match(svg, /ω<tspan[^>]*>p1<\/tspan>/);
  assert.doesNotMatch(svg, /<rect x="0" y="0" width="640" height="400"/);
  // A plain box is still a frame.
  const plain = new Circuit();
  plain.addAnnotation('box', { x: 0, y: 0, end: { x: 80, y: 80 } });
  assert.doesNotMatch(svgString(plain), /plot-annotation/);
});

test('copying a plot copies its sketch', () => {
  const circuit = new Circuit();
  const box = circuit.addAnnotation('box', { x: 0, y: 0, end: { x: 640, y: 400 }, plot: plotData() });
  const payload = copyableLabelPayload(box);
  assert.deepEqual(payload.plot, box.plot);
  const copy = circuit.addAnnotation('box', { x: 800, y: 0, end: { x: 1440, y: 400 }, plot: payload.plot });
  assert.deepEqual(copy.plot, box.plot);
});
