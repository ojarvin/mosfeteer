import test from 'node:test';
import assert from 'node:assert/strict';
import { cellNumber, guessFormat, readTable, splitLine, suggestScale, tableTraces } from '../src/core/csv-data.js';

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
