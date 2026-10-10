import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate, formatResult, replayNames, siResult } from '../src/core/calculator.js';

const value = (line, names) => calculate(line, names).value;
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) <= 1e-12 * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);

test('the calculator reads lines as a search bar does', () => {
  close(value('20*log(123)'), 20 * Math.log10(123));
  close(value('123e-12'), 123e-12);
  close(value('ln(e)'), 1);
  close(value('2^3^2'), 512);
  close(value('-2^2'), -4);
  close(value('2**10'), 1024);
  close(value('(1+2)(3+4)'), 21);
  close(value('2pi'), 2 * Math.PI);
  close(value('3(4+5)'), 27);
  close(value('sqrt(2)/2'), Math.SQRT1_2);
  close(value('5!'), 120);
  close(value('5%'), 0.05);
  close(value('10 % 3'), 1);
  close(value('ln 2'), Math.LN2);
  close(value('max(1, 7, 3)'), 7);
  close(value('6 × 7 ÷ 2 − 1'), 20);
  close(value('db(10)'), 20);
  close(value('undb(-6)'), 10 ** (-6 / 20));
});

test('numbers take SI suffixes, and names win over them', () => {
  close(value('4.7k'), 4700);
  close(value('10u'), 10e-6);
  close(value('10µ'), 10e-6);
  close(value('1.5meg'), 1.5e6);
  close(value('2p*1G'), 2e-3);
  close(value('1/(2pi*1k*159n)'), 1 / (2 * Math.PI * 1e3 * 159e-9));
  close(value('2e'), 2 * Math.E);
});

test('names hold values; ans is the last result', () => {
  const names = replayNames(['R = 10k', 'C = 1n', '1/(2pi*R*C)', 'oops(', 'ans*2']);
  close(names.R, 1e4);
  close(names.ans, 2 / (2 * Math.PI * 1e4 * 1e-9));
  assert.deepEqual(calculate('x = 3*2', {}), { name: 'x', value: 6 });
  assert.throws(() => calculate('pi = 3'), /built-in/);
});

test('mistakes say what is wrong', () => {
  assert.throws(() => calculate(''), /nothing/);
  assert.throws(() => calculate('2+'), /ends too soon/);
  assert.throws(() => calculate('(2+3'), /expected "\)"/);
  assert.throws(() => calculate('foo + 1'), /"foo" has no value/);
  assert.throws(() => calculate('foo(2)'), /"foo" is not a function/);
  assert.throws(() => calculate('2 $ 3'), /"\$"/);
  assert.throws(() => calculate('ans'), /no earlier result/);
  assert.throws(() => calculate('2.5!'), /whole number/);
});

test('results read plainly', () => {
  assert.equal(formatResult(41.79476), '41.79476');
  assert.equal(formatResult(0.1 + 0.2), '0.3');
  assert.equal(formatResult(123e-12), '1.23e-10');
  assert.equal(formatResult(6.02214076e23), '6.02214076e23');
  assert.equal(formatResult(1 / 0), '∞');
  assert.equal(siResult(4700), '4.7k');
  assert.equal(siResult(1.5e-12), '1.5p');
  assert.equal(siResult(12), null);
});
