import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit, normalizePlot } from '../src/core/model.js';
import { plotSpec } from '../src/core/plot-spec.js';
import { cursorLabel, cursorLayout, cursorReadings, cursorTitleRow, cursorValue, curveCrossings, placeCursorLabels, remapCursorTraces } from '../src/core/plot-cursors.js';
import { dataFigure } from '../src/core/bode-figure.js';
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
  const plot = data({ cursors: [{ kind: 'point', trace: 0, x: 2.5 }, { kind: 'vertical', x: 5, values: false }, { kind: 'horizontal', y: 4, values: true }, { kind: 'point', x: 1 }, { kind: 'diagonal', x: 1 }, { kind: 'vertical', x: 'a' }] });
  assert.deepEqual(plot.cursors, [{ kind: 'point', trace: 0, x: 2.5 }, { kind: 'vertical', x: 5, values: false }, { kind: 'horizontal', y: 4 }]);
  assert.equal(data().cursors, undefined);
  // A plot from before each marker had its Values: all off, each one off.
  const old = data({ cursors: [{ kind: 'vertical', x: 5 }, { kind: 'horizontal', y: 4 }], cursorValues: false });
  assert.deepEqual(old.cursors, [{ kind: 'vertical', x: 5, values: false }, { kind: 'horizontal', y: 4, values: false }]);
  assert.equal(old.cursorValues, undefined);
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

test('the layout draws only what the pane shows, and a marker\'s Values off leaves its numbers out', () => {
  const spec = plotSpec(data({ cursors: [{ kind: 'vertical', x: 5 }, { kind: 'vertical', x: 50 }] }));
  const toPx = { x: (u) => 10 * u, y: (v) => 100 - 10 * v };
  const pane = { x: 0, y: 0, w: 100, h: 100 };
  const layout = cursorLayout(spec, { toPx, pane });
  assert.equal(layout.lines.length, 1);
  assert.deepEqual(layout.dots.map((d) => [d.x, d.y]), [[50, 50], [50, 60]]);
  assert.deepEqual(layout.texts.map((t) => t.text).sort(), ['4', '5', '5']);
  assert.deepEqual(cursorLayout(spec, { toPx, pane, values: false }).texts, []);
  const one = plotSpec(data({ cursors: [{ kind: 'vertical', x: 5, values: false }, { kind: 'horizontal', y: 2 }] }));
  const mixed = cursorLayout(one, { toPx, pane });
  assert.equal(mixed.lines.length, 2);
  assert.equal(mixed.dots.length, 3);
  assert.deepEqual(mixed.texts.map((t) => t.text).sort(), ['2', '2']);
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
  setPlotCursors(box, [{ ...box.plot.cursors[0], values: false }]);
  assert.doesNotMatch(svgString(circuit), />4</);
  assert.deepEqual(remapCursorTraces({ cursors: [{ kind: 'point', trace: 3, x: 0 }] }, 2, [1, 0]), { cursors: [{ kind: 'point', trace: 2, x: 0 }] });
});

test('a marker\'s label writes an exponent as a power of ten', () => {
  assert.equal(cursorLabel(6.1523e-6), '6.152·10^{-6}');
  assert.equal(cursorLabel(-2.5e7), '-2.5·10^{7}');
  assert.equal(cursorLabel(0.25), '0.25');
});

test('a marker\'s number keeps off the traces where a spot near its point is free', () => {
  const pane = { x: 0, y: 0, w: 300, h: 200 };
  // A trace rising through the point, right and up of it: up-right would sit on it.
  const curves = [[{ x: 100, y: 100 }, { x: 200, y: 0 }]];
  const [label] = placeCursorLabels([{ x: 100, y: 100, text: '1.234' }], pane, { size: 10, curves });
  const box = label.box;
  assert.ok(!(box.x < 200 && box.x + box.w > 100 && box.y < 100 && box.y + box.h > 0 && box.y + box.h > 100 - (box.x + box.w - 100)), JSON.stringify(box));
  assert.ok(Math.abs(box.y - 100) < 30, 'still beside its point');
  // Moved out from its point, it has a leader to it; beside it, none.
  const crowded = placeCursorLabels([{ x: 100, y: 100, text: '1.234' }], pane, { size: 10, curves: [[{ x: 60, y: 140 }, { x: 160, y: 40 }], [{ x: 40, y: 100 }, { x: 160, y: 100 }]] })[0];
  if (crowded.leader) assert.ok(Math.hypot(crowded.leader.x1 - 100, crowded.leader.y1 - 100) <= 3.01, JSON.stringify(crowded.leader));
  // With no trace near, the first spot: up and right.
  const [free] = placeCursorLabels([{ x: 100, y: 100, text: '1.234' }], pane, { size: 10 });
  assert.ok(free.box.x > 100 && free.box.y + free.box.h < 100);
  assert.equal(free.leader, undefined);
});

test('a marker\'s number placed a row or more out from its point has a leader from the point to it', () => {
  const pane = { x: 0, y: 0, w: 300, h: 200 };
  // Five numbers on one point: four fill the spots beside it, the fifth goes a row out.
  const placed = placeCursorLabels(['a', 'b', 'c', 'd', 'e'].map((t) => ({ x: 100, y: 100, text: t.repeat(4) })), pane, { size: 10, gap: 3 });
  assert.ok(placed.slice(0, 4).every((p) => !p.leader));
  const second = placed[4];
  assert.ok(second.leader, JSON.stringify(second));
  const { x1, y1, x2, y2 } = second.leader;
  assert.ok(Math.abs(Math.hypot(x1 - 100, y1 - 100) - 3) < 1e-9, 'starts clear of the dot');
  const b = second.box;
  assert.ok(x2 >= b.x && x2 <= b.x + b.w && y2 >= b.y && y2 <= b.y + b.h, 'ends on its box');
});

test('a typed marker place takes a number or a calculator expression', () => {
  assert.equal(cursorValue('100'), 100);
  assert.equal(cursorValue(' -3.5e-2 '), -0.035);
  assert.equal(cursorValue('1/64'), 0.015625);
  assert.equal(cursorValue('2.7k/2.24M'), 2700 / 2.24e6);
  assert.equal(cursorValue('2pi*1k'), 2 * Math.PI * 1000);
  for (const bad of ['', 'abc', '1/0', '1+']) assert.equal(cursorValue(bad), null, bad);
});

test('a marker\'s label: a vertical line\'s over the plot, a horizontal one\'s at its right end, a point\'s before its numbers', () => {
  const plot = data({ cursors: [{ kind: 'vertical', x: 5, label: '  f_{c} ' }, { kind: 'horizontal', y: 4, label: 'limit' }, { kind: 'point', trace: 0, x: 2, label: 'A' }, { kind: 'point', trace: 0, x: 8, label: 'B', values: false }, { kind: 'vertical', x: 1, label: '' }] });
  assert.deepEqual(plot.cursors.map((c) => c.label), ['f_{c}', 'limit', 'A', 'B', undefined]);
  const spec = plotSpec(plot);
  const toPx = { x: (u) => 10 * u, y: (v) => 120 - 10 * v };
  const pane = { x: 0, y: 20, w: 100, h: 100 };
  const { texts } = cursorLayout(spec, { toPx, pane, size: 10, gap: 3 });
  const of = (text) => texts.find((t) => t.text === text);
  // Over the pane, centered on its line.
  const fc = of('f_{c}');
  assert.ok(fc.box.y + fc.box.h <= pane.y, JSON.stringify(fc.box));
  assert.ok(Math.abs(fc.box.x + fc.box.w / 2 - 50) < 1e-9);
  // Above its line, ending at the pane's right.
  const limit = of('limit');
  assert.ok(limit.box.y + limit.box.h <= 80 && limit.box.x + limit.box.w <= 100 && limit.box.x + limit.box.w > 90, JSON.stringify(limit.box));
  // A point's name leads its numbers; with Values off it stands alone.
  assert.ok(of('A: 2, 2'));
  assert.ok(of('B'));
  // The numbers keep off the names.
  const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  for (const t of texts.filter((t) => t !== fc && t !== limit)) assert.ok(!overlaps(t.box, limit.box), t.text);
  // A vertical line's label takes a row above the plot.
  assert.equal(cursorTitleRow(plot.cursors), true);
  assert.equal(cursorTitleRow([{ kind: 'horizontal', y: 1, label: 'a' }]), false);
  const top = (cursors) => dataFigure(data({ cursors }), { width: 400, height: 300, fontSize: 10 }).pane.y;
  assert.ok(top([{ kind: 'vertical', x: 5, label: 'a' }]) > top([{ kind: 'vertical', x: 5 }]));
});

test('a marker label in TeX draws as math on the drawing', () => {
  const circuit = new Circuit();
  circuit.addAnnotation('box', { x: 0, y: 0, end: { x: 720, y: 440 }, plot: data({ cursors: [{ kind: 'vertical', x: 5, label: '$2\\cdot f_s$' }] }) });
  const svg = svgString(circuit);
  assert.match(svg, /2·𝑓<tspan[^>]*>𝑠<\/tspan>/);
  assert.doesNotMatch(svg, /cdot|\$/);
});
