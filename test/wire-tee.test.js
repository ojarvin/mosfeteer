import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { evaluate, runCommand } from '../src/core/commands.js';

const run = (circuit, ...lines) => lines.forEach((line) => runCommand(circuit, line));

// R1.b (0,80) wired straight down to R2.a (0,400).
function rail() {
  const circuit = new Circuit();
  run(circuit, 'add resistor R1 --at 0 0 --rot 90', 'add resistor R2 --at 0 480 --rot 90', 'connect R1.b R2.a');
  return circuit;
}

test('a pin dropped on the middle of a wire tees into it with a junction', () => {
  const circuit = rail();
  const port = circuit.addComponent('port', { x: 0, y: 240 });
  assert.equal(circuit.teeTerminalsOntoWires([port.refdes]).length, 1);
  const net = circuit.netOfTerminal({ comp: port.refdes, term: 'p' });
  assert.equal(net, circuit.netOfTerminal({ comp: 'R1', term: 'b' }));
  assert.deepEqual(net.paths(), [[{ x: 0, y: 80 }, { x: 0, y: 240 }], [{ x: 0, y: 240 }, { x: 0, y: 400 }]]);
  assert.ok([...circuit.components.values()].some((c) => c.type === 'solder' && c.transform.x === 0 && c.transform.y === 240));
  assert.deepEqual(evaluate(circuit).issues.filter((issue) => issue.kind !== 'unconnected-terminal'), []);
});

test('a new port takes the name of the net it lands on; a named one names the net', () => {
  const named = rail();
  named.renameNet(named.netOfTerminal({ comp: 'R1', term: 'b' }), 'VOUT');
  const port = named.addComponent('port', { x: 0, y: 240 });
  named.teeTerminalsOntoWires([port.refdes]);
  assert.ok(named.components.has('VOUT'));
  assert.equal(named.netOfTerminal({ comp: 'R1', term: 'b' }).name, 'VOUT');

  const chosen = rail();
  const vin = chosen.addComponent('port', { x: 0, y: 240, refdes: 'VIN' });
  chosen.teeTerminalsOntoWires([vin.refdes]);
  assert.equal(chosen.netOfTerminal({ comp: 'R1', term: 'b' }).name, 'VIN');
});

test('a wired pin or a crossing of two nets is never teed', () => {
  const circuit = rail();
  run(circuit, 'add resistor R3 --at -400 240', 'add resistor R4 --at 400 240', 'connect R3.b R4.a');
  // (0,240) is now where the two nets cross.
  const port = circuit.addComponent('port', { x: 0, y: 240 });
  assert.deepEqual(circuit.teeTerminalsOntoWires([port.refdes]), []);
  assert.equal(circuit.netOfTerminal({ comp: port.refdes, term: 'p' }), null);

  // R5.a rests on the rail but already has a net of its own.
  const wired = rail();
  run(wired, 'add resistor R5 --at 80 240', 'add ground --at 280 400', 'connect R5.a GROUND1.gnd');
  const own = wired.netOfTerminal({ comp: 'R5', term: 'a' });
  assert.deepEqual(wired.teeTerminalsOntoWires(['R5']).filter((ref) => ref.term === 'a'), []);
  assert.equal(wired.netOfTerminal({ comp: 'R5', term: 'a' }), own);
});

// R3 to the right of the rail, its pins at (320,240) and (480,240): a wire
// from each, as a pasted or moved set carries them, ending on the rail.
function landed(circuit, ...paths) {
  const r3 = circuit.addComponent('resistor', { x: 400, y: 240, refdes: 'R3' });
  return paths.map(([term, ...points]) => {
    const pin = r3.terminalWorld(term);
    const path = [pin, ...points];
    const net = circuit.createWireNet({ route: path, branches: [path] });
    net.terminals.push({ comp: 'R3', term });
    return net.id;
  });
}
const solderAt = (circuit, x, y) => [...circuit.components.values()].some((c) => c.type === 'solder' && c.transform.x === x && c.transform.y === y);

test('a wire end landing on the middle of a wire tees into it with a junction', () => {
  const circuit = rail();
  const ids = landed(circuit, ['a', { x: 320, y: 160 }, { x: 0, y: 160 }], ['b', { x: 480, y: 320 }, { x: 0, y: 320 }]);
  assert.deepEqual(circuit.teeWireEndsOntoWires(ids), [{ x: 0, y: 160 }, { x: 0, y: 320 }]);
  const net = circuit.netOfTerminal({ comp: 'R1', term: 'b' });
  for (const term of ['a', 'b']) assert.equal(circuit.netOfTerminal({ comp: 'R3', term }), net);
  assert.equal(circuit.netOfTerminal({ comp: 'R2', term: 'a' }), net);
  assert.ok(solderAt(circuit, 0, 160) && solderAt(circuit, 0, 320));
  assert.deepEqual(evaluate(circuit).issues.filter((issue) => issue.kind !== 'unconnected-terminal'), []);
});

test('both ends of one landed net tee into the same wire', () => {
  const circuit = rail();
  const r3 = circuit.addComponent('resistor', { x: 400, y: 240, refdes: 'R3' });
  const pin = r3.terminalWorld('a');
  const up = [pin, { x: 320, y: 160 }, { x: 0, y: 160 }];
  const down = [pin, { x: 320, y: 320 }, { x: 0, y: 320 }];
  const net = circuit.createWireNet({ route: up, branches: [up, down] });
  net.terminals.push({ comp: 'R3', term: 'a' });
  assert.equal(circuit.teeWireEndsOntoWires([net.id]).length, 2);
  assert.equal(circuit.netOfTerminal({ comp: 'R3', term: 'a' }), circuit.netOfTerminal({ comp: 'R1', term: 'b' }));
  assert.ok(solderAt(circuit, 0, 160) && solderAt(circuit, 0, 320));
});

test('a wire end on a crossing of two nets, or on a wire of the landed set, is never teed', () => {
  const crossing = rail();
  // A second net crosses the rail at (0,160), where the landed wire ends.
  const across = [{ x: -400, y: 160 }, { x: 200, y: 160 }];
  crossing.createWireNet({ route: across, branches: [across] });
  const nets = crossing.nets.size;
  assert.deepEqual(crossing.teeWireEndsOntoWires(landed(crossing, ['a', { x: 320, y: 160 }, { x: 0, y: 160 }])), []);
  assert.equal(crossing.nets.size, nets + 1);

  const circuit = rail();
  const rails = [...circuit.nets.keys()];
  const ids = landed(circuit, ['a', { x: 320, y: 160 }, { x: 0, y: 160 }]);
  assert.deepEqual(circuit.teeWireEndsOntoWires([...ids, ...rails]), []);
  assert.notEqual(circuit.netOfTerminal({ comp: 'R3', term: 'a' }), circuit.netOfTerminal({ comp: 'R1', term: 'b' }));
});
