import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { runCommand } from '../src/core/commands.js';
import { GRID } from '../src/core/grid.js';
import { svgString } from '../src/core/render.js';
import { lengthText, partsTableLayout, partsTableParts, tableParts } from '../src/core/parts-table.js';

function circuitWith(lines) {
  const circuit = new Circuit();
  for (const line of lines) runCommand(circuit, line);
  return circuit;
}

const parts = () => circuitWith([
  'add nmos M1 --at 0 0', 'add nmos M2 --at 400 0', 'add nmos M10 --at 800 0', 'add pmos M3 --at 0 -600',
  'add resistor R1 --at 400 -600', 'add capacitor C1 --at 800 -600', 'add ground G1 --at 0 400',
]);

const tableOf = (circuit) => [...circuit.labels.values()].find((label) => label.table);
const texts = (layout) => layout.items.filter((item) => item.type === 'text').map((item) => item.runs.map((run) => run.text).join(''));

test('the table lists transistors first, then passives and sources, each by name', () => {
  assert.deepEqual(tableParts(parts()).map((c) => c.refdes), ['M1', 'M2', 'M3', 'M10', 'C1', 'R1']);
});

test('lengths read with their unit: 2u is 2 µm, 400n is 400 nm', () => {
  assert.equal(lengthText('2u'), '2 µm');
  assert.equal(lengthText('400n'), '400 nm');
  assert.equal(lengthText('0.18u'), '0.18 µm');
});

test('size takes a comma list in one command, and checks every part before changing any', () => {
  const circuit = parts();
  const done = runCommand(circuit, 'size M1,M2,M3 2u/400n x4');
  assert.equal(done.mutated, true);
  assert.deepEqual(done.json.map((entry) => entry.refdes), ['M1', 'M2', 'M3']);
  for (const refdes of ['M1', 'M2', 'M3']) assert.deepEqual(circuit.components.get(refdes).size, { w: '2u', l: '400n', m: 4 });
  assert.throws(() => runCommand(circuit, 'size M10,R1 1u/1u'), /R1 is not a transistor/);
  assert.equal(circuit.components.get('M10').size, null, 'a rejected list changes nothing');
  assert.throws(() => runCommand(circuit, 'size M10 2q/1u'), /bad W/);
});

test('size ... hide keeps the size but draws no label; beside draws it again', () => {
  const circuit = parts();
  runCommand(circuit, 'size M1 2u/400n replace');
  runCommand(circuit, 'size M1 hide');
  assert.deepEqual(circuit.components.get('M1').size, { w: '2u', l: '400n', m: 1, replacesName: true, hidden: true });
  assert.equal(circuit.sizeLabelOf('M1'), null);
  assert.ok(!svgString(circuit).includes('W_{1}'), 'nothing drawn');
  // The name it stood in for comes back while the size is hidden.
  assert.equal(runCommand(circuit, 'size M1').text, 'M1 size 2u/400n (no label)');
  const reloaded = Circuit.fromJSON(JSON.parse(JSON.stringify(circuit.toJSON())));
  assert.equal(reloaded.components.get('M1').size.hidden, true, 'saved');
  assert.equal(reloaded.sizeLabelOf('M1'), null);
  runCommand(circuit, 'size M1 beside');
  assert.ok(circuit.sizeLabelOf('M1'));
  assert.equal(circuit.components.get('M1').size.hidden, undefined);
  assert.throws(() => runCommand(circuit, 'size M2 hide'), /M2 has no size to place/);
});

test('partstable puts a table under the drawing, sized to what it lists', () => {
  const circuit = parts();
  runCommand(circuit, 'size M1,M2 2u/400n x4');
  runCommand(circuit, 'size M3 10u/1u');
  runCommand(circuit, 'value R1 10k');
  const done = runCommand(circuit, 'partstable');
  assert.equal(done.mutated, true);
  assert.deepEqual(done.json.parts, ['M1', 'M2', 'M3', 'R1'], 'every sized or valued part');
  const table = tableOf(circuit);
  const drawn = circuit.inkBounds(0, { labels: (label) => !label.table });
  const box = table.bbox();
  assert.ok(box.y >= drawn.y + drawn.h, 'below the drawing');
  for (const side of [box.x, box.y, box.w, box.h]) assert.ok(Number.isInteger(side / GRID), 'on the grid');
  const layout = partsTableLayout(circuit, table.table);
  assert.deepEqual(texts(layout), ['W', 'L', 'm', 'M1', '2 µm', '400 nm', '4', 'M2', '2 µm', '400 nm', '4', 'M3', '10 µm', '1 µm', '1', 'Value', 'R1', '10k']);
  // Names keep their markup: M_{1} draws M with a subscript 1.
  assert.deepEqual(layout.items.find((item) => item.role === 'name').runs, [{ text: 'M' }, { text: '1', sub: true }]);
  assert.match(svgString(circuit), /class="parts-table"/);
});

test('a table follows the sizes: it grows, and its box with it, when a part is sized', () => {
  const circuit = parts();
  runCommand(circuit, 'size M1 2u/400n');
  runCommand(circuit, 'partstable --at 0 2000');
  const table = tableOf(circuit);
  const before = table.bbox();
  assert.deepEqual({ x: before.x, y: before.y }, { x: 0, y: 2000 });
  runCommand(circuit, 'size M2 20u/400n x8');
  const after = table.bbox();
  assert.ok(after.h > before.h, 'a row more');
  assert.ok(after.w > before.w, 'a wider W column and an m column');
  assert.equal(table.resizeBox({ x: 0, y: 2000, w: 4000, h: 4000 }), false, 'never resized by hand');
});

test('a table of chosen parts lists them even unsized, follows renames, and drops deleted parts', () => {
  const circuit = parts();
  runCommand(circuit, 'partstable M2 M1,R1');
  const table = tableOf(circuit);
  assert.deepEqual(partsTableParts(circuit, table.table).map((c) => c.refdes), ['M1', 'M2', 'R1']);
  assert.ok(texts(partsTableLayout(circuit, table.table)).includes('–'), 'a dash for an empty cell');
  runCommand(circuit, 'rename M2 M7');
  assert.deepEqual(table.table.parts, ['M7', 'M1', 'R1']);
  runCommand(circuit, 'rm R1');
  assert.deepEqual(partsTableParts(circuit, table.table).map((c) => c.refdes), ['M1', 'M7']);
  const reloaded = Circuit.fromJSON(JSON.parse(JSON.stringify(circuit.toJSON())));
  assert.deepEqual(tableOf(reloaded).table, { parts: ['M7', 'M1', 'R1'] });
});

test('partstable refuses a part a table cannot show, and an empty design gets a placeholder', () => {
  const circuit = parts();
  assert.throws(() => runCommand(circuit, 'partstable G1'), /G1 is a ground/);
  assert.equal(tableOf(circuit), undefined, 'nothing added');
  const empty = new Circuit();
  runCommand(empty, 'partstable');
  assert.deepEqual(texts(partsTableLayout(empty, tableOf(empty).table)), ['No sized parts']);
});
