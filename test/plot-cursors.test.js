import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit, normalizePlot } from '../src/core/model.js';
import { plotSpec } from '../src/core/plot-spec.js';
import { cursorLabel, cursorLayout, cursorReadings, curveCrossings, placeCursorLabels, remapCursorTraces } from '../src/core/plot-cursors.js';
import { movePlotTrace, removePlotTrace, setPlotCursors } from '../src/core/data-plot.js';
import { svgString } from '../src/core/render.js';

const data = (extra = {}) => normalizePlot({
  kind: 'data',
  x: { label: 't', scale: 'linear' },
  y: { label: 'v', scale: 'linear' },
  traces: [
    { label: 'ramp', color: '#3b74e0', points: [[0, 0], [10, 10]] },
    { label: 'flat', color: '#e03b3b', points: [[0, 4], [10, 4]] },
  ],
  ...extra,
});

test('a plot keeps its markers, checked; a point names its trace by id', () => {
  const plot = data({ cursors: [{ kind: 'point', trace: 0, x: 2.5 }, { kind: 'vertical', x: 5 }, { kind: 'horizontal', y: 4 }, { kind: 'point', x: 1 }, { kind: 'diagonal', x: 1 }, { kind: 'vertical', x: 'a' }], cursorValues: false });
  assert.deepEqual(plot.cursors, [{ kind: 'point', trace: 0, x: 2.5 }, { kind: 'vertical', x: 5 }, { kind: 'horizontal', y: 4 }]);
  assert.equal(plot.cursorValues, false);
  assert.equal(data().cursors, undefined);
  assert.equal(data({ cursorValues: true }).cursorValues, undefined);
  // The spec carries them, its series their trace ids.
  const spec = plotSpec(plot);
  assert.deepEqual(spec.cursors, plot.cursors);
  assert.deepEqual(spec.series.map((s) => s.trace), [0, 1]);
});

test('a point reads its trace; a vertical line each trace\'s y; a horizontal one each trace\'s x', () => {
  const spec = plotSpec(data({ cursors: [{ kind: 'point', trace: 0, x: 2.5 }, { kind: 'vertical', x: 5 }, { kind: 'horizontal', y: 4 }, { kind: 'point', trace: 1, x: 20 }] }));
  const [point, vertical, horizontal, ...rest] = cursorReadings(spec);
  assert.deepEqual(point.hits.map((h) => h.text), ['2.5, 2.5']);
  assert.deepEqual(vertical.hits.map((h) => h.text), ['5', '4']);
  assert.equal(vertical.text, '5');
  // The ramp crosses 4 at 4; the flat trace lies on it from its start.
  assert.deepEqual(horizontal.hits.map((h) => h.text), ['4', '0']);
  assert.deepEqual(rest, [], 'a point off its trace reads nothing');
  // Stairs cross at their step.
  assert.deepEqual(curveCrossings({ stairs: true, points: [[0, 0], [1, 0], [2, 3]] }, 1), [2]);
});

test('on a log axis a marker reads in the data\'s units', () => {
  const plot = normalizePlot({
    kind: 'data', x: { label: 'f', scale: 'log' }, y: { label: 'g', scale: 'log' },
    traces: [{ label: 'g', color: '#3b74e0', points: [[1, 1], [100, 10000]] }],
    cursors: [{ kind: 'point', trace: 0, x: 10 }, { kind: 'horizontal', y: 1000 }],
  });
  const [point, horizontal] = cursorReadings(plotSpec(plot));
  assert.equal(point.hits[0].text, '10, 100');
  assert.equal(horizontal.hits[0].text, '31.62');
});

test('marker numbers never overlap one another or a marked point, and stay in the pane', () => {
  const pane = { x: 0, y: 0, w: 300, h: 200 };
  const labels = Array.from({ length: 6 }, (_, i) => ({ x: 150, y: 100 + i, text: `${i}.000, 12.34` }));
  const placed = placeCursorLabels(labels, pane, { size: 10 });
  const boxes = placed.map((p) => p.box);
  for (const [i, a] of boxes.entries()) {
    assert.ok(a.x >= pane.x && a.y >= pane.y && a.x + a.w <= pane.x + pane.w && a.y + a.h <= pane.y + pane.h, `${i} inside`);
    for (const b of boxes.slice(i + 1)) assert.ok(a.x >= b.x + b.w || b.x >= a.x + a.w || a.y >= b.y + b.h || b.y >= a.y + a.h, `${JSON.stringify(a)} ${JSON.stringify(b)}`);
    for (const l of labels) assert.ok(!(l.x > a.x && l.x < a.x + a.w && l.y > a.y && l.y < a.y + a.h), 'clear of the points');
  }
  // Near the right edge a label goes left of its point.
  assert.equal(placeCursorLabels([{ x: 295, y: 100, text: '1.234, 5.678' }], pane)[0].box.x < 295, true);
});

test('the layout draws only what the pane shows, and Values off leaves the numbers out', () => {
  const spec = plotSpec(data({ cursors: [{ kind: 'vertical', x: 5 }, { kind: 'vertical', x: 50 }] }));
  const toPx = { x: (u) => 10 * u, y: (v) => 100 - 10 * v };
  const pane = { x: 0, y: 0, w: 100, h: 100 };
  const layout = cursorLayout(spec, { toPx, pane });
  assert.equal(layout.lines.length, 1);
  assert.deepEqual(layout.dots.map((d) => [d.x, d.y]), [[50, 50], [50, 60]]);
  assert.deepEqual(layout.texts.map((t) => t.text).sort(), ['4', '5', '5']);
  assert.deepEqual(cursorLayout({ ...spec, cursorValues: false }, { toPx, pane }).texts, []);
});

test('markers go on the drawing\'s plot, and follow their traces when they move or go', () => {
  const circuit = new Circuit();
  const box = circuit.addAnnotation('box', { x: 0, y: 0, end: { x: 720, y: 440 }, plot: data() });
  assert.equal(setPlotCursors(box, [{ kind: 'point', trace: 1, x: 3 }, { kind: 'horizontal', y: 4 }]), true);
  assert.equal(setPlotCursors(box, [{ kind: 'point', trace: 1, x: 3 }, { kind: 'horizontal', y: 4 }]), false);
  const svg = svgString(circuit);
  assert.equal((svg.match(/class="plot-cursor"/g) || []).length, 1);
  assert.equal((svg.match(/class="plot-cursor-dot"/g) || []).length, 3);
  assert.match(svg, />3, 4</);
  movePlotTrace(circuit, box, 1, 0);
  assert.deepEqual(box.plot.cursors[0], { kind: 'point', trace: 0, x: 3 });
  removePlotTrace(circuit, box, 0);
  assert.deepEqual(box.plot.cursors, [{ kind: 'horizontal', y: 4 }]);
  setPlotCursors(box, box.plot.cursors, { values: false });
  assert.doesNotMatch(svgString(circuit), />4</);
  assert.deepEqual(remapCursorTraces({ cursors: [{ kind: 'point', trace: 3, x: 0 }] }, 2, [1, 0]), { cursors: [{ kind: 'point', trace: 2, x: 0 }] });
});

test('a marker\'s label writes an exponent as a power of ten', () => {
  assert.equal(cursorLabel(6.1523e-6), '6.152·10^{-6}');
  assert.equal(cursorLabel(-2.5e7), '-2.5·10^{7}');
  assert.equal(cursorLabel(0.25), '0.25');
});
