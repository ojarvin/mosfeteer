import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { runCommand } from '../src/core/commands.js';
import { GRID } from '../src/core/grid.js';
import { svgString } from '../src/core/render.js';
import { analogRowGeometry, existingTimingDiagram, parseTimingValue, parseTimingWave, timingColumns } from '../src/core/timing-diagram.js';

function circuitWith(lines) {
  const circuit = new Circuit();
  for (const line of lines) runCommand(circuit, line);
  return circuit;
}

const ramp = () => circuitWith(['timing --add CLK,VDD', 'timing CLK=0101 VDD=0,.35,.7,1']);
const box = (circuit, phase) => [...circuit.labels.values()].find((label) => label.kind === 'box' && label.timing?.phase === phase && label.timing.analog);
const name = (circuit, phase) => [...circuit.labels.values()].find((label) => label.kind === 'label' && label.timing?.phase === phase && !label.timing.part);

test('a wave with commas, a dot or a minus is analog; plain 1s and 0s stay digital', () => {
  assert.deepEqual(parseTimingWave('0101'), { bits: '0101' });
  assert.deepEqual(parseTimingWave('0,.5,1'), { values: [0, 0.5, 1] });
  assert.deepEqual(parseTimingWave('-.25'), { values: [-0.25] });
  assert.deepEqual(parseTimingWave([0, 1]), { values: [0, 1] }, 'a list is analog even of 0s and 1s');
  assert.equal(parseTimingValue('.35'), 0.35);
  assert.throws(() => parseTimingValue('1.5'), /from -1 to 1/);
  assert.throws(() => parseTimingWave('0,x'), /a number from -1 to 1/);
});

test('an analog row joins its values straight from slot start to slot start, the first and last held outside', () => {
  const { columns } = timingColumns(['0000'], { slotCells: 4 });
  const { trace, points } = analogRowGeometry([0, 0.5, 1], columns);
  const slot = 4 * GRID;
  const lead = 2 * GRID;
  assert.deepEqual(trace, [
    { x: 0, v: 0 }, { x: lead, v: 0 }, { x: lead + slot, v: 0.5 }, { x: lead + 2 * slot, v: 1 }, { x: lead + 4 * slot + lead, v: 1 },
  ]);
  assert.deepEqual(points.map((p) => p.v), [0, 0.5, 1, 1, 1], 'a point at every slot start, through the lead-out');
  // Held: each value through its slot, a step at the next.
  const held = analogRowGeometry([0, 0.5], columns, { hold: true }).trace;
  assert.deepEqual(held, [{ x: 0, v: 0 }, { x: lead + slot, v: 0 }, { x: lead + slot, v: 0.5 }, { x: lead + 4 * slot + lead, v: 0.5 }]);
});

test('timing VDD=0,.35,.7,1 draws the row as a box on the grid with its curve inside, saved and read back', () => {
  const circuit = ramp();
  const wave = box(circuit, 'VDD');
  assert.ok(wave, 'an analog box');
  const b = wave.bbox();
  for (const side of [b.x, b.y, b.w, b.h]) assert.ok(Number.isInteger(side / GRID), 'the box on the grid');
  assert.equal(b.h, 2 * GRID);
  assert.deepEqual(name(circuit, 'VDD').timing.values, [0, 0.35, 0.7, 1]);
  assert.match(svgString(circuit), /class="timing-analog"/);
  const reloaded = Circuit.fromJSON(JSON.parse(JSON.stringify(circuit.toJSON())));
  assert.deepEqual(existingTimingDiagram(reloaded).values.get('VDD'), [0, 0.35, 0.7, 1]);
  // Redrawn without the wave given, it keeps it.
  runCommand(reloaded, 'timing CLK=0011');
  assert.deepEqual(name(reloaded, 'VDD').timing.values, [0, 0.35, 0.7, 1]);
});

test('a row below zero is drawn about a middle zero line; --hold holds, --linear joins again', () => {
  const circuit = circuitWith(['timing --add VIN', 'timing VIN=0,.5,-.5,0']);
  assert.equal(box(circuit, 'VIN').timing.analog.bipolar, true);
  assert.match(svgString(circuit), /stroke-dasharray/, 'the dashed zero line');
  runCommand(circuit, 'timing --hold VIN');
  assert.equal(name(circuit, 'VIN').timing.hold, true);
  const trace = box(circuit, 'VIN').timing.analog.trace;
  assert.ok(trace.some(([x], i) => i && trace[i - 1][0] === x), 'a step');
  runCommand(circuit, 'timing --linear VIN');
  assert.equal(name(circuit, 'VIN').timing.hold, undefined);
  assert.throws(() => runCommand(circuit, 'timing --add CLK --hold CLK'), /not analog/);
});

test('--height makes a row taller in even cells, the rows below moving down, its name centered', () => {
  const circuit = circuitWith(['timing --add CLK,VDD', 'timing CLK=01 VDD=0,1']);
  const before = name(circuit, 'CLK').anchorWorld().y;
  runCommand(circuit, 'timing --height VDD=4');
  assert.equal(box(circuit, 'VDD').bbox().h, 4 * GRID);
  assert.equal(name(circuit, 'CLK').anchorWorld().y, before, 'the row above stays');
  const vdd = box(circuit, 'VDD').bbox();
  assert.equal(name(circuit, 'VDD').anchorWorld().y, vdd.y + vdd.h / 2);
  assert.throws(() => runCommand(circuit, 'timing --height VDD=3'), /2, 4, 6/);
  // Saved and kept.
  const reloaded = Circuit.fromJSON(JSON.parse(JSON.stringify(circuit.toJSON())));
  runCommand(reloaded, 'timing CLK=10');
  assert.equal(box(reloaded, 'VDD').bbox().h, 4 * GRID);
});

test('a mark on an analog point between its extremes is a threshold; arrows attach to points', () => {
  const circuit = ramp();
  runCommand(circuit, 'timing --mark VDD:3 --arrow VDD:3>CLK:4');
  const analog = box(circuit, 'VDD').timing.analog;
  assert.equal(analog.thresholds.length, 1);
  assert.equal(analog.thresholds[0][1], 0.7, 'at the point\'s level');
  const parts = [...circuit.labels.values()].filter((label) => label.timing?.part);
  assert.ok(parts.some((label) => label.timing.part === 'mark'));
  assert.ok(parts.some((label) => label.timing.part === 'arrow'));
  // A mark at full is a plain mark.
  runCommand(circuit, 'timing --clear marks --mark VDD:4');
  assert.equal(box(circuit, 'VDD').timing.analog.thresholds, undefined);
});

test('a switch phase stays digital: analog values for it are refused', () => {
  const circuit = circuitWith(['add switch_open S1 --at 0 0', 'value S1 P1']);
  assert.throws(() => runCommand(circuit, 'timing P1=0,.5'), /switch phase/);
});
