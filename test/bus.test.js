import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { runCommand } from '../src/core/commands.js';
import { svgString } from '../src/core/render.js';
import { busBits, busMarkD, busMarkPoints, busTerminalMarks, busWidth, netNamesConnect, expandLabelNames, straightLeadLength } from '../src/core/bus.js';
import { getSymbol } from '../src/core/components/index.js';

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
  // Only the multi-bit net draws slashes: one at each of its two pins.
  assert.equal((svgString(circuit).match(/class="bus-mark"/g) || []).length, 2);
});

test('a bus slash sits mid-way along each branch\'s longest straight run, clear of its labels', () => {
  const path = [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 320 }];
  assert.deepEqual(busMarkPoints([path]), [{ x: 80, y: 160, horizontal: false }]);
  assert.deepEqual(busMarkPoints([path], [{ x: 80, y: 160 }]), [{ x: 80, y: 120, horizontal: false }]);
  assert.deepEqual(busMarkPoints([[{ x: 0, y: 0 }, { x: 200, y: 0 }]]), [{ x: 100, y: 0, horizontal: true }]);
  // A diagonal keeps its own look; a slash is one cell tall.
  assert.deepEqual(busMarkPoints([[{ x: 0, y: 0 }, { x: 80, y: 80 }]]), []);
  // A 45-degree `/`, the same whichever way the wire runs.
  assert.equal(busMarkD({ x: 100, y: 0, horizontal: true }), 'M 80 20 L 120 -20');
  assert.equal(busMarkD({ x: 0, y: 100, horizontal: false }), 'M -20 120 L 20 80');
});

test('a net named as a bus draws its slash; renaming it plain removes it', () => {
  const circuit = new Circuit();
  runCommand(circuit, 'add adc U1 --at 0 0');
  runCommand(circuit, 'add output D --at 600 0');
  runCommand(circuit, 'connect U1.d D.p --name D[7:0]');
  const marks = (svg) => (svg.match(/class="bus-mark"/g) || []).length;
  assert.equal(marks(svgString(circuit)), 2);
  // The converter draws no slash of its own, turned or not.
  runCommand(circuit, 'rotate U1 90');
  assert.equal(marks(svgString(circuit)), 2);
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
  assert.equal((svgString(circuit).match(/class="bus-mark"/g) || []).length, 2);
  // The identity stays unique: the other spelling of the same range is taken.
  runCommand(circuit, 'add output P2 --at 600 400');
  assert.throws(() => circuit.renameComponent('P2', 'D_{OUT}<3:0>', { displayLabel: 'D_{OUT}<3:0>' }));
});

test('a bus slash sits a cell clear of the drawn part at each pin', () => {
  // The converters' digital leads run two cells straight in; a port's pin is
  // less than a cell from its body, and a block's is on its edge.
  assert.equal(straightLeadLength(getSymbol('adc').graphics, { x: 200, y: 0 }), 80);
  assert.ok(straightLeadLength(getSymbol('output').graphics, { x: 0, y: 0 }) < 40);
  const circuit = new Circuit();
  for (const line of ['add adc U1 --at 0 0', 'add output P1 --at 640 0', 'connect U1.d P1.p --name D[3:0]',
    'add block B1 --at 0 800', 'add output P2 --at 480 800', 'connect B1.T10 P2.p --name Q<7:0>']) runCommand(circuit, line);
  const marksOf = (comp, term) => {
    const net = circuit.netOfTerminal({ comp, term });
    return busTerminalMarks(circuit, net, net.paths()).map(({ key, ...mark }) => mark);
  };
  // At the ADC's terminal; one cell out from the port, along the wire.
  const d = circuit.components.get('U1').terminalWorld('d');
  const p = circuit.components.get('D_3_0').terminalWorld('p');
  assert.deepEqual(marksOf('U1', 'd'), [{ ...d, horizontal: true }, { x: p.x - 40, y: p.y, horizontal: true }]);
  // A block pin is right on the body's edge: two cells out, room for an arrowhead.
  const t = circuit.components.get('B1').terminalWorld('T10');
  assert.deepEqual(marksOf('B1', 'T10')[0], { x: t.x + 80, y: t.y, horizontal: true });
  // So is a sum's; where the wire turns sooner the slash steps back.
  runCommand(circuit, 'add signal_sum S1 --at 0 1600');
  runCommand(circuit, 'add output P3 --at 400 1600');
  runCommand(circuit, 'connect S1.e P3.p --name Y[1:0]');
  const e = circuit.components.get('S1').terminalWorld('e');
  assert.deepEqual(marksOf('S1', 'e')[0], { x: e.x + 80, y: e.y, horizontal: true });
  const short = circuit.netOfTerminal({ comp: 'S1', term: 'e' });
  assert.deepEqual(busTerminalMarks(circuit, short, [[e, { x: e.x + 40, y: e.y }, { x: e.x + 40, y: e.y + 200 }]])[0], { x: e.x + 40, y: e.y, horizontal: true, key: 'S1.e' });
});

test('a bus net can show its bit count beside each slash, and each count moves with its slash', async () => {
  const { drawnBusCounts } = await import('../src/core/render.js');
  const circuit = new Circuit();
  for (const line of ['add adc U1 --at 0 0', 'add output P1 --at 640 0', 'connect U1.d P1.p --name D[3:0]']) runCommand(circuit, line);
  const net = circuit.netOfTerminal({ comp: 'U1', term: 'd' });
  assert.deepEqual(drawnBusCounts(circuit), []);
  const [on] = [runCommand(circuit, `net ${net.id} bitcount on`)];
  assert.equal(on.mutated, true);
  const counts = drawnBusCounts(circuit);
  assert.deepEqual(counts.map(({ key, text }) => [key, text]), [['U1.d', '4'], ['D_3_0.p', '4']]);
  // Above the slash on a horizontal wire.
  const [adc] = counts;
  assert.deepEqual({ x: adc.x - adc.slash.x, y: adc.y - adc.slash.y }, { x: 0, y: -40 });
  assert.equal((svgString(circuit).match(/class="bus-count"/g) || []).length, 2);
  // Moved, a count keeps its place from its slash (snapped to half cells), and follows it.
  circuit.moveBusCountLabel(net, 'U1.d', { x: 27, y: -61 });
  runCommand(circuit, 'move U1 0 40');
  const moved = drawnBusCounts(circuit).find(({ key }) => key === 'U1.d');
  assert.deepEqual({ x: moved.x - moved.slash.x, y: moved.y - moved.slash.y }, { x: 20, y: -60 });
  // Saved and loaded; then hidden again.
  const loaded = Circuit.fromJSON(JSON.parse(JSON.stringify(circuit.toJSON())));
  assert.deepEqual(drawnBusCounts(loaded).map(({ key, x, y }) => [key, x, y]), drawnBusCounts(circuit).map(({ key, x, y }) => [key, x, y]));
  runCommand(circuit, `net ${net.id} bitcount off`);
  assert.deepEqual(drawnBusCounts(circuit), []);
  // Only a multi-bit bus has a count; the command says how to use it.
  runCommand(circuit, 'add resistor R1 --at 0 400');
  runCommand(circuit, 'add resistor R2 --at 400 400');
  runCommand(circuit, 'connect R1.b R2.a --name D[1]');
  assert.throws(() => runCommand(circuit, `net ${circuit.netOfTerminal({ comp: 'R1', term: 'b' }).id} bitcount on`), /not a multi-bit bus/);
  assert.throws(() => runCommand(circuit, `net ${net.id} bitcount maybe`), /usage: net <id> bitcount on\|off/);
});

test('typed label names spell a bus out bit by bit, in written order', () => {
  assert.deepEqual(expandLabelNames('DOUT[3:0]'), ['DOUT[3]', 'DOUT[2]', 'DOUT[1]', 'DOUT[0]']);
  assert.deepEqual(expandLabelNames('CLK, DOUT<0:1>'), ['CLK', 'DOUT<0>', 'DOUT<1>']);
  // One bit, plain names, and commas inside markup are left as they are.
  assert.deepEqual(expandLabelNames('D[3] V_{a,b}  RST'), ['D[3]', 'V_{a,b}', 'RST']);
  assert.deepEqual(expandLabelNames('  '), []);
});
