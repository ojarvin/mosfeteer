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
  // Its text is math: the math font, the corner's ω_{p1} in math italic.
  assert.match(svg, /font-family="&apos;Latin Modern Math&apos;[^"]*"[^>]*>𝜔<tspan[^>]*>𝑝1<\/tspan>/);
  assert.doesNotMatch(svg, /<rect x="0" y="0" width="640" height="400"/);
  // Its own paper, unframed, so the canvas grid stays out of the plot.
  assert.match(svg, /<rect class="plot-paper" x="0" y="0" width="640" height="400" fill="#fff" stroke="none"\/>/);
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

test('a plot whose range spans implausibly many decades is not kept', () => {
  // The range is in decades; a corrupt one would draw a tick per decade forever.
  assert.equal(normalizePlot({ ...plotData(), range: { low: 1, high: 1e6 } }), null);
  assert.ok(normalizePlot({ ...plotData(), range: { low: -3, high: 9 } }));
});

import { responseFigure, stepFigure, swingFigure } from '../src/core/bode-figure.js';

test('a plot annotated zoomed keeps its limits: saved, drawn at them, its curves cut to its pane', () => {
  const points = Array.from({ length: 200 }, (_, i) => { const f = 10 ** (-4 + (i * 3.7) / 199); return { f, db: 20 * Math.log10(f) }; });
  const plot = { kind: 'response', axis: 'normalized', range: { low: -4, high: Math.log10(0.5) }, traces: [{ label: 'H', color: '#3b74e0', points }], view: { x: [0.01, 0.05], y: [-45, -25] } };
  const kept = normalizePlot(plot);
  assert.deepEqual(kept.view, { x: [0.01, 0.05], y: [-45, -25] });
  // A broken or inverted limit is dropped; a frequency limit must be positive.
  assert.equal(normalizePlot({ ...plot, view: { x: [0.05, 0.01] } }).view, undefined);
  assert.equal(normalizePlot({ ...plot, view: { x: [0, 0.01], y: [-1, 1] } }).view.x, undefined);
  const figure = responseFigure(kept);
  const { pane } = figure;
  const curves = figure.items.filter((item) => item.role === 'curve');
  assert.ok(curves.length >= 1);
  for (const curve of curves) for (const p of curve.points) {
    assert.ok(p.x >= pane.x - 1e-6 && p.x <= pane.x + pane.w + 1e-6 && p.y >= pane.y - 1e-6 && p.y <= pane.y + pane.h + 1e-6, JSON.stringify(p));
  }
  // The axes read in the zoom: no decade ticks, numbers inside it.
  const numbers = figure.items.filter((item) => item.role === 'number').map((item) => item.text);
  assert.ok(numbers.includes('0.02') && numbers.includes('-40'), JSON.stringify(numbers));
  assert.ok(!numbers.includes('10^{-3}'));
  assert.deepEqual(figure.ranges.db, [-45, -25]);
  // A step plot and a swing plot the same way.
  const step = stepFigure({ kind: 'step', unit: 'n', range: { low: 0, high: 100 }, traces: [{ color: '#000', points: Array.from({ length: 101 }, (_, t) => ({ t, y: t / 10 })) }], view: { x: [20, 40], y: [1, 5] } });
  assert.deepEqual(step.ranges.y, [1, 5]);
  for (const curve of step.items.filter((item) => item.role === 'curve')) for (const p of curve.points) assert.ok(p.x >= step.pane.x - 1e-6 && p.x <= step.pane.x + step.pane.w + 1e-6);
  const swing = swingFigure({ kind: 'swing', range: { low: -60, high: 3 }, traces: [{ color: '#000', points: [{ a: -60, db: -50 }, { a: 0, db: 5 }] }], view: { x: [-20, 0], y: [-20, 0] } });
  assert.deepEqual(swing.ranges.db, [-20, 0]);
});

test('an annotated response plot lines each decade faintly under its numbered lines', () => {
  const points = Array.from({ length: 50 }, (_, i) => { const f = 10 ** (-3 + (i * 2.5) / 49); return { f, db: -20 * Math.log10(f) }; });
  const plot = normalizePlot({ kind: 'response', axis: 'normalized', range: { low: -3, high: Math.log10(0.5) }, traces: [{ label: 'H', color: '#3b74e0', points }] });
  const figure = responseFigure(plot, { width: 900, height: 500, fontSize: 20 });
  const minor = figure.items.filter((item) => item.role === 'minor');
  const grid = figure.items.filter((item) => item.role === 'grid' && item.x1 === item.x2);
  assert.ok(minor.length >= 16, `${minor.length}`);
  assert.ok(figure.items.indexOf(minor.at(-1)) < figure.items.indexOf(grid[0]), 'under the numbered lines');
  for (const line of minor) assert.ok(!grid.some((g) => Math.abs(g.x1 - line.x1) < 1e-6));
  const circuit = new Circuit();
  circuit.addAnnotation('box', { x: 0, y: 0, end: { x: 900, y: 500 }, plot });
  assert.match(svgString(circuit), /stroke-opacity="0.3"/);
});
