import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { runCommand } from '../src/core/commands.js';
import { setSharedLabel, sharedLabelKind, sharedLabelPeers } from '../src/core/shared-labels.js';

const run = (circuit, ...lines) => lines.forEach((line) => runCommand(circuit, line));

test('switches share phases and markers share rail names; parts have names', () => {
  const circuit = new Circuit();
  run(circuit, 'add switch_open S1 --at 0 0', 'add switch_closed S2 --at 0 200', 'add ground --at 400 0',
    'add ground --at 400 200', 'add supply --at 600 0', 'add resistor R1 --at 800 0');
  const get = (refdes) => circuit.components.get(refdes);
  assert.equal(sharedLabelKind(get('S1')), 'switch');
  assert.equal(sharedLabelKind(get('GROUND1')), 'ground');
  assert.equal(sharedLabelKind(get('R1')), null);
  const all = [...circuit.components.keys()];
  assert.deepEqual(sharedLabelPeers(circuit, get('S1'), all).map((c) => c.refdes), ['S2']);
  assert.deepEqual(sharedLabelPeers(circuit, get('GROUND1'), all).map((c) => c.refdes), ['GROUND2']);
  assert.deepEqual(sharedLabelPeers(circuit, get('R1'), all), []);
});

test('a phase set on several switches joins them into one phase', () => {
  const circuit = new Circuit();
  run(circuit, 'add switch_open S1 --at 0 0', 'add switch_open S2 --at 0 200');
  for (const refdes of ['S1', 'S2']) setSharedLabel(circuit, refdes, '$\\phi_1$');
  assert.deepEqual([...circuit.components.values()].map((c) => c.value), ['$\\phi_1$', '$\\phi_1$']);
  circuit.setSwitchState('S1', 'closed');
  assert.equal(circuit.components.get('S2').type, 'switch_closed');
});

test('a rail name reaches markers with and without a label, and clearing restores the rail', () => {
  const circuit = new Circuit();
  run(circuit, 'add nmos M1 --at 0 0', 'add nmos M2 --at 400 0', 'rail M1.s ground', 'rail M2.s ground');
  for (const refdes of ['GROUND1', 'GROUND2']) setSharedLabel(circuit, refdes, 'AGND');
  assert.equal(circuit.netOfTerminal({ comp: 'M1', term: 's' }).name, 'AGND');
  assert.equal(circuit.netOfTerminal({ comp: 'M2', term: 's' }).name, 'AGND');
  assert.equal(circuit.labelOf('GROUND2').text, 'AGND');
  for (const refdes of ['GROUND1', 'GROUND2']) setSharedLabel(circuit, refdes, '');
  assert.equal(circuit.netOfTerminal({ comp: 'M1', term: 's' }).name, 'VSS');
  assert.equal(circuit.labelOf('GROUND1'), null);
  assert.throws(() => setSharedLabel(circuit, 'M1', 'x'), /has a name/);
});
