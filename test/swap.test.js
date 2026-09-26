import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { runCommand } from '../src/core/commands.js';
import { swapCandidates, swapComponentType, swapTerminalMap } from '../src/core/swap.js';

const run = (circuit, ...lines) => lines.map((line) => runCommand(circuit, line));

function stage() {
  const circuit = new Circuit();
  run(circuit,
    'add nmos M1 --at 0 0',
    'add resistor R1 --at 0 -240 --rot 90',
    'add ground --at 0 200',
    'add input VIN --at -280 0',
    'connect M1.d R1.a',
    'connect M1.s GROUND1.gnd',
    'connect VIN.p M1.g');
  return circuit;
}

const netSummary = (circuit) => [...circuit.nets.values()].map((net) => ({
  name: net.name,
  terminals: net.terminals.map((t) => `${t.comp}.${t.term}`).sort(),
  paths: net.paths(),
}));

test('the complementary part is offered first, and unrelated types never', () => {
  assert.equal(swapCandidates('nmos')[0], 'pmos');
  assert.equal(swapCandidates('ground')[0], 'supply');
  assert.equal(swapCandidates('input')[0], 'output');
  assert.equal(swapCandidates('resistor')[0], 'capacitor');
  assert.ok(swapCandidates('resistor').includes('switch_open'));
  assert.ok(!swapCandidates('input').includes('supply'));
  assert.ok(!swapCandidates('nmos').includes('ground'));
  assert.deepEqual(swapCandidates('solder'), []);
});

test('MOS and BJT terminals map by role; a bulk pin has no BJT counterpart', () => {
  assert.deepEqual([...swapTerminalMap('nmos', 'npn')], [['g', 'b'], ['d', 'c'], ['s', 'e']]);
  assert.deepEqual([...swapTerminalMap('nmosb', 'npn')], [['g', 'b'], ['d', 'c'], ['s', 'e']]);
  assert.deepEqual([...swapTerminalMap('ground', 'supply')], [['gnd', 'p']]);
});

test('a same-footprint swap keeps the name and every wire exactly', () => {
  const circuit = stage();
  const before = netSummary(circuit);
  const component = swapComponentType(circuit, 'M1', 'pmos');
  assert.equal(component.refdes, 'M1');
  assert.equal(component.type, 'pmos');
  assert.deepEqual(component.transform, { x: 0, y: 0, rotation: 0, mirrorX: false, mirrorY: false });
  assert.deepEqual(netSummary(circuit), before);
});

test('an automatic name follows the new prefix; a chosen one stays', () => {
  const circuit = stage();
  swapComponentType(circuit, 'R1', 'capacitor');
  assert.ok(circuit.components.has('C1') && !circuit.components.has('R1'));
  assert.equal(circuit.labelOf('C1').text, 'C_{1}');
  assert.deepEqual(circuit.netOfTerminal({ comp: 'M1', term: 'd' }).terminals.map((t) => `${t.comp}.${t.term}`).sort(), ['C1.a', 'M1.d']);

  run(circuit, 'rename M1 Min');
  swapComponentType(circuit, 'Min', 'npn');
  assert.ok(circuit.components.has('Min'));
});

test('pins that move reroute only their legs and stay connected', () => {
  const circuit = stage();
  swapComponentType(circuit, 'M1', 'npn');
  const q = circuit.components.get('Q1');
  assert.equal(q.type, 'npn');
  const collector = circuit.netOfTerminal({ comp: 'Q1', term: 'c' });
  assert.deepEqual(collector.terminals.map((t) => `${t.comp}.${t.term}`).sort(), ['Q1.c', 'R1.a']);
  assert.deepEqual(collector.paths()[0][0], q.terminalWorld('c'));
  assert.deepEqual(circuit.netOfTerminal({ comp: 'Q1', term: 'b' }).paths(), [[{ x: -280, y: 0 }, { x: -160, y: 0 }]]);
  assert.equal(circuit.netOfTerminal({ comp: 'Q1', term: 'e' }).name, 'VSS');
});

test('a pin with no counterpart detaches', () => {
  const circuit = stage();
  run(circuit, 'swap M1 nmosb', 'add ground GB --at 200 0', 'connect M1.b GB.gnd');
  swapComponentType(circuit, 'M1', 'nmos');
  assert.equal(circuit.netOfTerminal({ comp: 'GB', term: 'gnd' })?.terminals.some((t) => t.comp === 'M1') ?? false, false);
});

test('an unnamed rail marker renames the net it named', () => {
  const circuit = stage();
  swapComponentType(circuit, 'GROUND1', 'supply');
  assert.equal(circuit.netOfTerminal({ comp: 'M1', term: 's' }).name, 'VDD');
});

test('a switch swap moves its whole phase', () => {
  const circuit = new Circuit();
  run(circuit, 'add switch_open S1 --at 0 0', 'add switch_open S2 --at 0 200', 'value S1 phi1', 'value S2 phi1');
  swapComponentType(circuit, 'S1', 'switch_closed');
  assert.deepEqual([...circuit.components.values()].map((c) => c.type), ['switch_closed', 'switch_closed']);
});

test('a rejected swap leaves the circuit untouched', () => {
  const circuit = stage();
  const snapshot = JSON.stringify(circuit.toJSON());
  assert.throws(() => swapComponentType(circuit, 'M1', 'ground'), /shares no terminal/);
  assert.throws(() => swapComponentType(circuit, 'M1', 'nonsense'), /unknown type/);
  assert.equal(JSON.stringify(circuit.toJSON()), snapshot);
});

test('the swap command changes a type, or lists the choices', () => {
  const circuit = stage();
  assert.match(runCommand(circuit, 'swap M1').text, /can become: pmos npn/);
  const done = runCommand(circuit, 'swap R1 inductor');
  assert.equal(done.mutated, true);
  assert.match(done.text, /R1 \(resistor\) is now L1 \(inductor\)/);
  assert.throws(() => runCommand(circuit, 'swap'), /usage: swap/);
});
