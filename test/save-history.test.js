import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { runCommand } from '../src/core/commands.js';
import { loadDocument } from '../src/core/document.js';
import {
  SAVE_POINTS_KEPT, applyPatch, checkpointHistory, diffLines, historyEntries, historyEntryState, historyText,
  normalizeHistory, pinHistoryEntry, removeHistoryEntry, settledHistory, textHash, unpinHistoryEntry,
} from '../src/core/save-history.js';

function design() {
  const circuit = new Circuit();
  for (const line of ['add nmos M1 --at 0 240', 'add pmos M2 --at 0 0', 'connect M1.d M2.d --name V_{out}']) runCommand(circuit, line);
  return circuit.toJSON();
}

/** Write `state` over `disk` as a writer does, with or without a save point. */
function write(disk, state, options = {}) {
  const next = JSON.parse(JSON.stringify(state));
  next.history = settledHistory(next, { previous: disk, ...options });
  if (!next.history) delete next.history;
  return JSON.parse(JSON.stringify(next));
}

/** `state` with part `refdes` moved right a cell. */
function moved(state, refdes = 'M1') {
  const circuit = loadDocument(state);
  const part = circuit.components.get(refdes);
  runCommand(circuit, `move ${refdes} ${part.transform.x + 40} ${part.transform.y}`);
  return circuit.toJSON();
}

const entries = (state) => historyEntries(state.history, historyText(state));

test('a line patch turns one text into the other, whatever they are', () => {
  for (let trial = 0; trial < 500; trial++) {
    const lines = () => Array.from({ length: Math.floor(Math.random() * 30) }, () => 'abc'[Math.floor(Math.random() * 3)]);
    const a = lines();
    const b = trial % 2 ? lines() : a.map((line) => (Math.random() < 0.2 ? 'z' : line)).filter(() => Math.random() < 0.9);
    assert.deepEqual(applyPatch(a, diffLines(a, b)), b);
  }
  assert.deepEqual(diffLines(['a', 'b'], ['a', 'b']), []);
  assert.deepEqual(diffLines(['a', 'b', 'c', 'd'], ['a', 'x', 'c', 'd']), [1, -1, ['x']]);
});

test('what a save point keeps leaves out history, windows, names, and tags, but keeps measured math', () => {
  const plain = design();
  const state = { ...plain, tags: ['ota'], names: ['amp'], windows: { calculator: { history: [{ input: '1', result: '1' }] } }, history: { base: 'x', entries: [] } };
  state.labels[0] = { ...state.labels[0], mathBox: { w: 1, h: 2 } };
  const text = historyText(state);
  for (const key of ['"history"', '"windows"', '"names"', '"tags"']) assert.ok(!text.includes(key), key);
  assert.ok(text.includes('"mathBox"'), 'a save point draws its math where nothing measures it');
});

test('a math label measured again is no new save point', () => {
  const state = design();
  state.labels[0] = { ...state.labels[0], math: true, mathBox: { w: 160, h: 80 } };
  let disk = write(null, state, { savePoint: true });
  const remeasured = JSON.parse(JSON.stringify(disk));
  remeasured.labels[0].mathBox = { w: 240, h: 80 };
  disk = write(disk, remeasured, { savePoint: true });
  assert.equal(entries(disk).length, 1);
  assert.equal(entries(disk)[0].pinned, undefined);
});

test('each save adds a save point; an unchanged drawing adds none', () => {
  let disk = write(null, design(), { savePoint: true });
  assert.equal(entries(disk).length, 1);
  assert.equal(entries(disk)[0].text, historyText(disk));
  disk = write(disk, { ...disk, tags: ['changed'] }, { savePoint: true });
  assert.equal(entries(disk).length, 1, 'tags are not the drawing');
  const first = disk;
  disk = write(disk, moved(disk), { savePoint: true });
  const list = entries(disk);
  assert.equal(list.length, 2);
  assert.equal(list[1].text, historyText(first));
  assert.deepEqual(historyEntryState(list[1]).components, first.components);
});

test('a restored save point written back is that entry, the file\'s: saving it adds none', () => {
  let disk = write(null, design(), { savePoint: true });
  const first = disk;
  disk = write(disk, moved(disk), { savePoint: true });
  const restored = { ...historyEntryState(entries(disk)[1]), history: disk.history };
  disk = write(disk, restored);
  assert.equal(entries(disk).length, 2);
  assert.equal(historyText(disk), historyText(first));
  disk = write(disk, disk, { savePoint: true });
  assert.equal(entries(disk).length, 2, 'the history holds the drawing already');
});

test('only the newest save points are kept; pinned checkpoints stay', () => {
  const drawn = design();
  let disk = write(null, drawn, { savePoint: true });
  const firstId = entries(disk)[0].id;
  disk = { ...disk, history: pinHistoryEntry(disk.history, historyText(disk), firstId, { name: 'start', comment: 'as drawn' }) };
  for (let i = 0; i < SAVE_POINTS_KEPT + 3; i++) disk = write(disk, moved(disk, i % 2 ? 'M1' : 'M2'), { savePoint: true });
  const list = entries(disk);
  assert.equal(list.filter((entry) => !entry.pinned).length, SAVE_POINTS_KEPT);
  const pinned = list.find((entry) => entry.pinned);
  assert.equal(pinned.id, firstId);
  assert.equal(pinned.name, 'start');
  assert.equal(pinned.comment, 'as drawn');
  assert.equal(pinned.text, historyText(drawn));
  assert.equal(list.at(-1).id, firstId, 'oldest last');
});

test('a write that is not a save carries the history over to the new drawing', () => {
  let disk = write(null, design(), { savePoint: true });
  disk = write(disk, moved(disk), { savePoint: true });
  const before = entries(disk).map((entry) => entry.text);
  // A scripted command rewrites the file: no save point, history intact.
  disk = write(disk, moved(disk, 'M2'));
  const after = entries(disk);
  assert.deepEqual(after.map((entry) => entry.text), before);
  assert.notEqual(after[0].text, historyText(disk));
});

test('a writer whose history is stale gets the file\'s; one that fits nothing is kept as it came', () => {
  const start = write(null, design(), { savePoint: true });
  const saved = write(start, moved(start), { savePoint: true });
  // A client that still holds the first history saves over the second file.
  const stale = { ...moved(saved, 'M2'), history: start.history };
  const next = write(saved, stale, { savePoint: true });
  assert.equal(entries(next).length, 3);
  // Edited outside the editor: nothing fits, nothing is applied or lost.
  const outside = { ...saved, components: saved.components.slice(1) };
  const kept = write(null, outside);
  assert.deepEqual(kept.history, saved.history);
  assert.equal(entries(kept), null);
});

test('a design saved under a new name keeps its history read against the file it came from', () => {
  const disk = write(null, design(), { savePoint: true });
  const edited = moved(disk);
  const copy = write(null, edited, { savePoint: true, baseText: historyText(disk) });
  const list = entries(copy);
  assert.equal(list.length, 2);
  assert.equal(list[1].text, historyText(disk));
});

test('pin, unpin, remove, and checkpoint edit the entries in place', () => {
  let disk = write(null, design(), { savePoint: true });
  disk = write(disk, moved(disk), { savePoint: true });
  disk = write(disk, moved(disk, 'M2'), { savePoint: true });
  const base = historyText(disk);
  const [newest, middle, oldest] = entries(disk);
  const removed = removeHistoryEntry(disk.history, base, middle.id);
  const left = historyEntries(removed, base);
  assert.deepEqual(left.map((entry) => entry.id), [newest.id, oldest.id]);
  assert.equal(left[1].text, oldest.text, 'the neighbors are stored against each other');
  const pinned = pinHistoryEntry(disk.history, base, oldest.id, { name: ' first ' });
  assert.equal(historyEntries(pinned, base)[2].name, 'first');
  const unpinned = unpinHistoryEntry(pinned, base, oldest.id);
  assert.equal(historyEntries(unpinned, base)[2].pinned, undefined);
  assert.equal(removeHistoryEntry(disk.history, 'not the file', middle.id), null);

  // A checkpoint of the file pins its newest entry when that is the drawing...
  const same = checkpointHistory(disk.history, base, { name: 'works' });
  assert.equal(same.id, newest.id);
  assert.equal(historyEntries(same.history, base).length, 3);
  // ...or adds one for it (the file was changed by a script since).
  const scripted = write(disk, moved(disk));
  const added = checkpointHistory(scripted.history, historyText(scripted), { name: 'after script' });
  const list = historyEntries(added.history, historyText(scripted));
  assert.equal(list.length, 4);
  assert.equal(list[0].name, 'after script');
  assert.equal(list[0].text, historyText(scripted));
});

test('removing every entry leaves an empty history, which a later write keeps empty', () => {
  let disk = write(null, design(), { savePoint: true });
  const id = entries(disk)[0].id;
  disk = { ...disk, history: removeHistoryEntry(disk.history, historyText(disk), id) };
  assert.deepEqual(disk.history.entries, []);
  const next = write(disk, moved(disk));
  assert.deepEqual(next.history.entries, []);
  assert.equal(write(null, design()).history, undefined, 'no history at all is not written');
});

test('a stored history is checked, and a damaged entry ends what can be read', () => {
  assert.equal(normalizeHistory(null), null);
  assert.equal(normalizeHistory({ base: 1, entries: [] }), null);
  let disk = write(null, design(), { savePoint: true });
  disk = write(disk, moved(disk), { savePoint: true });
  const damaged = JSON.parse(JSON.stringify(disk.history));
  damaged.entries[1].hash = textHash('something else');
  assert.equal(historyEntries(damaged, historyText(disk)).length, 1);
  const bad = JSON.parse(JSON.stringify(disk.history));
  bad.entries[1].patch = ['not a patch op', 0];
  assert.equal(normalizeHistory(bad).entries.length, 1);
});

test('the history is saved with the circuit and survives a reload unchanged', () => {
  const disk = write(null, design(), { savePoint: true });
  const circuit = loadDocument(disk);
  assert.deepEqual(circuit.toJSON().history, disk.history);
});
