import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { runCommand } from '../src/core/commands.js';
import { GRID } from '../src/core/grid.js';
import { svgString } from '../src/core/render.js';
import { busRowGeometry, busRowText, existingTimingDiagram, parseTimingBus, timingColumns } from '../src/core/timing-diagram.js';

function circuitWith(lines) {
  const circuit = new Circuit();
  for (const line of lines) runCommand(circuit, line);
  return circuit;
}

const bar = (circuit, phase = 'D') => [...circuit.labels.values()].find((label) => label.kind === 'box' && label.timing?.phase === phase && label.timing.busWave);
const legend = (circuit, phase = 'D') => [...circuit.labels.values()].find((label) => label.timing?.part === 'legend' && label.timing.phase === phase);

test('a bus wave is a letter or digit per slot', () => {
  assert.equal(parseTimingBus('a,a b c'), 'aabc');
  assert.throws(() => parseTimingBus('a-b'), /letter or digit/);
  assert.throws(() => parseTimingBus(''), /a value per slot/);
});

test('a bus row is stretches of one value: edges where it changes, the lead-in repeating the last slot', () => {
  const { columns } = timingColumns(['0000'], { slotCells: 4 });
  const { runs, edges } = busRowGeometry('aabc', columns);
  assert.deepEqual(runs.map((run) => [run.symbol, run.x0, run.x1, run.lead]), [
    ['c', 0, 2 * GRID, true],
    ['a', 2 * GRID, 10 * GRID, false],
    ['b', 10 * GRID, 14 * GRID, false],
    ['c', 14 * GRID, 18 * GRID, false],
    ['a', 18 * GRID, 20 * GRID, true],
  ]);
  assert.deepEqual(edges, [{ at: 0, x: 2 * GRID }, { at: 2, x: 10 * GRID }, { at: 3, x: 14 * GRID }, { at: 4, x: 18 * GRID }]);
  // No lead-in: only the changes inside.
  const bare = timingColumns(['00'], { slotCells: 4, lead: false });
  assert.deepEqual(busRowGeometry('ab', bare.columns).edges, [{ at: 1, x: 4 * GRID }]);
});

test('a word that does not fit is its letter, listed once in the legend', () => {
  const runs = [{ symbol: 'a', x0: 0, x1: 400, lead: false }, { symbol: 'b', x0: 400, x1: 440, lead: false }, { symbol: 'a', x0: 440, x1: 480, lead: false }, { symbol: 'c', x0: 480, x1: 520, lead: true }];
  const shown = busRowText(runs, { a: 'IDLE', b: 'WRITE' }, () => 100);
  assert.deepEqual(shown.texts, [[200, 'IDLE'], [420, 'b'], [460, 'a']]);
  assert.equal(shown.legend, 'b = WRITE, a = IDLE');
  const tex = busRowText([{ symbol: 'x', x0: 0, x1: 40, lead: false }, { symbol: 'y', x0: 40, x1: 80, lead: false }], { x: '$D_0$', y: 'READ' }, () => 100);
  assert.equal(tex.legend, '$x = D_0,\\ y = \\text{READ}$');
});

test('timing --bus and --word set a bus row, drawn as a bar with its X\'s and texts', () => {
  const circuit = circuitWith(['timing --add D --bus D=aabc --word "D:a=IDLE;D:b=$x_1$"']);
  const diagram = existingTimingDiagram(circuit);
  assert.equal(diagram.buses.get('D'), 'aabc');
  assert.deepEqual(diagram.words.get('D'), { a: 'IDLE', b: '$x_1$' });
  const box = bar(circuit);
  assert.deepEqual(box.timing.busWave.changes, [2 * GRID, 10 * GRID, 14 * GRID, 18 * GRID]);
  assert.deepEqual(box.timing.busWave.texts, [[6 * GRID, 'IDLE'], [12 * GRID, '$x_1$'], [16 * GRID, 'c']]);
  assert.equal(legend(circuit), undefined);
  const svg = svgString(circuit, {});
  assert.match(svg, /class="timing-bus"/);
  assert.match(svg, />IDLE</);
});

test('a bus row survives saving, keeps its height, and a word can change alone', () => {
  const circuit = circuitWith(['timing --add D --bus D=ab --word D:a=IDLE --height D=4']);
  const again = Circuit.fromJSON(JSON.parse(JSON.stringify(circuit.toJSON())));
  assert.equal(existingTimingDiagram(again).buses.get('D'), 'ab');
  assert.equal(bar(again).end.y - bar(again).anchor.y, 4 * GRID);
  runCommand(again, 'timing --word D:b=DONE');
  assert.deepEqual(existingTimingDiagram(again).words.get('D'), { a: 'IDLE', b: 'DONE' });
  runCommand(again, 'timing --word D:a=');
  assert.deepEqual(existingTimingDiagram(again).words.get('D'), { b: 'DONE' });
});

test('narrow slots show the letters and a legend beside the row', () => {
  const circuit = circuitWith(['timing --add D --slot 1 --lead off --bus D=ab --word "D:a=IDLE;D:b=WRITE"']);
  assert.deepEqual(bar(circuit).timing.busWave.texts.map(([, text]) => text), ['a', 'b']);
  const label = legend(circuit);
  assert.equal(label.text, 'a = IDLE, b = WRITE');
  assert.ok(label.bbox().x >= bar(circuit).anchor.x + 2 * GRID, 'beside the waves');
  // Redrawn in place, one legend still.
  runCommand(circuit, 'timing --word D:a=START');
  assert.equal([...circuit.labels.values()].filter((l) => l.timing?.part === 'legend').length, 1);
  assert.equal(legend(circuit).text, 'a = START, b = WRITE');
});

test('marks and arrows take a bus row\'s changes; a slot with no change has none', () => {
  const circuit = circuitWith(['timing --add D,CLK --bus D=aab CLK=010 --mark D:3']);
  assert.equal(existingTimingDiagram(circuit).marks.length, 1);
  assert.equal(existingTimingDiagram(circuit).missing.length, 0);
  assert.throws(() => runCommand(circuit, 'timing --mark D:2'), /has no edge/);
});

test('a switch phase cannot be a bus; a word needs a bus row', () => {
  const circuit = circuitWith(['add switch_open S1 --at 0 0', 'value S1 P1', 'timing --add D']);
  assert.throws(() => runCommand(circuit, 'timing --bus P1=ab'), /switch phase/);
  assert.throws(() => runCommand(circuit, 'timing --word D:a=IDLE'), /not a bus row/);
  assert.throws(() => runCommand(circuit, 'timing --add E --bus E=a-b'), /letter or digit/);
  assert.throws(() => runCommand(circuit, 'timing --word D=x'), /--word takes/);
});
