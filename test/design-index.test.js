import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { runCommand } from '../src/core/commands.js';
import { designIndex, normalizeTags, parseTags, searchDesign, searchKey, tagsText } from '../src/core/design-index.js';
import { loadDocument } from '../src/core/document.js';

const run = (circuit, ...lines) => lines.forEach((line) => runCommand(circuit, line));

function ota() {
  const circuit = new Circuit();
  run(circuit, 'add pmos M1 --at 0 0', 'add nmos M2 --at 0 240', 'add current_source I1 --at 400 0', 'add vcm --at 400 400',
    'connect M1.d M2.d --name V_{OUT}', 'annotation add N1 "tail bias" 400 -200', 'tag add ota bias');
  return circuit;
}

test('markup does not change a search word', () => {
  assert.equal(searchKey('V_{CM}'), 'vcm');
  assert.equal(searchKey('$\\phi_1$'), 'phi1');
  assert.equal(searchKey('current source'), searchKey('current_source'));
});

test('a design is found by its parts, nets, texts, types, name, and tags', () => {
  const index = designIndex(ota());
  const ids = (query) => searchDesign(index, 'five-t', query)?.hits.map((hit) => hit.id).sort() ?? null;
  assert.deepEqual(ids('vout'), [index.items.find((item) => item.kind === 'net').id]);
  assert.deepEqual(ids('V_OUT'), ids('vout'));
  assert.deepEqual(ids('pmos'), ['M1']);
  assert.deepEqual(ids('current source'), ['I1']);
  assert.deepEqual(ids('tail'), [index.items.find((item) => item.kind === 'text').id]);
  // Every word must be found; the name and tags count, with no hits to mark.
  assert.deepEqual(ids('five'), []);
  assert.deepEqual(ids('#bias'), []);
  assert.equal(ids('#tail'), null);
  assert.equal(ids('pmos opamp'), null);
  assert.equal(searchDesign(index, 'x', '   '), null);
});

test('a net hit marks its wires; a part hit its body', () => {
  const index = designIndex(ota());
  const net = index.items.find((item) => item.kind === 'net');
  assert.ok(net.boxes.length >= 1);
  assert.ok(net.boxes.every((b) => b.w >= 20 && b.h >= 20));
  assert.deepEqual(index.items.find((item) => item.id === 'M1').boxes, [index.items.find((item) => item.id === 'M1').boxes[0]]);
  // Plain JSON, so it can be cached.
  assert.deepEqual(JSON.parse(JSON.stringify(index)), index);
});

test('tags are normalized, saved, and edited by command', () => {
  assert.deepEqual(normalizeTags(['#ota', ' OTA ', 'two words', '', null]), ['ota', 'two-words']);
  const circuit = ota();
  assert.deepEqual(circuit.tags, ['ota', 'bias']);
  assert.deepEqual(loadDocument(circuit.toJSON()).tags, ['ota', 'bias']);
  assert.equal(runCommand(circuit, 'tag rm OTA').mutated, true);
  assert.deepEqual(circuit.tags, ['bias']);
  assert.equal(runCommand(circuit, 'tag add bias').mutated, false);
  assert.match(runCommand(circuit, 'tag').text, /#bias/);
  runCommand(circuit, 'tag set');
  assert.equal('tags' in circuit.toJSON(), false);
  assert.throws(() => runCommand(circuit, 'tag add'), /usage: tag/);
});

test('a tag field reads words split by spaces or commas', () => {
  assert.deepEqual(parseTags('ota, bias  #OTA folded-cascode'), ['ota', 'bias', 'folded-cascode']);
  assert.deepEqual(parseTags('   '), []);
  assert.equal(tagsText(['ota', 'bias']), 'ota bias');
  assert.deepEqual(parseTags(tagsText(['a', 'b'])), ['a', 'b']);
});
