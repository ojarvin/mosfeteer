import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { runCommand } from '../src/core/commands.js';
import { svgString } from '../src/core/render.js';
import { busMarkD, busMarkPoints, busWidth } from '../src/core/bus.js';

test('bus names carry a bit range in brackets or angle brackets', () => {
  assert.equal(busWidth('D[7:0]'), 8);
  assert.equal(busWidth('D<3:0>'), 4);
  assert.equal(busWidth('code<0:5>'), 6);
  assert.equal(busWidth('D_{out}[1:0]'), 2);
  for (const name of ['D', 'VDD', '[3:0]', 'D[3]', 'D[a:b]', '', null]) assert.equal(busWidth(name), 0, String(name));
});

test('a bus slash sits mid-way along each branch\'s longest straight run, clear of its labels', () => {
  const path = [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 320 }];
  assert.deepEqual(busMarkPoints([path]), [{ x: 80, y: 160, horizontal: false }]);
  assert.deepEqual(busMarkPoints([path], [{ x: 80, y: 160 }]), [{ x: 80, y: 120, horizontal: false }]);
  assert.deepEqual(busMarkPoints([[{ x: 0, y: 0 }, { x: 200, y: 0 }]]), [{ x: 100, y: 0, horizontal: true }]);
  // A diagonal keeps its own look; a slash is one cell tall.
  assert.deepEqual(busMarkPoints([[{ x: 0, y: 0 }, { x: 80, y: 80 }]]), []);
  assert.equal(busMarkD({ x: 100, y: 0, horizontal: true }), 'M 85 20 L 115 -20');
});

test('a net named as a bus draws its slash; renaming it plain removes it', () => {
  const circuit = new Circuit();
  runCommand(circuit, 'add adc U1 --at 0 0');
  runCommand(circuit, 'add output D --at 600 0');
  runCommand(circuit, 'connect U1.d D.p --name D[7:0]');
  const marks = (svg) => (svg.match(/class="bus-mark"/g) || []).length;
  assert.equal(marks(svgString(circuit)), 1);
  circuit.renameNet(circuit.netOfTerminal({ comp: 'U1', term: 'd' }), 'D');
  assert.equal(marks(svgString(circuit)), 0);
});
