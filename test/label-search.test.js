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
  // Markup in the search matches as written; without it, through markup.
  assert.deepEqual(findInLabels(circuit, 'R_{2}').map((entry) => entry.role), ['part']);
  assert.deepEqual(findInLabels(circuit, 'R2').map((entry) => entry.text), ['R_{2}']);
  assert.equal(findInLabels(circuit, 'R_2').length, 0);
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

test('a search without markup looks through it, taking in the markup it covers whole', () => {
  const circuit = new Circuit();
  circuit.addComponent('nmos', { refdes: 'M1', x: 0, y: 0 });
  circuit.addComponent('switch_open', { refdes: 'S1', x: 400, y: 0 });
  circuit.setValue('S1', '$\\phi_1$');
  const note = circuit.addLabel({ text: 'V_{out} over V_{in,12}', x: 0, y: 400 });
  const next = (find, replacement) => findInLabels(circuit, find, { replacement }).map((entry) => [entry.text, entry.next]);
  // A whole group spanned: the replacement takes its place, markup and all.
  assert.deepEqual(next('M1', 'M2'), [['M_{1}', 'M2']]);
  // Inside a group: only the characters found change, the markup stays.
  assert.deepEqual(next('out', 'o'), [['V_{out} over V_{in,12}', 'V_{o} over V_{in,12}']]);
  assert.deepEqual(next('Vout', 'A'), [['V_{out} over V_{in,12}', 'A over V_{in,12}']]);
  // A TeX command is found by its name, and a whole `$...$` taken in.
  assert.deepEqual(next('phi', 'theta'), [['$\\phi_1$', '$theta_1$']]);
  assert.deepEqual(next('phi1', 'ck'), [['$\\phi_1$', '$ck$']]);
  // A match that would cut a group or command in two is no match.
  assert.equal(findInLabels(circuit, 'Vin,1').length, 0);
  assert.equal(findInLabels(circuit, 'hi').length, 0);
  // Replacing through markup renames a part through its own path.
  replaceInLabels(circuit, 'M1', 'M_{9}');
  assert.ok(circuit.components.has('M9'));
  assert.equal(note.text, 'V_{out} over V_{in,12}');
});

test('a regular expression matches the authored text, and its replacement may use its groups', () => {
  const circuit = new Circuit();
  const a = circuit.addLabel({ text: 'I_{bias} = 10 uA', x: 0, y: 0 });
  const b = circuit.addLabel({ text: 'I_{ref} = 2 uA', x: 0, y: 400 });
  const found = findInLabels(circuit, '(\\d+) uA', { regex: true, replacement: '$1 µA' });
  assert.deepEqual(found.map((entry) => entry.next), ['I_{bias} = 10 µA', 'I_{ref} = 2 µA']);
  assert.deepEqual(findInLabels(circuit, 'I_\\{\\w+\\}', { regex: true }).map((entry) => entry.count), [1, 1]);
  // Case follows the case option; $& and $$ expand, an absent group is kept.
  assert.equal(findInLabels(circuit, 'UA', { regex: true, matchCase: true }).length, 0);
  assert.deepEqual(findInLabels(circuit, 'uA', { regex: true, replacement: '[$&] $$ $9' }).map((entry) => entry.next)[0], 'I_{bias} = 10 [uA] $ $9');
  replaceInLabels(circuit, '= (\\d+)', '≈ $1', { regex: true });
  assert.deepEqual([a.text, b.text], ['I_{bias} ≈ 10 uA', 'I_{ref} ≈ 2 uA']);
  assert.throws(() => findInLabels(circuit, '(', { regex: true }), /^Error: invalid pattern: [A-Z][^/]*$/);
  assert.throws(() => findInLabels(circuit, 'x*', { regex: true }), /matches empty text/);
});

test('net names no label shows are found and renamed through the net', () => {
  const circuit = new Circuit();
  circuit.addComponent('resistor', { refdes: 'R1', x: 80, y: 0 });
  circuit.addComponent('resistor', { refdes: 'R2', x: 480, y: 0 });
  circuit.addComponent('resistor', { refdes: 'R3', x: 80, y: 400 });
  circuit.addComponent('resistor', { refdes: 'R4', x: 480, y: 400 });
  const hidden = namedNet(circuit, 'R1.b', 'R2.a', 'V_{mid}');
  const labelled = namedNet(circuit, 'R3.b', 'R4.a', 'V_{top}', { x: 280, y: 400 });
  const found = findInLabels(circuit, 'V');
  assert.deepEqual(found.map((entry) => [entry.key, entry.role, entry.text]).sort(), [
    [`label:${circuit.netLabels(labelled)[0].id}`, 'net', 'V_{top}'],
    [`net:${hidden.id}`, 'net', 'V_{mid}'],
  ]);
  assert.deepEqual(findInLabels(circuit, 'Vmid', { replacement: 'V_{half}' }).map((entry) => entry.next), ['V_{half}']);
  const { changed } = replaceInLabels(circuit, 'mid', 'half');
  assert.deepEqual(changed.map((entry) => [entry.role, entry.from, entry.to]), [['net', 'V_{mid}', 'V_{half}']]);
  assert.equal(hidden.name, 'V_{half}');
  assert.throws(() => replaceInLabels(circuit, 'V_{half}', ''), /changed nothing.*empty/);
  // A rail an unnamed ground symbol names is the symbol's, not text.
  circuit.addComponent('ground', { refdes: 'G1', x: 80, y: 800 });
  circuit.addComponent('resistor', { refdes: 'R5', x: 80, y: 720, r: 90 });
  circuit.connect('G1.gnd', 'R5.b');
  assert.ok([...circuit.nets.values()].some((net) => net.name === 'VSS'));
  assert.equal(findInLabels(circuit, 'VSS').length, 0);
});

test('replace leaves a global rail net named by its marker alone', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 0, y: 0 });
  c.addComponent('ground', { refdes: 'G1', x: 320, y: 0 });
  const rail = c.connect('R1.a', 'G1.gnd');
  const labelsBefore = c.labels.size;
  replaceInLabels(c, 'VSS', 'AGND');
  assert.equal(rail.name, 'VSS');
  assert.equal(c.labels.size, labelsBefore);
});
