import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { findInLabels, replaceInLabels } from '../src/core/label-search.js';

function namedNet(circuit, from, to, name, labelAt) {
  const net = circuit.connect(from, to);
  circuit.renameNet(net.id, name);
  if (labelAt) circuit.addNetLabel(net.id, { x: labelAt.x, y: labelAt.y });
  return net;
}

test('search finds every label role and block captions, literally and case-insensitively', () => {
  const circuit = new Circuit();
  circuit.addComponent('resistor', { refdes: 'R1', x: 80, y: 0 });
  circuit.addComponent('resistor', { refdes: 'R2', x: 480, y: 0 });
  namedNet(circuit, 'R1.b', 'R2.a', 'BIAS', { x: 280, y: 0 });
  circuit.addComponent('switch_open', { refdes: 'S1', x: 80, y: 400 });
  circuit.setValue('S1', 'bias_{1}');
  circuit.addLabel({ text: 'Bias network', x: 0, y: 800 });
  circuit.addComponent('block', { refdes: 'B1', value: 'bias gen', x: 800, y: 800 });
  const roles = findInLabels(circuit, 'bias').map((entry) => entry.role).sort();
  assert.deepEqual(roles, ['block', 'net', 'switch', 'text']);
  assert.deepEqual(findInLabels(circuit, 'bias', { matchCase: true }).map((entry) => entry.role).sort(), ['block', 'switch']);
  // Markup is searched as written.
  assert.deepEqual(findInLabels(circuit, 'R_{2}').map((entry) => entry.role), ['part']);
  assert.equal(findInLabels(circuit, 'R2').length, 0);
  const [preview] = findInLabels(circuit, 'network', { replacement: 'stage' });
  assert.equal(preview.next, 'Bias stage');
  assert.throws(() => findInLabels(circuit, ''), /empty/);
});

test('replacing a switch phase renames it on every switch of that phase only', () => {
  const circuit = new Circuit();
  for (const [ref, x, phase] of [['S1', 0, 'phi1'], ['S2', 400, 'phi1'], ['S3', 800, 'phi2']]) {
    circuit.addComponent('switch_open', { refdes: ref, x, y: 0 });
    circuit.setValue(ref, phase);
  }
  const { changed } = replaceInLabels(circuit, 'phi1', 'ck');
  assert.deepEqual(changed.map((entry) => [entry.role, entry.from, entry.to]), [['switch', 'phi1', 'ck'], ['switch', 'phi1', 'ck']]);
  assert.deepEqual(['S1', 'S2', 'S3'].map((ref) => circuit.getComponent(ref).value), ['ck', 'ck', 'phi2']);
  assert.equal(circuit.labelOf('S1').text, 'ck');
});

test('replacing a net name renames the net once for all its labels', () => {
  const circuit = new Circuit();
  circuit.addComponent('resistor', { refdes: 'R1', x: 80, y: 0 });
  circuit.addComponent('resistor', { refdes: 'R2', x: 480, y: 0 });
  const net = namedNet(circuit, 'R1.b', 'R2.a', 'OUT', { x: 240, y: 0 });
  circuit.addNetLabel(net.id, { x: 320, y: 0 });
  const { changed, joins } = replaceInLabels(circuit, 'OUT', 'V_{out}');
  assert.equal(net.name, 'V_{out}');
  assert.deepEqual(changed.map((entry) => entry.to), ['V_{out}', 'V_{out}']);
  assert.deepEqual(circuit.netLabels(net).map((label) => label.text), ['V_{out}', 'V_{out}']);
  assert.deepEqual(joins, []);
});

test('part names, annotations, captions, and block captions are replaced through their own paths', () => {
  const circuit = new Circuit();
  circuit.addComponent('resistor', { refdes: 'R1', x: 80, y: 0 });
  const box = circuit.addLabel({ kind: 'box', x: 0, y: 200, end: { x: 400, y: 400 } });
  const caption = circuit.addLabel({ parent: box.id, text: 'Load stage', x: 200, y: 280 });
  const note = circuit.addLabel({ text: 'load: 10k', x: 0, y: 600 });
  circuit.addComponent('block', { refdes: 'B1', value: 'Load', x: 800, y: 800 });
  replaceInLabels(circuit, 'R_{1}', 'R_{L}');
  assert.ok(circuit.components.has('RL'));
  assert.equal(circuit.labelOf('RL').text, 'R_{L}');
  replaceInLabels(circuit, 'load', 'Bias');
  assert.equal(caption.text, 'Bias stage');
  assert.equal(note.text, 'Bias: 10k');
  assert.equal(circuit.getComponent('B1').value, 'Bias');
});

test('a rejected change leaves the whole drawing untouched', () => {
  const circuit = new Circuit();
  circuit.addComponent('nmos', { refdes: 'M1', x: 0, y: 0 });
  circuit.addComponent('nmos', { refdes: 'M2', x: 400, y: 0 });
  circuit.addLabel({ text: 'M_{1} is the input', x: 0, y: 400 });
  const before = JSON.stringify(circuit.toJSON());
  assert.throws(() => replaceInLabels(circuit, 'M_{1}', 'M_{2}'), /changed nothing.*M2/);
  assert.equal(JSON.stringify(circuit.toJSON()), before);
  assert.throws(() => replaceInLabels(circuit, 'M_{1} is the input', ''), /changed nothing.*empty/);
  assert.equal(JSON.stringify(circuit.toJSON()), before);
});

test('a dry run reports the change and nets it would join by name, without changing anything', () => {
  const circuit = new Circuit();
  for (const [ref, x] of [['R1', 80], ['R2', 480], ['R3', 80], ['R4', 480]]) {
    circuit.addComponent('resistor', { refdes: ref, x, y: ref === 'R3' || ref === 'R4' ? 400 : 0 });
  }
  namedNet(circuit, 'R1.b', 'R2.a', 'X1', { x: 280, y: 0 });
  namedNet(circuit, 'R3.b', 'R4.a', 'Y1', { x: 280, y: 400 });
  const before = JSON.stringify(circuit.toJSON());
  const preview = replaceInLabels(circuit, 'X', 'Y', { matchCase: true, dryRun: true });
  assert.deepEqual(preview.changed.map((entry) => [entry.from, entry.to]), [['X1', 'Y1']]);
  assert.deepEqual(preview.joins, ['Y1']);
  assert.equal(JSON.stringify(circuit.toJSON()), before);
  // Only the listed keys change.
  const { changed } = replaceInLabels(circuit, '1', '2', { keys: [preview.changed[0].key] });
  assert.deepEqual(changed.map((entry) => entry.to), ['X2']);
  assert.equal(findInLabels(circuit, 'Y1').length, 1);
});
