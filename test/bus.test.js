import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { runCommand } from '../src/core/commands.js';
import { svgString } from '../src/core/render.js';
import { busBits, busMarkD, busMarkPoints, busWidth, netNamesConnect } from '../src/core/bus.js';

test('bus names carry a bit range in brackets or angle brackets', () => {
  assert.equal(busWidth('D[7:0]'), 8);
  assert.equal(busWidth('D<3:0>'), 4);
  assert.equal(busWidth('code<0:5>'), 6);
  assert.equal(busWidth('D_{out}[1:0]'), 2);
  for (const name of ['D', 'VDD', '[3:0]', 'D[3]', 'D[a:b]', '', null]) assert.equal(busWidth(name), 0, String(name));
});

test('a bus stands for its parallel bits, and a bit named anywhere joins it', () => {
  assert.deepEqual(busBits('D[3:0]'), { base: 'D', bits: [3, 2, 1, 0], range: true });
  assert.deepEqual(busBits('D<1>'), { base: 'D', bits: [1], range: false });
  assert.deepEqual(busBits('code<0:2>').bits, [0, 1, 2]);
  assert.equal(busBits('D'), null);
  // Square and angle brackets are one notation.
  assert.ok(netNamesConnect('D[3:0]', 'D<1>'));
  assert.ok(netNamesConnect('D[3:0]', 'D[1:0]'));
  assert.ok(netNamesConnect('D<2>', 'D[2]'));
  assert.ok(netNamesConnect('OUT', 'OUT'));
  // Different bits, different buses, and plain names do not join.
  assert.ok(!netNamesConnect('D[1]', 'D[2]'));
  assert.ok(!netNamesConnect('D[3:2]', 'D[1:0]'));
  assert.ok(!netNamesConnect('D[1]', 'E[1]'));
  assert.ok(!netNamesConnect('D[3:0]', 'D'));
  assert.ok(!netNamesConnect('', ''));
});

test('the latest probe wins across a bus and its bits', () => {
  const circuit = new Circuit();
  for (const line of [
    'add adc U1 --at 0 0', 'add output P1 --at 600 0', 'connect U1.d P1.p --name D[3:0]',
    'add resistor R1 --at 0 400', 'add resistor R2 --at 400 400', 'connect R1.b R2.a --name D<0>',
    'add resistor R3 --at 0 800', 'add resistor R4 --at 400 800', 'connect R3.b R4.a --name D[1]',
    'add resistor R5 --at 0 1200', 'add resistor R6 --at 400 1200', 'connect R5.b R6.a --name E[1]',
    'add resistor R7 --at 0 1600', 'add resistor R8 --at 400 1600', 'connect R7.b R8.a --name D[0]',
    'add resistor R9 --at 0 2000', 'add resistor R10 --at 400 2000', 'connect R9.b R10.a --name D[2]',
  ]) runCommand(circuit, line);
  const net = (comp) => circuit.netOfTerminal({ comp, term: 'b' });
  const bus = circuit.netOfTerminal({ comp: 'U1', term: 'd' });
  const [bit0, bit1, other, bit0again, bit2] = ['R1', 'R3', 'R5', 'R7', 'R9'].map(net);
  const color = (n) => circuit.netHighlight(n);
  // The bus reaches each of its bits; one bit does not reach another.
  assert.ok(circuit.logicallyConnected(bus, bit1));
  assert.ok(!circuit.logicallyConnected(bit0, bit1));
  assert.equal(circuit.netGroupKey(bit0), circuit.netGroupKey(bit0again));
  // Probing D[0] colors that bit, either spelling, and the bus -- not D[1].
  const first = circuit.cycleNetHighlight(bit0);
  assert.equal(color(bit0again), first);
  assert.equal(color(bus), first);
  assert.equal(color(bit1), null);
  assert.equal(color(bit2), null);
  // Probing D[1] next switches the bus to D[1]'s color; D[0] keeps its own.
  const second = circuit.cycleNetHighlight(bit1);
  assert.notEqual(second, first);
  assert.equal(color(bus), second);
  assert.equal(color(bit0), first);
  assert.equal(color(bit2), null);
  // Probing the bus then recolors every bit with the bus color.
  const all = circuit.cycleNetHighlight(bus);
  for (const n of [bus, bit0, bit0again, bit1, bit2]) assert.equal(color(n), all);
  assert.equal(color(other), null);
  // A later bit probe takes the bus again; the other bits keep the bus color.
  const again = circuit.cycleNetHighlight(bit2);
  assert.equal(color(bus), again);
  assert.equal(color(bit1), all);
  // The order survives a save and a load.
  const loaded = Circuit.fromJSON(JSON.parse(JSON.stringify(circuit.toJSON())));
  assert.equal(loaded.netHighlight(loaded.netOfTerminal({ comp: 'U1', term: 'd' })), again);
  // Only the multi-bit net draws the slash.
  assert.equal((svgString(circuit).match(/class="bus-mark"/g) || []).length, 1);
});

test('a bus slash sits mid-way along each branch\'s longest straight run, clear of its labels', () => {
  const path = [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 320 }];
  assert.deepEqual(busMarkPoints([path]), [{ x: 80, y: 160, horizontal: false }]);
  assert.deepEqual(busMarkPoints([path], [{ x: 80, y: 160 }]), [{ x: 80, y: 120, horizontal: false }]);
  assert.deepEqual(busMarkPoints([[{ x: 0, y: 0 }, { x: 200, y: 0 }]]), [{ x: 100, y: 0, horizontal: true }]);
  // A diagonal keeps its own look; a slash is one cell tall.
  assert.deepEqual(busMarkPoints([[{ x: 0, y: 0 }, { x: 80, y: 80 }]]), []);
  assert.equal(busMarkD({ x: 100, y: 0, horizontal: true }), 'M 85 20 L 115 -20');
  // Always a `/`, whichever way the wire runs.
  assert.equal(busMarkD({ x: 0, y: 100, horizontal: false }), 'M -20 115 L 20 85');
});

test('a net named as a bus draws its slash; renaming it plain removes it', () => {
  const circuit = new Circuit();
  runCommand(circuit, 'add adc U1 --at 0 0');
  runCommand(circuit, 'add output D --at 600 0');
  runCommand(circuit, 'connect U1.d D.p --name D[7:0]');
  const marks = (svg) => (svg.match(/class="bus-mark"/g) || []).length;
  assert.equal(marks(svgString(circuit)), 1);
  // The converter draws no slash of its own, turned or not.
  runCommand(circuit, 'rotate U1 90');
  assert.equal(marks(svgString(circuit)), 1);
  circuit.renameNet(circuit.netOfTerminal({ comp: 'U1', term: 'd' }), 'D');
  assert.equal(marks(svgString(circuit)), 0);
});

test('a pin can be named as a bus: its identity folds the range, its label and net keep it', async () => {
  const { normalizeComponentRefdes } = await import('../src/core/model.js');
  assert.equal(normalizeComponentRefdes('D_{OUT}[3:0]'), 'DOUT_3_0');
  assert.equal(normalizeComponentRefdes('D<7:0>'), 'D_7_0');
  const circuit = new Circuit();
  for (const line of ['add adc U1 --at 0 0', 'add output P1 --at 600 0', 'connect U1.d P1.p']) runCommand(circuit, line);
  circuit.renameComponent('P1', 'D_{OUT}[3:0]', { displayLabel: 'D_{OUT}[3:0]' });
  assert.ok(circuit.components.has('DOUT_3_0'));
  assert.equal(circuit.labelOf('DOUT_3_0').text, 'D_{OUT}[3:0]');
  assert.equal(circuit.netOfTerminal({ comp: 'DOUT_3_0', term: 'p' }).name, 'D_{OUT}[3:0]');
  assert.equal((svgString(circuit).match(/class="bus-mark"/g) || []).length, 1);
  // The identity stays unique: the other spelling of the same range is taken.
  runCommand(circuit, 'add output P2 --at 600 400');
  assert.throws(() => circuit.renameComponent('P2', 'D_{OUT}<3:0>', { displayLabel: 'D_{OUT}<3:0>' }));
});
