import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { runCommand } from '../src/core/commands.js';
import { svgString } from '../src/core/render.js';
import { swapComponentType } from '../src/core/swap.js';
import { MOS_SIZE_ROLE, formatMosSize, mosSizeTex, parseMosSize, sizeReplacedNameLabels, sizeSubscript } from '../src/core/mos-size.js';

const run = (circuit, line) => runCommand(circuit, line);

test('parseMosSize reads W/L with prefixes, units, and a multiplier', () => {
  assert.deepEqual(parseMosSize('2u/400n'), { w: '2u', l: '400n', m: 1 });
  assert.deepEqual(parseMosSize('2um/0.4um x4'), { w: '2u', l: '0.4u', m: 4 });
  assert.deepEqual(parseMosSize('4*2µ/400nm'), { w: '2u', l: '400n', m: 4 });
  assert.deepEqual(parseMosSize('2μ/400n m=2'), { w: '2u', l: '400n', m: 2 });
  assert.deepEqual(parseMosSize('W=10u L=1u M=3'), { w: '10u', l: '1u', m: 3 });
  // A bare number is in micrometres, as sizes are written on schematics.
  assert.deepEqual(parseMosSize('2/0.18'), { w: '2u', l: '0.18u', m: 1 });
  for (const bad of ['', '2u', '2u/400n/1', '2q/400n', '0/1u', '2u/400n x0', '2u/400n x1.5']) {
    assert.throws(() => parseMosSize(bad), undefined, bad);
  }
});

test('the size label is TeX: W and L take the name, the multiplier shows only past 1', () => {
  assert.equal(sizeSubscript('M_{1}', 'M1'), '1');
  assert.equal(sizeSubscript('M_{in}', 'Min'), 'in');
  assert.equal(sizeSubscript('M3', 'M3'), '3');
  assert.equal(mosSizeTex({ w: '2u', l: '400n', m: 1 }, '1'), '$\\frac{W_{1}}{L_{1}} = \\frac{\\mathrm{2\\,μm}}{\\mathrm{400\\,nm}}$');
  assert.equal(mosSizeTex({ w: '2u', l: '400n', m: 4 }, '1'), '$\\frac{W_{1}}{L_{1}} = 4\\cdot\\frac{\\mathrm{2\\,μm}}{\\mathrm{400\\,nm}}$');
  assert.equal(formatMosSize({ w: '2u', l: '400n', m: 4 }), '2u/400n x4');
  assert.equal(formatMosSize({ w: '2u', l: '400n', m: 1 }), '2u/400n');
});

test('size command adds, places, prints, and removes a transistor size label', () => {
  const circuit = new Circuit();
  run(circuit, 'add nmos --at 200 200');
  const out = run(circuit, 'size M1 2u/400n x4');
  assert.equal(out.mutated, true);
  assert.deepEqual(circuit.components.get('M1').size, { w: '2u', l: '400n', m: 4 });
  const label = circuit.sizeLabelOf('M1');
  assert.equal(label.role, MOS_SIZE_ROLE);
  assert.equal(label.math, true);
  assert.match(label.text, /W_\{1\}/);
  // Under the name label, growing away from the part like the name does.
  assert.deepEqual(label.offset, { x: 40, y: 120 });
  assert.equal(label.textAlign(), 'left');
  assert.equal(circuit.labelOf('M1').role, null, 'the name label stays the identity label');

  run(circuit, 'size M1 replace');
  assert.equal(circuit.components.get('M1').size.replacesName, true);
  assert.deepEqual(label.offset, circuit.labelOf('M1').offset);
  assert.deepEqual([...sizeReplacedNameLabels(circuit)], [circuit.labelOf('M1').id]);
  // A new size keeps the placement.
  run(circuit, 'size M1 1u/1u');
  assert.equal(circuit.components.get('M1').size.replacesName, true);
  assert.match(run(circuit, 'size M1').text, /1u\/1u \(in place of its name\)/);

  run(circuit, 'size M1 beside');
  assert.deepEqual(label.offset, { x: 40, y: 120 });
  assert.equal(sizeReplacedNameLabels(circuit).size, 0);

  run(circuit, 'size M1 off');
  assert.equal(circuit.components.get('M1').size, null);
  assert.equal(circuit.sizeLabelOf('M1'), null);
});

test('size command rejects non-transistors and bad sizes without changing the circuit', () => {
  const circuit = new Circuit();
  run(circuit, 'add resistor --at 0 0');
  run(circuit, 'add nmos --at 400 0');
  assert.throws(() => run(circuit, 'size R1 2u/400n'), /only MOS parts/);
  assert.throws(() => run(circuit, 'size M1 2u'), /W\/L/);
  assert.throws(() => run(circuit, 'size M1 replace'), /no size/);
  assert.equal(circuit.components.get('M1').size, null);
  assert.equal(circuit.sizeLabelOf('M1'), null);
});

test('a size survives save and load, follows renames, and goes with its label', () => {
  const circuit = new Circuit();
  run(circuit, 'add pmos --at 200 200');
  run(circuit, 'size M1 2u/400n');
  circuit.sizeLabelOf('M1').offset = { x: 80, y: -160 };
  run(circuit, 'rename M1 M_{in}');
  assert.match(circuit.sizeLabelOf('Min').text, /W_\{in\}/);

  const loaded = Circuit.fromJSON(JSON.parse(JSON.stringify(circuit.toJSON())));
  const label = loaded.sizeLabelOf('Min');
  assert.deepEqual(loaded.components.get('Min').size, { w: '2u', l: '400n', m: 1 });
  assert.deepEqual(label.offset, { x: 80, y: -160 }, 'a moved size label stays where it was put');
  assert.equal([...loaded.labels.values()].filter((l) => l.role === MOS_SIZE_ROLE).length, 1);

  loaded.removeLabel(label.id);
  assert.equal(loaded.components.get('Min').size, null);
});

test('a replaced name label is not drawn; the size label is', () => {
  const circuit = new Circuit();
  run(circuit, 'add nmos --at 200 200');
  run(circuit, 'size M1 2u/400n replace');
  const svg = svgString(circuit);
  assert.doesNotMatch(svg, /Instance label M_\{1\}/);
  assert.match(svg, /Instance label \$\\frac/);
});

test('a size stays through a swap to another transistor and goes with any other type', () => {
  const circuit = new Circuit();
  run(circuit, 'add nmos M1 --at 0 0');
  run(circuit, 'size M1 2u/400n');
  swapComponentType(circuit, 'M1', 'nmosb');
  // The bulk symbol's name slot is higher; the size label follows it.
  assert.deepEqual(circuit.sizeLabelOf('M1').offset, { x: 40, y: 80 });
  swapComponentType(circuit, 'M1', 'pmosb');
  assert.ok(circuit.sizeLabelOf('M1'));
  swapComponentType(circuit, 'M1', 'npn');
  const part = [...circuit.components.values()][0];
  assert.equal(part.size, null);
  assert.equal([...circuit.labels.values()].some((l) => l.role === MOS_SIZE_ROLE), false);
});
