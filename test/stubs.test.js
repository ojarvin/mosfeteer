import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { evaluate, runCommand } from '../src/core/commands.js';
import { addTerminalStubs } from '../src/core/stubs.js';

const run = (circuit, ...lines) => lines.map((line) => runCommand(circuit, line));
const stubOf = (circuit, ref) => {
  const [comp, term] = ref.split('.');
  const net = circuit.netOfTerminal({ comp, term });
  return net && { name: net.name, paths: net.paths(), labels: circuit.netLabels(net) };
};

test('every unconnected terminal gets a two-cell stub along its outward direction and a net label', () => {
  const circuit = new Circuit();
  run(circuit, 'add nmos M1 --at 200 200');
  const { stubs, skipped } = addTerminalStubs(circuit, ['M1']);
  assert.deepEqual(stubs.map((stub) => `${stub.ref} ${stub.name}`), ['M1.g net1', 'M1.d net2', 'M1.s net3']);
  assert.deepEqual(skipped, []);
  const gate = stubOf(circuit, 'M1.g');
  assert.deepEqual(gate.paths, [[{ x: 80, y: 200 }, { x: 0, y: 200 }]]);
  // Horizontal: above the stub, text aligned toward the terminal.
  assert.equal(gate.labels.length, 1);
  assert.deepEqual([gate.labels[0].text, gate.labels[0].netSide, gate.labels[0].align], ['net1', 'above', 'right']);
  assert.deepEqual(gate.labels[0].anchorWorld(), { x: 40, y: 200 });
  // Vertical: beside the stub on the gate side, aligned toward it.
  const drain = stubOf(circuit, 'M1.d');
  assert.deepEqual(drain.paths, [[{ x: 200, y: 120 }, { x: 200, y: 40 }]]);
  assert.deepEqual([drain.labels[0].netSide, drain.labels[0].textAlign()], ['left', 'right']);
  assert.deepEqual(evaluate(circuit).issues, []);
});

test('a vertical stub label sits on its part\'s side: the gate side of a MOSFET, away from a centred part\'s label', () => {
  const circuit = new Circuit();
  run(circuit, 'add nmos M1 --at 0 0', 'add nmos M2 --at 400 0 --mirrorX', 'add resistor R1 --at 800 0 --rot 90');
  addTerminalStubs(circuit, ['M1', 'M2', 'R1']);
  const side = (ref) => stubOf(circuit, ref).labels[0].netSide;
  assert.deepEqual([side('M1.d'), side('M1.s')], ['left', 'left']);
  assert.deepEqual([side('M2.d'), side('M2.s')], ['right', 'right']);
  // R1's own label sits to its right, so its stub labels go left.
  assert.ok(circuit.labelOf('R1').anchorWorld().x > 800);
  assert.deepEqual([side('R1.a'), side('R1.b')], ['left', 'left']);
});

test('a horizontal stub to the right aligns its text left, toward the terminal', () => {
  const circuit = new Circuit();
  run(circuit, 'add resistor R1 --at 0 0');
  addTerminalStubs(circuit, ['R1']);
  assert.equal(stubOf(circuit, 'R1.a').labels[0].align, 'right');
  assert.equal(stubOf(circuit, 'R1.b').labels[0].align, 'left');
});

test('a horizontal stub label keeps its terminal-side edge on the terminal however long its text', () => {
  const circuit = new Circuit();
  run(circuit, 'add nmos M1 --at 200 200', 'add resistor R1 --at 600 200');
  addTerminalStubs(circuit, ['M1', 'R1']);
  const gate = stubOf(circuit, 'M1.g').labels[0];
  circuit.renameNetLabel(gate, 'vin_long_name');
  const box = gate.bbox();
  assert.equal(box.x + box.w, 80);
  assert.ok(box.w > 2 * 40);
  assert.equal(stubOf(circuit, 'R1.b').labels[0].bbox().x, 680);
});

test('connected terminals are left alone and generated names skip taken ones', () => {
  const circuit = new Circuit();
  run(circuit, 'add resistor R1 --at 0 0', 'add resistor R2 --at 400 0', 'connect R1.b R2.a --name net1');
  const { stubs } = addTerminalStubs(circuit, ['R1', 'R2']);
  assert.deepEqual(stubs.map((stub) => `${stub.ref} ${stub.name}`), ['R1.a net2', 'R2.b net3']);
  assert.equal(addTerminalStubs(circuit, ['R1', 'R2']).stubs.length, 0);
});

test('a stub that would short is skipped for that terminal only', () => {
  const circuit = new Circuit();
  // R1.b at 80 and R2.a at 240 both reach for (160, 0).
  run(circuit, 'add resistor R1 --at 0 0', 'add resistor R2 --at 320 0');
  const { stubs, skipped } = addTerminalStubs(circuit, ['R1', 'R2']);
  assert.deepEqual(stubs.map((stub) => stub.ref), ['R1.a', 'R1.b', 'R2.b']);
  assert.deepEqual(skipped, ['R2.a']);
  assert.equal(circuit.netOfTerminal({ comp: 'R2', term: 'a' }), null);
});

test('stubs skip terminals and wire ends in their way but cross wires straight through', () => {
  const circuit = new Circuit();
  // A terminal at the middle of R1.b's stub.
  run(circuit, 'add resistor R1 --at 0 0', 'add resistor R2 --at 120 80 --rot 90');
  assert.deepEqual(addTerminalStubs(circuit, ['R1']).skipped, ['R1.b']);

  const crossing = new Circuit();
  run(crossing, 'add resistor R1 --at 0 0');
  crossing.createWireNet({ branches: [[{ x: 120, y: -80 }, { x: 120, y: 80 }]] });
  assert.deepEqual(addTerminalStubs(crossing, ['R1']).skipped, []);

  const ending = new Circuit();
  run(ending, 'add resistor R1 --at 0 0');
  ending.createWireNet({ branches: [[{ x: 120, y: -80 }, { x: 120, y: 0 }]] });
  assert.deepEqual(addTerminalStubs(ending, ['R1']).skipped, ['R1.b']);

  const along = new Circuit();
  run(along, 'add resistor R1 --at 0 0');
  along.createWireNet({ branches: [[{ x: 120, y: 0 }, { x: 240, y: 0 }]] });
  assert.deepEqual(addTerminalStubs(along, ['R1']).skipped, ['R1.b']);
});

test('the stubs command adds stubs and rejects an unknown part without changing anything', () => {
  const circuit = new Circuit();
  run(circuit, 'add resistor R1 --at 0 0', 'add resistor R2 --at 320 0');
  const out = runCommand(circuit, 'stubs R1 R2');
  assert.equal(out.mutated, true);
  assert.match(out.text, /^3 stubs: R1\.a net1, R1\.b net2, R2\.b net3; skipped \(would short\) R2\.a$/);

  const untouched = new Circuit();
  run(untouched, 'add resistor R1 --at 0 0');
  const before = JSON.stringify(untouched.toJSON());
  assert.throws(() => runCommand(untouched, 'stubs R1 NOPE'), /unknown component "NOPE"/);
  assert.equal(JSON.stringify(untouched.toJSON()), before);
});
