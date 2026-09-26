import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { evaluate, runCommand } from '../src/core/commands.js';
import { addPinRail } from '../src/core/pin-rails.js';

const leadOf = (circuit, comp, term) => circuit.netOfTerminal({ comp, term }).paths();

test('a pin facing the way the rail hangs gets a straight one-cell lead', () => {
  const circuit = new Circuit();
  runCommand(circuit, 'add nmos M1 --at 0 0');
  const ground = addPinRail(circuit, { comp: 'M1', term: 's' }, 'ground');
  assert.deepEqual([ground.transform.x, ground.transform.y], [0, 120]);
  assert.deepEqual(leadOf(circuit, 'M1', 's'), [[{ x: 0, y: 80 }, { x: 0, y: 120 }]]);
  assert.equal(circuit.netOfTerminal({ comp: 'M1', term: 's' }).name, 'VSS');
  runCommand(circuit, 'add pmos M2 --at 400 0');
  addPinRail(circuit, { comp: 'M2', term: 's' }, 'supply');
  assert.deepEqual(leadOf(circuit, 'M2', 's'), [[{ x: 400, y: -80 }, { x: 400, y: -120 }]]);
  assert.equal(circuit.netOfTerminal({ comp: 'M2', term: 's' }).name, 'VDD');
});

test('a sideways pin turns one cell toward the rail', () => {
  const circuit = new Circuit();
  runCommand(circuit, 'add nmos M1 --at 0 0');
  addPinRail(circuit, { comp: 'M1', term: 'g' }, 'supply');
  assert.deepEqual(leadOf(circuit, 'M1', 'g'), [[{ x: -120, y: 0 }, { x: -160, y: 0 }, { x: -160, y: -40 }]]);
});

test('a pin facing against the rail steps aside, away from its body', () => {
  const circuit = new Circuit();
  runCommand(circuit, 'add nmos M1 --at 0 0');
  const ground = addPinRail(circuit, { comp: 'M1', term: 'd' }, 'ground');
  assert.deepEqual([ground.transform.x, ground.transform.y], [80, -120]);
  assert.deepEqual(evaluate(circuit).issues.filter((issue) => issue.kind !== 'unconnected-terminal'), []);
});

test('a wired pin is refused and nothing is added', () => {
  const circuit = new Circuit();
  runCommand(circuit, 'add nmos M1 --at 0 0');
  addPinRail(circuit, { comp: 'M1', term: 's' }, 'ground');
  const count = circuit.components.size;
  assert.throws(() => addPinRail(circuit, { comp: 'M1', term: 's' }, 'supply'), /already wired/);
  assert.equal(circuit.components.size, count);
});

test('the rail command places a marker, or explains its usage', () => {
  const circuit = new Circuit();
  runCommand(circuit, 'add nmos M1 --at 0 0');
  const done = runCommand(circuit, 'rail M1.s gnd');
  assert.equal(done.mutated, true);
  assert.match(done.text, /GROUND1 \(ground\) on M1\.s/);
  assert.throws(() => runCommand(circuit, 'rail M1.d vcm'), /usage: rail/);
});
