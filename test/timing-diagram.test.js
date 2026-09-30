import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { runCommand } from '../src/core/commands.js';
import { addBeat, setSwitchFrom } from '../src/core/beats.js';
import { addTimingDiagram, defaultTimingPairs, parseTimingBits, timingColumns, timingRowGeometry } from '../src/core/timing-diagram.js';

const run = (circuit, ...lines) => lines.map((line) => runCommand(circuit, line));

function clocked() {
  const circuit = new Circuit();
  run(circuit,
    'add switch_open S1 --at 0 0', 'value S1 $\\varphi_1$',
    'add switch_open S2 --at 400 0', 'value S2 $\\varphi_2$',
    'add switch_open S3 --at 800 0', 'value S3 $\\overline{\\varphi_1}$');
  return circuit;
}
const rowsOf = (circuit, line) => runCommand(circuit, line).json;
const wavesOf = (circuit) => [...circuit.labels.values()].filter((l) => l.timing && l.kind === 'line');

test('a wave is typed as slots: 1 high, 0 low', () => {
  assert.equal(parseTimingBits('10 H L'), '1010');
  assert.throws(() => parseTimingBits('1x0'), /not "x"/);
});

test('waves repeat past both ends, and a gap keeps a pair from overlapping', () => {
  // φ1 = 10, φ2 = 01, kept apart: lead-in (last slot), slots, lead-out (first
  // slot), with a one-cell gap wherever one falls as the other rises.
  const { columns, levels } = timingColumns(['10', '01'], { slotCells: 4, pairs: [[0, 1]] });
  assert.deepEqual(columns.map((c) => `${c.kind}${c.w / 40}`), ['lead2', 'gap1', 'slot4', 'gap1', 'slot4', 'gap1', 'lead2']);
  assert.deepEqual(levels, [['0', '0', '1', '0', '0', '0', '1'], ['1', '0', '0', '0', '1', '0', '0']]);
  // With no pair, the columns abut.
  assert.deepEqual(timingColumns(['10', '01']).columns.map((c) => c.kind), ['lead', 'slot', 'slot', 'lead']);
  // A phase outside the pair changes as the gap opens.
  const three = timingColumns(['10', '01', '10'], { pairs: [[0, 1]] });
  assert.deepEqual(three.levels[2], ['0', '1', '1', '0', '0', '1', '1']);
  // A complement is its phase inverted, gaps included: high in them.
  assert.deepEqual(timingColumns(['10', '', '01'], { inverted: [null, 0, null], pairs: [[0, 2]] }).levels[1], ['1', '1', '0', '1', '1', '1', '0']);
  // A short wave holds its last level; no wave at all is low.
  assert.ok(timingColumns(['1', '0011']).levels[0].every((level) => level === '1'));
  assert.ok(timingColumns(['', '01']).levels[0].every((level) => level === '0'));
});

test('by default the phases kept apart are those never high together', () => {
  // φ1 and φ2 alternate; φ3 overlaps both; φ4 is never high.
  assert.deepEqual(defaultTimingPairs(['1000', '0010', '1110', '0000']), [[0, 1]]);
  // A complement row takes no part.
  assert.deepEqual(defaultTimingPairs(['10', '01'], new Set([1])), []);
});

test('a row draws with vertical edges', () => {
  const columns = [{ w: 80 }, { w: 160 }, { w: 80 }, { w: 40 }];
  assert.deepEqual(timingRowGeometry(['0', '1', '0', '0'], columns, 0, 0), [
    { x: 0, y: 80 }, { x: 80, y: 80 }, { x: 80, y: 0 }, { x: 240, y: 0 }, { x: 240, y: 80 }, { x: 360, y: 80 },
  ]);
});

test('the diagram sits under the drawing, one named row per phase, complements after their phase', () => {
  const circuit = clocked();
  const drawn = circuit.bounds();
  const rows = rowsOf(circuit, 'timing φ1=10 φ2=01');
  assert.deepEqual(rows.map((row) => [row.phase, row.bits, row.from]), [
    ['$\\varphi_{1}$', '10', 'typed'], ['$\\overline{\\varphi_{1}}$', '', 'complement'], ['$\\varphi_{2}$', '01', 'typed'],
  ]);
  const names = rows.map((row) => circuit.labels.get(row.label));
  assert.ok(names.every((label) => label.align === 'right' && label.math));
  assert.ok(wavesOf(circuit).every((line) => line.bbox().y >= drawn.y + drawn.h + 80), 'below the drawing');
  // Names and waves together are centred on the drawing's width.
  const ink = circuit.inkBounds();
  const parts = [...circuit.labels.values()].filter((l) => l.timing);
  const left = Math.min(...parts.map((l) => l.bbox().x));
  const right = Math.max(...parts.map((l) => l.bbox().x + l.bbox().w));
  const inkNoTiming = (() => { const copy = Circuit.fromJSON(circuit.toJSON()); for (const l of [...copy.labels.values()]) if (l.timing) copy.removeLabel(l.id); return copy.inkBounds(); })();
  assert.ok(Math.abs((left + right) / 2 - (inkNoTiming.x + inkNoTiming.w / 2)) <= 60, `centred (${left}..${right} under ${inkNoTiming.x}+${inkNoTiming.w})`);
  void ink;
  assert.throws(() => runCommand(circuit, 'timing φ9=01'), /no switch phase "φ9"/);
  assert.throws(() => runCommand(circuit, 'timing 01'), /not PHASE=WAVE/);
  assert.match(runCommand(circuit, 'help').text, /timing \[PHASE=WAVE \.\.\.\]/);
  const empty = new Circuit();
  run(empty, 'add switch_open S1 --at 0 0');
  assert.throws(() => runCommand(empty, 'timing'), /no switch has a phase/);
});

test('drawing it again replaces the diagram where its waves start, keeping each wave', () => {
  const circuit = clocked();
  runCommand(circuit, 'timing φ1=1100 φ2=0011');
  const start = (c) => Math.min(...wavesOf(c).map((l) => l.bbox().x));
  const x = start(circuit);
  const count = circuit.labels.size;
  for (let i = 0; i < 3; i += 1) runCommand(circuit, 'timing');
  assert.equal(start(circuit), x, 'the waves stay put');
  assert.equal(circuit.labels.size, count, 'replaced, not added');
  assert.deepEqual(rowsOf(circuit, 'timing ~φ1=0100').map((row) => row.bits), ['1100', '0100', '0011']);
  // Saved and loaded, the diagram still knows its waves and its pairs.
  runCommand(circuit, 'timing --gaps φ1:φ2');
  const loaded = Circuit.fromJSON(circuit.toJSON());
  assert.deepEqual(rowsOf(loaded, 'timing').map((row) => row.bits), ['1100', '0100', '0011']);
  assert.deepEqual(wavesOf(loaded)[0].timing.gaps, [['$\\varphi_{1}$', '$\\varphi_{2}$']]);
  runCommand(loaded, 'timing --no-gaps');
  assert.ok(wavesOf(loaded).every((line) => line.timing.gaps === false));
  assert.throws(() => runCommand(loaded, 'timing --gaps φ1'), /pairs such as/);
});

test('a complement drawn inverted keeps following its phase, until it has a wave of its own', () => {
  const circuit = clocked();
  runCommand(circuit, 'timing φ1=10 φ2=01');
  assert.deepEqual(rowsOf(circuit, 'timing φ1=1100').map((row) => row.from), ['typed', 'complement', 'diagram']);
  runCommand(circuit, 'timing ~φ1=0000');
  assert.deepEqual(rowsOf(circuit, 'timing φ1=11').map((row) => row.bits), ['11', '0000', '01']);
});

test('without typed waves, the beats set the timing; a phase with neither is low', () => {
  const circuit = clocked();
  assert.deepEqual(rowsOf(circuit, 'timing').map((row) => row.from), ['low', 'complement', 'low']);
  addBeat(circuit);
  addBeat(circuit);
  addBeat(circuit);
  setSwitchFrom(circuit, 0, '$\\varphi_1$', 'closed');
  setSwitchFrom(circuit, 1, '$\\varphi_1$', 'open');
  setSwitchFrom(circuit, 1, '$\\varphi_2$', 'closed');
  setSwitchFrom(circuit, 2, '$\\varphi_2$', 'open');
  assert.deepEqual(rowsOf(circuit, 'timing --beats').map((row) => row.bits), ['100', '', '010']);
  runCommand(circuit, 'timing φ2=111');
  setSwitchFrom(circuit, 2, '$\\varphi_1$', 'closed');
  assert.deepEqual(rowsOf(circuit, 'timing').map((row) => row.bits), ['100', '', '111']);
  assert.deepEqual(rowsOf(circuit, 'timing --beats').map((row) => row.bits), ['101', '', '010']);
});

test('line vertices can be removed down to two distinct points', () => {
  const circuit = new Circuit();
  const line = circuit.addAnnotation('line', { points: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 80 }, { x: 160, y: 80 }] });
  assert.equal(line.removeVertex(2), true);
  assert.deepEqual(line.points, [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 160, y: 80 }]);
  assert.equal(line.removeVertex(0), true);
  assert.deepEqual(line.anchor, { x: 80, y: 0 });
  assert.deepEqual(line.end, { x: 160, y: 80 });
  assert.equal(line.canRemoveVertex(0), false, 'a line keeps two points');
  assert.equal(line.removeVertex(1), false);
  assert.equal(line.points.length, 2);

  // Removing a vertex between two coincident neighbors leaves no zero-length leg.
  const back = circuit.addAnnotation('line', { points: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 80 }] });
  assert.equal(back.removeVertex(1), true);
  assert.deepEqual(back.points, [{ x: 0, y: 0 }, { x: 0, y: 80 }]);
  assert.equal(circuit.addAnnotation('line', { points: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 0, y: 0 }] }).canRemoveVertex(1), false);
});

test('an arrow keeps its two-cell minimum length when a vertex goes', () => {
  const circuit = new Circuit();
  const arrow = circuit.addAnnotation('arrow', { points: [{ x: 0, y: 0 }, { x: 0, y: 40 }, { x: 80, y: 40 }] });
  assert.equal(arrow.canRemoveVertex(1), true);
  assert.equal(arrow.canRemoveVertex(2), false, 'one cell left');
});

test('annotation vertex-rm removes one vertex by index', () => {
  const circuit = new Circuit();
  const line = circuit.addAnnotation('line', { points: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 80 }] });
  runCommand(circuit, `annotation vertex-rm ${line.id} 1`);
  assert.deepEqual(line.points, [{ x: 0, y: 0 }, { x: 80, y: 80 }]);
  assert.throws(() => runCommand(circuit, `annotation vertex-rm ${line.id} 0`), /cannot remove vertex 0/);
  assert.throws(() => runCommand(circuit, 'annotation vertex-rm nope 0'), /unknown line or arrow/);
});

test('a row\'s edges shift by whole cells: a bottom plate opening before its top plate', () => {
  const columns = [{ w: 80 }, { w: 160 }, { w: 160 }, { w: 80 }];
  const levels = ['0', '1', '0', '0'];
  // Falling a cell early; rising a cell late.
  assert.deepEqual(timingRowGeometry(levels, columns, 0, 0, { fall: -1 }).map((p) => p.x), [0, 80, 80, 200, 200, 480]);
  assert.deepEqual(timingRowGeometry(levels, columns, 0, 0, { rise: 1 }).map((p) => p.x), [0, 120, 120, 240, 240, 480]);
  // An edge stays within the columns beside it.
  assert.ok(timingRowGeometry(levels, columns, 0, 0, { fall: -8 }).every((p) => p.x >= 0 && p.x <= 480));
});

test('shifts are kept per phase, and a following complement mirrors its phase\'s', () => {
  const circuit = clocked();
  runCommand(circuit, 'timing φ1=10 φ2=01 --fall φ1=-1');
  const line = (phase) => wavesOf(circuit).find((l) => l.timing.phase === phase).points;
  const fallX = (points) => points.find((p, i) => i > 0 && points[i - 1].x === p.x && points[i - 1].y < p.y).x;
  const riseX = (points) => points.find((p, i) => i > 0 && points[i - 1].x === p.x && points[i - 1].y > p.y).x;
  const plain = Circuit.fromJSON(circuit.toJSON());
  runCommand(plain, 'timing --fall φ1=0');
  // φ1 falls a cell early; its complement rises a cell early with it.
  assert.equal(fallX(line('$\\varphi_{1}$')), fallX(wavesOf(plain).find((l) => l.timing.phase === '$\\varphi_{1}$').points) - 40);
  assert.equal(riseX(line('$\\overline{\\varphi_{1}}$')), riseX(wavesOf(plain).find((l) => l.timing.phase === '$\\overline{\\varphi_{1}}$').points) - 40);
  // Kept through redraws and a save; an edge not named keeps its shift.
  runCommand(circuit, 'timing --rise φ1=1');
  const loaded = Circuit.fromJSON(circuit.toJSON());
  assert.deepEqual(rowsOf(loaded, 'timing')[0].shift, { fall: -1, rise: 1 });
  assert.throws(() => runCommand(loaded, 'timing --fall φ1=early'), /PHASE=N/);
});
