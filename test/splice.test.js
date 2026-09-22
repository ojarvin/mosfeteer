import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';

const summary = (circuit) => [...circuit.nets.values()]
  .map((net) => [net.terminals.map((t) => `${t.comp}.${t.term}`).sort().join(','), net.paths()])
  .sort((a, b) => a[0].localeCompare(b[0]));

test('a two-terminal part splices into a straight wire and splits the net', () => {
  const circuit = new Circuit();
  circuit.addComponent('resistor', { x: 0, y: 0 });
  circuit.addComponent('resistor', { x: 800, y: 0 });
  const net = circuit.connect('R1.b', 'R2.a');
  const r3 = circuit.addComponent('resistor', { x: 400, y: 0 });
  circuit.spliceIntoSegment(r3.refdes, net.id, 0, 1);
  assert.deepEqual(summary(circuit), [
    ['R1.b,R3.a', [[{ x: 80, y: 0 }, { x: 320, y: 0 }]]],
    ['R2.a,R3.b', [[{ x: 480, y: 0 }, { x: 720, y: 0 }]]],
  ]);
});

test('splicing rejects parts off the segment or already connected, without mutating', () => {
  const circuit = new Circuit();
  circuit.addComponent('resistor', { x: 0, y: 0 });
  circuit.addComponent('resistor', { x: 800, y: 0 });
  const net = circuit.connect('R1.b', 'R2.a');
  const off = circuit.addComponent('resistor', { x: 400, y: 40 });
  const before = JSON.stringify(circuit.toJSON());
  assert.throws(() => circuit.spliceIntoSegment(off.refdes, net.id, 0, 1), /does not lie on/);
  assert.equal(JSON.stringify(circuit.toJSON()), before);
  assert.throws(() => circuit.spliceIntoSegment('R1', net.id, 0, 1), /already connected/);
  assert.throws(() => circuit.spliceIntoSegment(off.refdes, 'N404', 0, 1), /unknown net/);
});
