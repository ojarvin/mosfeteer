import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { runCommand } from '../src/core/commands.js';
import { addBeat, setSwitchFrom } from '../src/core/beats.js';
import { addTimingDiagram, parseTimingBits, timingColumns, timingRowGeometry } from '../src/core/timing-diagram.js';

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

test('a wave is typed as slots: 1 high, 0 low, x don\'t care', () => {
  assert.equal(parseTimingBits('10 H L x X'), '1010xx');
  assert.throws(() => parseTimingBits('1_0'), /not "_"/);
});

test('waves repeat past both ends, and a non-overlap gap opens at every change', () => {
  // φ1 = 10, φ2 = 01: lead-in (last slot), slots, lead-out (first slot),
  // with a one-cell gap wherever either changes.
  const { columns, levels } = timingColumns(['10', '01'], { slotCells: 4 });
  assert.deepEqual(columns.map((c) => `${c.kind}${c.w / 40}`), ['lead2', 'gap1', 'slot4', 'gap1', 'slot4', 'gap1', 'lead2']);
  assert.deepEqual(levels, [['0', '0', '1', '0', '0', '0', '1'], ['1', '0', '0', '0', '1', '0', '0']]);
  // In the gaps both are low: no overlap. Without gaps the columns abut.
  assert.deepEqual(timingColumns(['10', '01'], { gaps: false }).columns.map((c) => c.kind), ['lead', 'slot', 'slot', 'lead']);
  // A complement is its phase inverted, gaps included: high in them.
  assert.deepEqual(timingColumns(['10', ''], { inverted: [null, 0] }).levels[1], ['1', '1', '0', '1', '1', '1', '0']);
  // A short wave holds its last level; no wave at all is low.
  const held = timingColumns(['1', '0011']);
  assert.ok(held.levels[0].every((level) => level === '1'));
  assert.ok(timingColumns(['', '01']).levels[0].every((level) => level === '0'));
});

test('a row draws as a wave with vertical edges; a don\'t care is a crossed band', () => {
  const columns = [{ w: 80 }, { w: 160 }, { w: 80 }];
  assert.deepEqual(timingRowGeometry(['0', '1', '0'], columns, 0, 0).lines, [[
    { x: 0, y: 80 }, { x: 80, y: 80 }, { x: 80, y: 0 }, { x: 240, y: 0 }, { x: 240, y: 80 }, { x: 320, y: 80 },
  ]]);
  const dc = timingRowGeometry(['0', 'x', '1'], columns, 0, 0);
  assert.deepEqual(dc.lines, [[{ x: 0, y: 80 }, { x: 80, y: 80 }], [{ x: 240, y: 0 }, { x: 320, y: 0 }]]);
  assert.equal(dc.crosses.length, 4);
  // Neighbouring don't-care columns (a gap beside one) draw as one band.
  const wide = timingRowGeometry(['x', 'x', '1'], columns, 0, 0);
  assert.equal(wide.crosses.length, 4);
  assert.deepEqual(wide.crosses[0], [{ x: 0, y: 0 }, { x: 240, y: 0 }]);
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
  assert.deepEqual(rowsOf(circuit, 'timing ~φ1=x0x0').map((row) => row.bits), ['1100', 'x0x0', '0011']);
  // Saved and loaded, the diagram still knows its waves and gaps setting.
  runCommand(circuit, 'timing --no-gaps');
  const loaded = Circuit.fromJSON(circuit.toJSON());
  assert.deepEqual(rowsOf(loaded, 'timing').map((row) => row.bits), ['1100', 'x0x0', '0011']);
  assert.ok(wavesOf(loaded).every((line) => line.timing.gaps === false));
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
