import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { runCommand } from '../src/core/commands.js';
import { addTimingDiagram, timingWavePoints } from '../src/core/timing-diagram.js';

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
  assert.match(runCommand(circuit, 'help').text, /timing\s+- add a timing diagram/);
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
