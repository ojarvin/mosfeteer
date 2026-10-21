import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { runCommand } from '../src/core/commands.js';
import { svgString } from '../src/core/render.js';
import { addPartsTable } from '../src/core/parts-table.js';
import {
  arrangeFigures, chooseFigure, coreBounds, figureBounds, figureSpot, listFigures, moveFigure, newFigureId, normalizeFigure, removeFigure,
} from '../src/core/figures.js';

const RESPONSE = { kind: 'response', range: { low: -2, high: 2 }, traces: [{ label: 'A', points: [{ f: 0.1, db: 0 }, { f: 10, db: -20 }] }] };
const run = (circuit, ...lines) => lines.map((line) => runCommand(circuit, line));

function amplifier() {
  const circuit = new Circuit();
  run(circuit, 'add nmos M1 --at 0 240', 'add resistor RD --at 40 0', 'connect M1.d RD.a --name VOUT');
  return circuit;
}

/** A math table label a tool put down, as figure-annotate.js does. */
function table(circuit, { kind = 'equations', source = 'small-signal', at = figureSpot(circuit, kind) } = {}) {
  const label = circuit.addLabel({ text: '\\text{Gain} & A_v = -g_m R_D', math: true, align: 'left', columns: 'll', x: 0, y: 0, figure: { id: newFigureId(circuit), kind, source } });
  const box = label.bbox();
  label.moveTo(at.x + box.w / 2, at.y + box.h / 2);
  return label;
}

test('a figure identity is kept with the design, on labels and parts alike', () => {
  assert.equal(normalizeFigure({ id: 'F1', kind: 'nope', source: 'x' }), null);
  assert.deepEqual(normalizeFigure({ id: 'F1', kind: 'plot', source: 'signal-flow', key: 'response::' }), { id: 'F1', kind: 'plot', source: 'signal-flow', key: 'response::' });
  const circuit = amplifier();
  const label = table(circuit);
  const loaded = Circuit.fromJSON(circuit.toJSON());
  const copy = loaded.labels.get(label.id);
  assert.deepEqual(copy.figure, label.figure);
  assert.equal(copy.columns, 'll');
  run(circuit, 'add resistor RM --at 2000 2000');
  circuit.components.get('RM').figure = { id: 'F9', kind: 'model', source: 'small-signal' };
  assert.deepEqual(Circuit.fromJSON(circuit.toJSON()).components.get('RM').figure, { id: 'F9', kind: 'model', source: 'small-signal' });
});

test('figures are listed with their members; plots, parts tables and timing labels from before are figures too', () => {
  const circuit = amplifier();
  const plot = circuit.addAnnotation('box', { x: 0, y: 800, end: { x: 400, y: 1200 }, plot: RESPONSE });
  circuit.addLabel({ text: '$A$', math: true, parent: plot.id, x: 500, y: 800 });
  addPartsTable(circuit);
  const kinds = listFigures(circuit).map((figure) => [figure.kind, figure.labels.length]);
  assert.deepEqual(kinds.sort(), [['plot', 2], ['table', 1]]);
  // A plot from before is any tool's of its kind: the one to update.
  assert.equal(chooseFigure(circuit, { kind: 'plot', source: 'small-signal', key: 'response::' })?.id, plot.id);
});

test('the figure annotating updates: the selected one, else the only one, else none', () => {
  const circuit = amplifier();
  const first = table(circuit);
  const identity = { kind: 'equations', source: 'small-signal' };
  assert.equal(chooseFigure(circuit, identity)?.id, first.figure.id);
  assert.equal(chooseFigure(circuit, { kind: 'equations', source: 'signal-flow' }), null, 'another tool\'s is not it');
  const second = table(circuit);
  assert.equal(chooseFigure(circuit, identity), null, 'two: a new one, unless one is picked');
  assert.equal(chooseFigure(circuit, identity, [second.id])?.id, second.figure.id);
});

test('tables go right of the circuit, one under another; plots and models below it', () => {
  const circuit = amplifier();
  const core = coreBounds(circuit);
  const right = figureSpot(circuit, 'equations');
  assert.ok(right.x > core.x + core.w);
  assert.equal(right.y, Math.floor(core.y / 40) * 40);
  const first = table(circuit);
  const box = first.bbox();
  const next = figureSpot(circuit, 'noise', { size: { w: box.w, h: 200 } });
  assert.equal(next.x, right.x);
  assert.ok(next.y >= box.y + box.h, 'under the first');
  // The tables are not the circuit: a plot still goes under the circuit.
  const size = { w: 400, h: 400 };
  const below = figureSpot(circuit, 'plot', { size });
  assert.equal(below.x, Math.floor(core.x / 40) * 40);
  assert.equal(below.y, Math.ceil((core.y + core.h) / 40) * 40 + 120);
  circuit.addAnnotation('box', { x: below.x, y: below.y, end: { x: below.x + 400, y: below.y + 400 }, plot: RESPONSE, figure: { id: newFigureId(circuit), kind: 'plot', source: 'signal-flow' } });
  const model = { ...figureSpot(circuit, 'model', { size }), ...size };
  for (const figure of listFigures(circuit)) {
    const r = figureBounds(circuit, figure);
    assert.ok(model.x + model.w <= r.x || r.x + r.w <= model.x || model.y + model.h <= r.y || r.y + r.h <= model.y, `clear of ${figure.kind}`);
  }
});

test('a figure moves and goes as one; Arrange puts each where a new one would go', () => {
  const circuit = amplifier();
  run(circuit, 'add resistor R9 --at 3000 3000', 'add capacitor C9 --at 3400 3000', 'connect R9.b C9.a');
  const figure = { id: 'F1', kind: 'model', source: 'small-signal' };
  for (const refdes of ['R9', 'C9']) circuit.components.get(refdes).figure = figure;
  const [model] = listFigures(circuit);
  const before = figureBounds(circuit, model);
  moveFigure(circuit, model, 80, -40);
  const after = figureBounds(circuit, listFigures(circuit)[0]);
  assert.deepEqual([after.x - before.x, after.y - before.y], [80, -40]);
  assert.ok(runCommand(circuit, 'figures').text.includes('F1 model (small-signal)'));
  // Arranged: under the circuit, at its left edge.
  const core = coreBounds(circuit);
  const moved = runCommand(circuit, 'figures --arrange');
  assert.equal(moved.json.moved, 1);
  const placed = figureBounds(circuit, listFigures(circuit)[0]);
  assert.equal(placed.x, Math.floor(core.x / 40) * 40);
  assert.ok(placed.y > core.y + core.h);
  assert.equal(arrangeFigures(circuit), 0, 'arranged already');
  removeFigure(circuit, listFigures(circuit)[0]);
  assert.equal(listFigures(circuit).length, 0);
  assert.ok(!circuit.components.has('R9') && ![...circuit.nets.values()].some((net) => net.terminals.some((t) => t.comp === 'C9')));
});

test('a math label with & is drawn as a table: columns, rules, and lines across them', () => {
  const circuit = new Circuit();
  circuit.addLabel({ text: '\\text{A} & x = 1\n\\hline\n\\text{all of it}', math: true, align: 'left', columns: 'll', x: 0, y: 0 });
  circuit.addLabel({ text: 'x = 1', math: true, x: 400, y: 0 });
  const svg = svgString(circuit);
  assert.equal((svg.match(/schematic-math-table/g) || []).length, 1);
  assert.match(svg, /grid-template-columns:repeat\(2,max-content\)/);
  assert.match(svg, /schematic-math-rule/);
  assert.match(svg, /grid-column:1 \/ -1/);
});

test('a new figure is packed clear of what is there: a tall table pushes a wide model under it', () => {
  const circuit = amplifier();
  const core = coreBounds(circuit);
  // A table much taller than the circuit, right of it.
  const tall = circuit.addAnnotation('box', { x: 0, y: 0, end: { x: 800, y: 2000 }, plot: RESPONSE, figure: { id: newFigureId(circuit), kind: 'equations', source: 'small-signal' } });
  const right = figureSpot(circuit, 'equations', { size: { w: 800, h: 2000 }, except: tall.figure.id });
  tall.moveTo(right.x, right.y);
  const table = figureBounds(circuit, listFigures(circuit)[0]);
  assert.ok(table.y + table.h > core.y + core.h + 400, 'it reaches far below the circuit');
  // A model wider than the circuit: under the circuit it would run into the table.
  const size = { w: core.w + 1200, h: 400 };
  const spot = figureSpot(circuit, 'model', { size });
  const model = { ...spot, ...size };
  const apart = (a, b) => a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
  assert.ok(apart(model, table), JSON.stringify({ model, table }));
  assert.ok(apart(model, core));
  // One narrow enough fits under the circuit, beside the table.
  const small = figureSpot(circuit, 'plot', { size: { w: 200, h: 200 } });
  assert.ok(small.y < table.y + table.h && small.y > core.y + core.h, JSON.stringify(small));
});
