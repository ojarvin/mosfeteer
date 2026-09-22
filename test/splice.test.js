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

test('a transistor splices its drain/source or collector/emitter into a vertical wire (cascode)', () => {
  for (const [type, pair] of [['nmos', ['d', 's']], ['nmosb', ['d', 's']], ['pmos', ['d', 's']], ['npn', ['c', 'e']]]) {
    const circuit = new Circuit();
    circuit.addComponent('resistor', { refdes: 'RT', x: 0, y: -400, rotation: 90 });
    circuit.addComponent('resistor', { refdes: 'RB', x: 0, y: 400, rotation: 90 });
    const net = circuit.connect('RT.b', 'RB.a');
    const device = circuit.addComponent(type, { x: 0, y: 0 });
    circuit.spliceIntoSegment(device.refdes, net.id, 0, 1);
    const nets = [...circuit.nets.values()].map((n) => n.terminals.map((t) => `${t.comp}.${t.term}`).sort().join(','));
    const [top, bottom] = device.worldTerminals()
      .filter((t) => pair.includes(t.name))
      .sort((a, b) => a.y - b.y)
      .map((t) => `${device.refdes}.${t.name}`);
    assert.deepEqual(nets.sort(), [[`RB.a`, bottom].sort().join(','), [`RT.b`, top].sort().join(',')].sort(), type);
    // The control terminal (and a bulk between the pins) stays free.
    assert.equal(circuit.netOfTerminal({ comp: device.refdes, term: type === 'npn' ? 'b' : 'g' }), null);
    if (type === 'nmosb') assert.equal(circuit.netOfTerminal({ comp: device.refdes, term: 'b' }), null);
  }
});

test('parts without a series pair do not splice', () => {
  const circuit = new Circuit();
  circuit.addComponent('resistor', { x: 0, y: 0 });
  circuit.addComponent('resistor', { x: 800, y: 0 });
  const net = circuit.connect('R1.b', 'R2.a');
  const gate = circuit.addComponent('opamp', { x: 400, y: 0 });
  assert.throws(() => circuit.spliceIntoSegment(gate.refdes, net.id, 0, 1), /series terminals/);
});
