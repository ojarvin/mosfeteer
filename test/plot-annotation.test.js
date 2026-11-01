import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit, normalizePlot } from '../src/core/model.js';
import { svgString } from '../src/core/render.js';
import { loadDocument } from '../src/core/document.js';
import { bodeSketch } from '../src/core/analysis/bode.js';
import { copyableLabelPayload } from '../src/web/selection.js';
import { runCommand } from '../src/core/commands.js';

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

/** A two-trace response plot on the drawing, with its legend as the
 *  editor places it: in black, the legend past its samples' room. */
function twoTracePlot({ black = true } = {}) {
  const c = new Circuit();
  const points = (db) => [{ f: 0.01, db }, { f: 1, db: db - 20 }, { f: 10, db: db - 40 }];
  const plot = { kind: 'response', range: { low: -2, high: 1 }, traces: [{ label: 'A', color: '#3b74e0', points: points(0) }, { label: 'B', color: '#df4d59', points: points(-10) }] };
  const box = c.addAnnotation('box', { x: 0, y: 0, end: { x: 720, y: 440 }, plot, style: { lineStyle: 'solid', ...(black ? { blackTraces: true } : {}) } });
  const legend = ['A', 'B'].map((name, i) => c.addLabel({ text: `$${name}$`, math: true, parent: box.id, role: 'plot-legend', align: 'left', x: 880, y: 40 + 80 * i, style: { color: plot.traces[i].color } }));
  return { c, box, legend };
}

test('a plot in black draws its traces in its ink, each with its own dash, and its legend in ink with a line sample each', () => {
  const { c } = twoTracePlot();
  const svg = svgString(c);
  const plotSvg = svg.match(/<g class="plot-annotation"[^]*?<\/g>/)[0];
  assert.doesNotMatch(plotSvg, /#3b74e0|#df4d59/, 'no trace colors');
  const curves = [...plotSvg.matchAll(/<path d="[^"]*" stroke="#111" stroke-width="6"([^/]*)\/>/g)].map((m) => m[1]);
  assert.ok(curves.some((attrs) => !/dasharray/.test(attrs)), 'the first trace solid');
  assert.ok(curves.some((attrs) => /stroke-dasharray="28 14"/.test(attrs)), 'the second dashed');
  const samples = [...plotSvg.matchAll(/class="plot-legend-sample"([^/]*)/g)].map((m) => m[1]);
  assert.equal(samples.length, 2);
  assert.doesNotMatch(samples[0], /dasharray/);
  assert.match(samples[1], /stroke-dasharray="28 14"/);
  assert.doesNotMatch(svg, /color:#df4d59/, 'the legend in ink, not its own color');
});

test('a plot from before keeps its colors; plotcolors switches it, moving the legend by the samples\' room, as one command', () => {
  const { c, box, legend } = twoTracePlot({ black: false });
  assert.match(svgString(c), /#df4d59/);
  assert.doesNotMatch(svgString(c), /plot-legend-sample/);
  const before = legend.map((label) => label.anchor.x);
  runCommand(c, `annotation plotcolors ${box.id} off`);
  assert.equal(c.labels.get(box.id).style.blackTraces, true);
  assert.deepEqual(legend.map((label) => label.anchor.x), before.map((x) => x + 120));
  assert.match(svgString(c), /plot-legend-sample/);
  assert.equal(c.labels.get(box.id).toJSON().style.blackTraces, true, 'saved with the plot');
  runCommand(c, `annotation plotcolors ${box.id} on`);
  assert.deepEqual(legend.map((label) => label.anchor.x), before);
  assert.equal('blackTraces' in c.labels.get(box.id).style, false);
  assert.throws(() => runCommand(c, `annotation plotcolors ${legend[0].id} on`), /usage: annotation plotcolors PLOT on\|off/, 'a legend is not a plot');
});

test('a plot\'s axis titles are outside its frame, the x under its numbers and the y turned up beside them, each naming its unit', () => {
  const plot = normalizePlot({ kind: 'response', axis: 'normalized', range: { low: -3, high: 0 }, traces: [{ label: 'H', color: '#3b74e0', points: [{ f: 0.001, db: 0 }, { f: 1, db: -40 }] }] });
  const { items, pane } = responseFigure(plot, { width: 720, height: 440, fontSize: 30 });
  const x = items.find((item) => item.text === 'Frequency (f/f_{s})');
  const y = items.find((item) => item.text === 'Magnitude |H| (dB)');
  assert.ok(x && x.y > pane.y + pane.h && x.anchor === 'middle', JSON.stringify(x));
  assert.ok(y && y.x < pane.x && y.rotate === -90, JSON.stringify(y));
  const numbers = items.filter((item) => item.role === 'number');
  assert.ok(numbers.every((n) => (n.y > pane.y + pane.h ? n.y < x.y : n.x > y.x)), 'titles outside the numbers');
  const c = new Circuit();
  c.addAnnotation('box', { x: 0, y: 0, end: { x: 720, y: 440 }, plot });
  assert.match(svgString(c), /transform="rotate\(-90 [\d.]+ [\d.]+\)"[^>]*>Magnitude \|/);
});

test('a lone curve has its line sample too; a note after the curves (an SNDR) has none and stays when colors are switched', () => {
  const c = new Circuit();
  const plot = { kind: 'response', range: { low: -2, high: 1 }, traces: [{ label: 'A', color: '#3b74e0', points: [{ f: 0.01, db: 0 }, { f: 10, db: -40 }] }] };
  const box = c.addAnnotation('box', { x: 0, y: 0, end: { x: 720, y: 440 }, plot, style: { lineStyle: 'solid', blackTraces: true } });
  const name = c.addLabel({ text: '$A$', math: true, parent: box.id, role: 'plot-legend', align: 'left', x: 880, y: 40 });
  const note = c.addLabel({ text: '$\\text{SNDR 80 dB}$', math: true, parent: box.id, role: 'plot-legend', align: 'left', x: 760, y: 160 });
  assert.equal((svgString(c).match(/class="plot-legend-sample"/g) || []).length, 1, 'one sample, for the curve');
  const at = { name: name.anchor.x, note: note.anchor.x };
  runCommand(c, `annotation plotcolors ${box.id} on`);
  assert.equal(name.anchor.x, at.name - 120);
  assert.equal(note.anchor.x, at.note, 'the note stays');
});
