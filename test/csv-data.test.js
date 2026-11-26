import test from 'node:test';
import assert from 'node:assert/strict';
import { cellNumber, guessFormat, readTable, splitLine, suggestScale, suggestedEvery, tableTraces } from '../src/core/csv-data.js';
import { dataPlotFromText } from '../src/core/data-plot.js';
import { MAX_DATA_POINTS } from '../src/core/model.js';

test('a cell is a number, a value with an SI suffix, or a gap', () => {
  assert.equal(cellNumber(' 1.5e-3 '), 1.5e-3);
  assert.equal(cellNumber('"42"'), 42);
  assert.equal(cellNumber('1,5', ','), 1.5);
  assert.equal(cellNumber('2.2k'), 2200);
  assert.equal(cellNumber('3n'), 3e-9);
  assert.ok(Number.isNaN(cellNumber('')));
  assert.ok(Number.isNaN(cellNumber('V(out)')));
  assert.ok(Number.isNaN(cellNumber('NaN')));
});

test('a line splits at its separator; quotes hold one, and a space separator is any run', () => {
  assert.deepEqual(splitLine('a,"b,c","say ""hi""",4', ','), ['a', 'b,c', 'say "hi"', '4']);
  assert.deepEqual(splitLine('  1   2\t3 ', ' '), ['1', '2', '3']);
  assert.deepEqual(splitLine('1;;3', ';'), ['1', '', '3']);
});

test('the separator and decimal sign are the ones that read the most numbers', () => {
  assert.deepEqual(guessFormat('t,v\n0,1\n1,2\n'), { separator: ',', decimal: '.' });
  assert.deepEqual(guessFormat('t;v\n0,5;1,25\n1,5;2,75\n'), { separator: ';', decimal: ',' });
  assert.deepEqual(guessFormat('time\tV(out)\n0\t1.5\n1e-9\t1.6\n'), { separator: '\t', decimal: '.' });
  assert.deepEqual(guessFormat('  0.0   1.0\n  1.0   2.0\n'), { separator: ' ', decimal: '.' });
});

test('a table skips the rows before its data, and the last of them names the columns', () => {
  const text = '﻿Scope export\n# saved 2026-11-02\n\nTime (s),CH1 (V),CH2 (V)\n0,0.1,1\n1e-6,0.2,\n2e-6,0.3,3\n';
  const table = readTable(text);
  assert.equal(table.skip, 2);
  assert.equal(table.header, true);
  assert.deepEqual(table.names, ['Time (s)', 'CH1 (V)', 'CH2 (V)']);
  assert.deepEqual(table.columns[1], [0.1, 0.2, 0.3]);
  // A column with a gap is still numbers; the gap's row is left out of its trace.
  assert.deepEqual(table.numeric, [0, 1, 2]);
  assert.equal(table.x, 0);
  assert.deepEqual(table.y, [1, 2]);
  const traces = tableTraces(table, table.x, table.y);
  assert.deepEqual(traces.map((t) => t.label), ['CH1 (V)', 'CH2 (V)']);
  assert.deepEqual(traces[1].points, [[0, 1], [2e-6, 3]]);
});

test('with no header the columns are numbered, and one column plots against its row', () => {
  const plain = readTable('1 2\n3 4\n5 6\n');
  assert.equal(plain.skip, 0);
  assert.equal(plain.header, false);
  assert.deepEqual(plain.names, ['Column 1', 'Column 2']);
  const single = readTable('v\n5\n6\n7\n');
  assert.equal(single.x, null);
  assert.deepEqual(single.y, [0]);
  assert.deepEqual(tableTraces(single, null, [0])[0].points, [[0, 5], [1, 6], [2, 7]]);
});

test('what is given overrides the guesses', () => {
  const table = readTable('a;b\n1;2\n3;4\n', { separator: ';', decimal: '.', skip: 0, header: false });
  assert.equal(table.skip, 0);
  assert.deepEqual(table.names, ['Column 1', 'Column 2']);
  assert.deepEqual(table.columns[0].map(Number.isFinite), [false, true, true]);
  assert.deepEqual(tableTraces(readTable('a;b\n1;2\n3;4\n', { skip: 1 }), 1, [0])[0].points, [[2, 1], [4, 3]]);
});

test('a positive column over more than three decades is suggested a log scale', () => {
  assert.equal(suggestScale([1, 10, 100, 1e4]), 'log');
  assert.equal(suggestScale([1, 10, 100]), 'linear');
  assert.equal(suggestScale([-1, 10, 1e6]), 'linear');
  const bode = readTable('f,dB\n1,0\n10,-1\n1e5,-40\n');
  assert.deepEqual(bode.scale, { x: 'log', y: 'linear' });
});

test('a simulator\'s x,y column pairs: each y is read against its own x, and the x columns are not suggested', () => {
  // As Cadence ViVA exports them: the second signal on a grid of its own.
  const lines = ['/out X,/out Y,/in X,/in Y'];
  for (let i = 0; i < 6; i++) lines.push([i, i, i * 2, -i].join(','));
  const table = readTable(lines.join('\n'));
  assert.equal(table.x, 0);
  assert.deepEqual(table.y, [1, 3]);
  assert.deepEqual([...table.pairs], [[1, 0], [3, 2]]);
  const [out, input] = tableTraces(table, 0, table.y);
  assert.deepEqual(out.points.slice(0, 3), [[0, 0], [1, 1], [2, 2]]);
  assert.deepEqual(input.points.slice(0, 3), [[0, 0], [2, -1], [4, -2]]);
  // Against the row number, the pairs do not apply.
  assert.deepEqual(tableTraces(table, null, [3])[0].points[1], [1, -1]);
});

test('a column that repeats the x column is not suggested as a trace', () => {
  const table = readTable('t,a,t2,b\n0,1,0,4\n1,2,1,5\n2,3,2,6');
  assert.equal(table.pairs, undefined);
  assert.deepEqual(table.y, [1, 3]);
});

test('a file is read every row unless every Nth is asked for; past what a trace keeps, it must be', () => {
  const lines = ['t,a,b'];
  for (let i = 0; i < 10; i++) lines.push(`${i},${i * i},${-i}`);
  const table = readTable(lines.join('\n'));
  assert.equal(tableTraces(table, 0, [1])[0].points.length, 10);
  const [a, b] = tableTraces(table, 0, [1, 2], { every: 3 });
  assert.deepEqual(a.points, [[0, 0], [3, 9], [6, 36], [9, 81]]);
  assert.deepEqual(b.points.map(([x]) => x), [0, 3, 6, 9], 'the same rows in every trace');
  assert.equal(suggestedEvery(2000), 1);
  assert.equal(suggestedEvery(12001), 7);
  const plot = dataPlotFromText(lines.join('\n'), { every: 3 });
  assert.equal(plot.every, 3);
  assert.equal(plot.traces[0].points.length, 4);
  const big = ['t,v', ...Array.from({ length: MAX_DATA_POINTS * 2 + 1 }, (_, i) => `${i},${i % 5}`)].join('\n');
  assert.throws(() => dataPlotFromText(big), /read one row in 3 or fewer \(--every 3\)/);
  assert.equal(dataPlotFromText(big, { every: 3 }).traces[0].points.length, Math.ceil((MAX_DATA_POINTS * 2 + 1) / 3));
});
