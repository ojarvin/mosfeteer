import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { runCommand } from '../src/core/commands.js';
import { renumberPlan } from '../src/core/renumber.js';

const run = (circuit, ...lines) => lines.map((line) => runCommand(circuit, line));
const at = (circuit) => Object.fromEntries([...circuit.components.values()].map((c) => [`${c.transform.x},${c.transform.y}`, c.refdes]));

function drawing() {
  const circuit = new Circuit();
  // Added out of order: M1 bottom right, M2 top left, M3 top right.
  run(circuit, 'add nmos --at 400 400', 'add nmos --at 0 0', 'add pmos --at 400 0', 'add resistor --at 0 400',
    'add resistor R_{load} --at 800 0', 'add input VIN --at -400 0', 'add ground --at 0 800');
  return circuit;
}

test('renumber grows the numbers diagonally, per prefix, and keeps hand-made names', () => {
  const circuit = drawing();
  const named = ['Rload', 'VIN'];
  const { json } = runCommand(circuit, 'renumber');
  assert.deepEqual(json.renames, [{ from: 'M2', to: 'M1' }, { from: 'M3', to: 'M2' }, { from: 'M1', to: 'M3' }]);
  assert.deepEqual(at(circuit)['0,0'], 'M1');
  assert.deepEqual(at(circuit)['400,0'], 'M2');
  assert.deepEqual(at(circuit)['400,400'], 'M3');
  for (const name of named) assert.ok(circuit.components.has(name), `${name} kept`);
  // The labels follow, subscripts and all; the nets keep their parts.
  assert.equal(circuit.labelOf('M1').text, 'M_{1}');
  // From the bottom right instead.
  run(circuit, 'renumber --dir nw');
  assert.equal(at(circuit)['400,400'], 'M1');
  assert.equal(at(circuit)['0,0'], 'M3');
  // Done already: nothing changes.
  const again = runCommand(circuit, 'renumber --dir nw');
  assert.equal(again.mutated, false);
  assert.match(again.text, /already numbered/);
});

test('renumber keeps connections, and a chosen few reuse their own numbers', () => {
  const circuit = drawing();
  run(circuit, 'connect M1.d M3.s');
  // M2 (top left) and M1 (bottom right) trade numbers; M3 keeps 3.
  const plan = renumberPlan(circuit, { refs: ['M1', 'M2'] });
  assert.deepEqual(plan, [{ from: 'M2', to: 'M1' }, { from: 'M1', to: 'M2' }]);
  run(circuit, 'renumber M1 M2');
  const net = circuit.netOfTerminal({ comp: 'M2', term: 'd' });
  assert.deepEqual(net.terminals.map(({ comp, term }) => `${comp}.${term}`).sort(), ['M2.d', 'M3.s']);
});

test('renumber refuses an unknown direction or part, changing nothing', () => {
  const circuit = drawing();
  const before = JSON.stringify(circuit.toJSON());
  assert.throws(() => runCommand(circuit, 'renumber --dir up'), /unknown direction "up"/);
  assert.throws(() => runCommand(circuit, 'renumber M9'), /unknown component "M9"/);
  assert.equal(JSON.stringify(circuit.toJSON()), before);
});
