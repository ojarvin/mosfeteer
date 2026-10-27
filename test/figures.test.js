import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { runCommand } from '../src/core/commands.js';
import { svgString } from '../src/core/render.js';
import { addPartsTable } from '../src/core/parts-table.js';
import {
  arrangeFigures, chooseFigure, coreBounds, figureBounds, listFigures, moveFigure, newFigureId, normalizeFigure, packed, placeFigure, removeFigure, settlePlaced,
} from '../src/core/figures.js';

const RESPONSE = { kind: 'response', range: { low: -2, high: 2 }, traces: [{ label: 'A', points: [{ f: 0.1, db: 0 }, { f: 10, db: -20 }] }] };
const run = (circuit, ...lines) => lines.map((line) => runCommand(circuit, line));

function amplifier() {
  const circuit = new Circuit();
  run(circuit, 'add nmos M1 --at 0 240', 'add resistor RD --at 40 0', 'connect M1.d RD.a --name VOUT');
  return circuit;
}

/** A math table label a tool put down, as figure-annotate.js does. */
function table(circuit, { kind = 'equations', source = 'small-signal' } = {}) {
  const label = circuit.addLabel({ text: '\\text{Gain} & A_v = -g_m R_D', math: true, align: 'left', columns: 'll', x: 0, y: 0, figure: { id: newFigureId(circuit), kind, source } });
  const box = label.bbox();
  const at = placeFigure(circuit, kind, { size: box, except: label.figure.id });
  label.moveTo(at.x + box.w / 2, at.y + box.h / 2);
  settlePlaced(circuit, label.figure.id);
  return label;
}

/** A box figure of `size` placed by packing, as a plot or model would be. */
function block(circuit, kind, size) {
  const figure = { id: newFigureId(circuit), kind, source: 'test' };
  const at = placeFigure(circuit, kind, { size });
  const box = circuit.addAnnotation('box', { x: at.x, y: at.y, end: { x: at.x + size.w, y: at.y + size.h }, figure });
  settlePlaced(circuit, figure.id);
  return box;
}

const apart = (a, b) => a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;

/** Every figure clear of the circuit and of each other. */
function assertClear(circuit) {
  const rects = [coreBounds(circuit), ...listFigures(circuit).map((figure) => figureBounds(circuit, figure))];
  rects.forEach((a, i) => rects.slice(i + 1).forEach((b) => assert.ok(apart(a, b), JSON.stringify({ a, b }))));
}

/** The whole drawing's extent. */
function extent(circuit) {
  const rects = [coreBounds(circuit), ...listFigures(circuit).map((figure) => figureBounds(circuit, figure))];
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  return { w: Math.max(...rects.map((r) => r.x + r.w)) - x, h: Math.max(...rects.map((r) => r.y + r.h)) - y };
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

test('a signal-flow coefficients table is a figure of its own, kept with the design and placed right of the circuit under the equations', () => {
  assert.deepEqual(normalizeFigure({ id: 'F1', kind: 'coefficients', source: 'signal-flow' }), { id: 'F1', kind: 'coefficients', source: 'signal-flow' });
  const circuit = amplifier();
  const equations = table(circuit, { source: 'signal-flow' });
  const coefficients = table(circuit, { kind: 'coefficients', source: 'signal-flow' });
  assert.deepEqual(Circuit.fromJSON(circuit.toJSON()).labels.get(coefficients.id).figure.kind, 'coefficients');
  const core = coreBounds(circuit);
  const [above, below] = [equations.bbox(), coefficients.bbox()];
  assert.ok(below.x >= core.x + core.w && below.y >= above.y + above.h, JSON.stringify({ core, above, below }));
  assertClear(circuit);
  assert.equal(chooseFigure(circuit, { kind: 'coefficients', source: 'signal-flow' })?.id, coefficients.figure.id);
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

test('a first table goes right of the circuit at its top, a first plot under it at its left edge', () => {
  const circuit = amplifier();
  const core = coreBounds(circuit);
  const first = table(circuit).bbox();
  assert.ok(first.x > core.x + core.w);
  assert.equal(first.y, Math.floor(core.y / 40) * 40);
  const other = amplifier();
  const plot = block(other, 'plot', { w: 200, h: 200 }).bbox();
  assert.equal(plot.x, Math.floor(core.x / 40) * 40);
  assert.equal(plot.y, Math.ceil((core.y + core.h) / 40) * 40 + 120);
});

test('figures are packed as one: whatever the order, the drawing is as small, and nothing overlaps', () => {
  const sizes = [['equations', { w: 1200, h: 2400 }], ['model', { w: 2400, h: 600 }], ['plot', { w: 800, h: 480 }]];
  const areas = [];
  for (const order of [[0, 1, 2], [1, 0, 2], [2, 1, 0]]) {
    const circuit = amplifier();
    for (const index of order) block(circuit, ...sizes[index]);
    assertClear(circuit);
    const { w, h } = extent(circuit);
    areas.push(w * h);
  }
  assert.equal(new Set(areas).size, 1, areas.join(', '));
});

test('a figure moved by hand stays where it was put; packing works around it', () => {
  const circuit = amplifier();
  const moved = block(circuit, 'plot', { w: 400, h: 400 });
  moved.moveTo(moved.anchor.x + 2000, moved.anchor.y);
  const [figure] = listFigures(circuit);
  assert.equal(packed(circuit, figure), false);
  const at = moved.bbox();
  block(circuit, 'model', { w: 1200, h: 400 });
  block(circuit, 'equations', { w: 800, h: 1200 });
  assert.deepEqual(moved.bbox(), at);
  assertClear(circuit);
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
  // Moved by whole cells: its ink within half a cell of the circuit's left edge.
  assert.ok(Math.abs(placed.x - Math.floor(core.x / 40) * 40) <= 20, `${placed.x} vs ${core.x}`);
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

test('a tall table and a wide model are packed clear of each other, the model under the circuit', () => {
  const circuit = amplifier();
  const core = coreBounds(circuit);
  block(circuit, 'equations', { w: 800, h: 2000 });
  const model = block(circuit, 'model', { w: core.w + 1200, h: 400 }).bbox();
  assertClear(circuit);
  assert.ok(model.y > core.y + core.h);
});
