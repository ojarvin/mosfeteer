import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { runCommand } from '../src/core/commands.js';
import { mirrorEdit, mirrorPoint, twins } from '../src/core/symmetry.js';

const AXIS = { operation: 'mirrorX', pin: { x: 0, y: 0 } };
const run = (circuit, ...lines) => lines.forEach((line) => runCommand(circuit, line));

/** Make an edit with the axis held: the commands, then their mirror. */
function edit(circuit, ...lines) {
  const before = Circuit.fromJSON(circuit.toJSON());
  run(circuit, ...lines);
  return mirrorEdit(before, circuit, AXIS);
}

const placed = (circuit) => [...circuit.components.values()].filter((c) => c.type !== 'solder')
  .map((c) => [c.type, c.transform.x, c.transform.y, c.transform.mirrorX]).sort((a, b) => a[1] - b[1] || a[2] - b[2]);

test('a point and a part mirror about the axis; twins are parts drawn as each other\'s image', () => {
  assert.deepEqual(mirrorPoint({ x: -120, y: 40 }, AXIS), { x: 120, y: 40 });
  assert.deepEqual(mirrorPoint({ x: -120, y: 40 }, { operation: 'mirrorY', pin: { x: 0, y: 20 } }), { x: -120, y: 0 });
  const circuit = new Circuit();
  run(circuit, 'add nmos M1 --at -200 0', 'add nmos M2 --at 200 0 --mirrorX', 'add nmos M3 --at 400 0', 'add current_source I1 --at 0 200');
  const map = twins(circuit, AXIS);
  assert.equal(map.get('M1'), 'M2');
  assert.equal(map.get('M2'), 'M1');
  assert.equal(map.has('M3'), false, 'no part is its image');
  assert.equal(map.get('I1'), 'I1', 'a part on the axis is its own twin');
});

test('a part added gets a twin, its value and size with it; one on the axis gets none', () => {
  const circuit = new Circuit();
  const done = edit(circuit, 'add nmos M1 --at -200 0', 'size M1 2u/180n');
  assert.deepEqual(placed(circuit), [['nmos', -200, 0, false], ['nmos', 200, 0, true]]);
  assert.deepEqual(circuit.components.get(done.added[0]).size, circuit.components.get('M1').size);
  edit(circuit, 'add current_source I1 --at 0 200');
  assert.equal(placed(circuit).filter(([type]) => type === 'current_source').length, 1);
  edit(circuit, 'add resistor R1 --at -400 0 --value 1k');
  const twin = [...circuit.components.values()].find((c) => c.type === 'resistor' && c.refdes !== 'R1');
  assert.equal(twin.value, '1k');
});

test('a wire drawn is drawn on the other side, between the twins; one across the axis is not doubled', () => {
  const circuit = new Circuit();
  run(circuit, 'add nmos M1 --at -200 0', 'add nmos M2 --at 200 0 --mirrorX', 'add ground G1 --at -200 120', 'add ground G2 --at 200 120 --mirrorX');
  const done = edit(circuit, 'connect M1.s G1.gnd');
  assert.equal(done.wires, 1);
  assert.deepEqual(circuit.netOfTerminal({ comp: 'M2', term: 's' }).terminals.map((t) => `${t.comp}.${t.term}`).sort(), ['G2.gnd', 'M2.s']);
  // The gates tied across the axis: their own image.
  const across = edit(circuit, 'connect M1.g M2.g');
  assert.equal(across.wires, 0);
  assert.equal(circuit.netOfTerminal({ comp: 'M1', term: 'g' }).paths().length, 1);
});

test('a part moved has its twin follow, mirrored; a pair moved together moves once', () => {
  const circuit = new Circuit();
  run(circuit, 'add nmos M1 --at -200 0', 'add nmos M2 --at 200 0 --mirrorX');
  edit(circuit, 'move M1 -320 40');
  assert.deepEqual(placed(circuit), [['nmos', -320, 40, false], ['nmos', 320, 40, true]]);
  edit(circuit, 'move M1 -360 40', 'move M2 400 40');
  assert.deepEqual(placed(circuit), [['nmos', -360, 40, false], ['nmos', 400, 40, true]], 'each where it was put');
});

test('a part removed takes its twin, and draws no wire', () => {
  const circuit = new Circuit();
  run(circuit, 'add nmos M1 --at -200 0', 'add nmos M2 --at 200 0 --mirrorX', 'add ground G1 --at -200 120', 'add ground G2 --at 200 120 --mirrorX',
    'connect M1.s G1.gnd', 'connect M2.s G2.gnd');
  const done = edit(circuit, 'rm M1');
  assert.deepEqual(done.removed, ['M2']);
  assert.equal(done.wires, 0);
  assert.deepEqual(placed(circuit).map(([type]) => type), ['ground', 'ground']);
});

test('a wire deleted is deleted on the other side too', () => {
  const circuit = new Circuit();
  run(circuit, 'add nmos M1 --at -200 0', 'add nmos M2 --at 200 0 --mirrorX', 'add ground G1 --at -200 120', 'add ground G2 --at 200 120 --mirrorX');
  edit(circuit, 'connect M1.s G1.gnd');
  const left = circuit.netOfTerminal({ comp: 'M1', term: 's' });
  const before = Circuit.fromJSON(circuit.toJSON());
  circuit.deleteWireSegments(left.id, left.paths().flatMap((path, branch) => path.slice(1).map((_, i) => ({ branch, segment: i + 1 }))));
  mirrorEdit(before, circuit, AXIS);
  assert.equal(circuit.netOfTerminal({ comp: 'M1', term: 's' }), null);
  assert.equal(circuit.netOfTerminal({ comp: 'M2', term: 's' }), null, 'M2 no longer wired to its ground');
});

test('a value, a size, or a moved name label changes the twin\'s too', () => {
  const circuit = new Circuit();
  run(circuit, 'add nmos M1 --at -200 0', 'add nmos M2 --at 200 0 --mirrorX', 'add capacitor C1 --at -200 -400', 'add capacitor C2 --at 200 -400 --mirrorX');
  edit(circuit, 'value C1 2p', 'size M1 4u/180n');
  assert.equal(circuit.components.get('C2').value, '2p');
  assert.deepEqual(circuit.components.get('M2').size, circuit.components.get('M1').size);
  const before = Circuit.fromJSON(circuit.toJSON());
  circuit.labelOf('M1').offset = { x: 80, y: -120 };
  mirrorEdit(before, circuit, AXIS);
  assert.deepEqual(circuit.labelOf('M2').offset, { x: 80, y: -120 }, 'the same place on the twin: the mirror image');
});

test('about a horizontal axis, a part on it is its own twin: wires to one input are mirrored to the other', () => {
  const axis = { operation: 'mirrorY', pin: { x: 0, y: 0 } };
  const circuit = new Circuit();
  const step = (...lines) => { const before = Circuit.fromJSON(circuit.toJSON()); run(circuit, ...lines); return mirrorEdit(before, circuit, axis); };
  step('add opamp_diff OTA --at 0 0');
  assert.equal(circuit.components.size, 1, 'no twin for a part on the axis');
  step('add capacitor CF1 --at 0 -280');
  step('connect CF1.a OTA.ip', 'connect CF1.b OTA.om');
  step('add capacitor CS1 --at -560 -40');
  step('connect CS1.b OTA.ip');
  // Twins named in their originals' series.
  assert.deepEqual(circuit.netOfTerminal({ comp: 'OTA', term: 'im' }).terminals.map((t) => `${t.comp}.${t.term}`).sort(), ['CF2.a', 'CS2.b', 'OTA.im']);
  assert.deepEqual(circuit.netOfTerminal({ comp: 'OTA', term: 'op' }).terminals.map((t) => `${t.comp}.${t.term}`).sort(), ['CF2.b', 'OTA.op']);
});
