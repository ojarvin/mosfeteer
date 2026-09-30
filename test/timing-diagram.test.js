import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { runCommand } from '../src/core/commands.js';
import { addBeat, setSwitchFrom } from '../src/core/beats.js';
import { addTimingDiagram, invertTimingBits, parseTimingBits, timingColumns, timingRowGeometry, timingWavePoints } from '../src/core/timing-diagram.js';

const run = (circuit, ...lines) => lines.map((line) => runCommand(circuit, line));

function twoPhases() {
  const circuit = new Circuit();
  run(circuit,
    'add switch_open S1 --at 0 0', 'add switch_open S2 --at 400 0', 'add switch_closed S3 --at 800 0',
    'value S1 phi1', 'value S2 phi2_long', 'value S3 phi1');
  return circuit;
}

test('the template waveform is 2 cells tall: 4 low, 8 high, 8 low, 4 high, vertical edges', () => {
  assert.deepEqual(timingWavePoints(0, 0), [
    { x: 0, y: 80 }, { x: 160, y: 80 }, { x: 160, y: 0 }, { x: 480, y: 0 },
    { x: 480, y: 80 }, { x: 800, y: 80 }, { x: 800, y: 0 }, { x: 960, y: 0 },
  ]);
});

test('a timing diagram has one labelled waveform per phase under the drawing', () => {
  const circuit = twoPhases();
  const drawn = circuit.bounds();
  const rows = addTimingDiagram(circuit);
  assert.deepEqual(rows.map((row) => row.phase), ['phi1', 'phi2_long']);
  const labels = rows.map((row) => circuit.labels.get(row.label));
  const lines = rows.map((row) => circuit.labels.get(row.line));
  assert.deepEqual(labels.map((label) => label.text), ['phi1', 'phi2_long']);
  assert.ok(labels.every((label) => !label.owner && !label.netId && label.align === 'right'));
  // Names share one right edge, flush with the drawing's left edge at their
  // widest, and each waveform starts one cell after it.
  const rights = labels.map((label) => label.bbox().x + label.bbox().w);
  assert.equal(rights[0], rights[1]);
  assert.equal(Math.min(...labels.map((label) => label.bbox().x)), drawn.x);
  for (const [row, line] of lines.entries()) {
    assert.equal(line.kind, 'line');
    assert.equal(line.points[0].x, rights[0] + 40);
    assert.ok(line.bbox().y >= drawn.y + drawn.h + 80, 'below the drawing');
    assert.equal(line.bbox().y - lines[0].bbox().y, row * 120);
    assert.equal(labels[row].anchorWorld().y, line.bbox().y + 40, 'name centred on its row');
  }
  assert.deepEqual(lines[0].points.map((p) => ({ x: p.x - lines[0].points[0].x, y: p.y - lines[0].bbox().y })), timingWavePoints(0, 0));
});

test('TeX phases draw their timing names as math', () => {
  const circuit = new Circuit();
  run(circuit, 'add switch_open S1 --at 0 0', 'value S1 $\\phi_1$');
  const [row] = addTimingDiagram(circuit);
  const label = circuit.labels.get(row.label);
  assert.equal(label.math, true);
  assert.equal(label.text, '$\\phi_1$');
});

test('timing command adds the template and needs a phase', () => {
  const circuit = new Circuit();
  run(circuit, 'add switch_open S1 --at 0 0');
  assert.throws(() => runCommand(circuit, 'timing'), /no switch has a phase/);
  assert.equal(circuit.labels.size, 1, 'nothing added on failure');
  runCommand(circuit, 'value S1 clk');
  const result = runCommand(circuit, 'timing');
  assert.equal(result.json.length, 1);
  assert.equal(circuit.labels.get(result.json[0].line).kind, 'line');
  assert.match(runCommand(circuit, 'help').text, /timing \[PHASE=WAVE \.\.\.\]/);
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

test('a complementary phase gets the inverse wave', () => {
  const wave = timingWavePoints(0, 0);
  const inverse = timingWavePoints(0, 0, { inverted: true });
  assert.deepEqual(inverse.map((p) => p.x), wave.map((p) => p.x));
  assert.deepEqual(inverse.map((p) => p.y), wave.map((p) => 80 - p.y));
  const circuit = new Circuit();
  // The complement is drawn first; its phase still leads the diagram, and
  // the complement comes right after it.
  runCommand(circuit, 'add switch_open S2 --at 0 400');
  runCommand(circuit, 'value S2 $\\overline{\\varphi_1}$');
  runCommand(circuit, 'add switch_open S3 --at 0 800');
  runCommand(circuit, 'value S3 $\\varphi_2$');
  runCommand(circuit, 'add switch_open S1 --at 0 0');
  runCommand(circuit, 'value S1 $\\varphi_1$');
  const rows = addTimingDiagram(circuit);
  assert.deepEqual(rows.map((row) => row.phase), ['$\\varphi_{1}$', '$\\overline{\\varphi_{1}}$', '$\\varphi_{2}$']);
  const [first, second] = rows.map((row) => circuit.labels.get(row.line).points);
  assert.deepEqual(second.map((p) => p.y - second[0].y), first.map((p) => first[0].y - p.y));
});

function clocked() {
  const circuit = new Circuit();
  run(circuit,
    'add switch_open S1 --at 0 0', 'value S1 $\\varphi_1$',
    'add switch_open S2 --at 400 0', 'value S2 $\\varphi_2$',
    'add switch_open S3 --at 800 0', 'value S3 $\\overline{\\varphi_1}$');
  return circuit;
}
const waves = (circuit, row) => row.lines.map((id) => circuit.labels.get(id).points);

test('a wave string: slots of 0 and 1, one-cell gaps, and don\'t-cares', () => {
  assert.equal(parseTimingBits('00 11 L H - x X ^'), '001101_xx^');
  assert.throws(() => parseTimingBits('0a1'), /not "a"/);
  assert.equal(invertTimingBits('01_^x'), '10^_x');
  // A gap in any row is a one-cell column in every row.
  const columns = timingColumns(['1_0', '0^1'], 0, 4);
  assert.deepEqual(columns.map((c) => [c.x, c.w]), [[0, 160], [160, 40], [200, 160]]);
  const { lines, crosses } = timingRowGeometry('1_0', columns, 0);
  assert.deepEqual(lines, [[{ x: 0, y: 0 }, { x: 160, y: 0 }, { x: 160, y: 80 }, { x: 360, y: 80 }]]);
  assert.deepEqual(crosses, []);
  // A don't-care breaks the wave and draws a crossed band of its own.
  const dc = timingRowGeometry('0x1', timingColumns(['0x1'], 0, 1), 0);
  assert.deepEqual(dc.lines, [[{ x: 0, y: 80 }, { x: 40, y: 80 }], [{ x: 80, y: 0 }, { x: 120, y: 0 }]]);
  assert.equal(dc.crosses.length, 4);
});

test('typed waves draw each row; a complement left unset is its phase inverted', () => {
  const circuit = clocked();
  // Rows are numbered as drawn: φ1, its complement, φ2.
  const rows = runCommand(circuit, 'timing φ1=1_0_ 3=0_1_ --slot 2').json;
  assert.deepEqual(rows.map((row) => row.bits), ['1_0_', '0^1^', '0_1_']);
  // φ1: high 2 cells, low through the gap and the next slot and gap.
  assert.deepEqual(waves(circuit, rows[0])[0].map((p) => p.x - waves(circuit, rows[0])[0][0].x), [0, 80, 80, 240]);
  assert.throws(() => runCommand(circuit, 'timing φ9=01'), /no switch phase "φ9"/);
  assert.throws(() => runCommand(circuit, 'timing 01'), /not PHASE=WAVE/);
});

test('drawing it again replaces the diagram where it stands, keeping each wave', () => {
  const circuit = clocked();
  runCommand(circuit, 'timing φ1=1100 φ2=0011');
  const first = circuit.labels.size;
  const origin = (c) => Math.min(...[...c.labels.values()].filter((l) => l.timing && l.kind === 'line').map((l) => l.bbox().x));
  const x = origin(circuit);
  const rows = runCommand(circuit, 'timing ~φ1=x0x0').json;
  assert.deepEqual(rows.map((row) => row.bits), ['1100', 'x0x0', '0011']);
  assert.equal(origin(circuit), x);
  assert.ok(circuit.labels.size >= first);
  // Saved and loaded, the diagram still knows its waves.
  const loaded = Circuit.fromJSON(circuit.toJSON());
  assert.deepEqual(runCommand(loaded, 'timing').json.map((row) => row.bits), ['1100', 'x0x0', '0011']);
});

test('without typed waves, the beats set the timing: one slot per beat', () => {
  const circuit = clocked();
  addBeat(circuit);
  addBeat(circuit);
  addBeat(circuit);
  setSwitchFrom(circuit, 0, '$\\varphi_1$', 'closed');
  setSwitchFrom(circuit, 1, '$\\varphi_1$', 'open');
  setSwitchFrom(circuit, 1, '$\\varphi_2$', 'closed');
  setSwitchFrom(circuit, 2, '$\\varphi_2$', 'open');
  assert.deepEqual(runCommand(circuit, 'timing').json.map((row) => row.bits), ['100', '011', '010']);
  // --beats takes the waves from the beats again over the drawn ones.
  runCommand(circuit, 'timing φ2=111');
  setSwitchFrom(circuit, 2, '$\\varphi_1$', 'closed');
  assert.deepEqual(runCommand(circuit, 'timing --beats').json.map((row) => row.bits), ['101', '010', '010']);
});

test('a complement drawn inverted keeps following its phase', () => {
  const circuit = clocked();
  runCommand(circuit, 'timing φ1=1_0_ φ2=0_1_');
  assert.deepEqual(runCommand(circuit, 'timing φ1=10').json.map((row) => row.bits), ['10', '01', '0_1_']);
  // Given a wave of its own, it keeps that one.
  runCommand(circuit, 'timing ~φ1=0000');
  assert.deepEqual(runCommand(circuit, 'timing φ1=11').json.map((row) => row.bits), ['11', '0000', '0_1_']);
});
