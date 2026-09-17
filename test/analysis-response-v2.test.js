import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  add,
  formatExpression,
  integer,
  multiply,
  power,
  rationalFunction,
  symbol,
} from '../src/core/analysis/rational.js';
import { analyzeResponse, processResponses } from '../src/core/analysis/response.js';
import { renderRootEquation } from '../src/core/analysis/present.js';

const s = symbol('s');
const R = symbol('R');
const C = symbol('C');
const L = symbol('L');

test('canonicalizes an RC low-pass and derives finite DC and one pole', () => {
  const response = analyzeResponse(rationalFunction(integer(1), add(integer(1), multiply(R, C, s))));

  assert.equal(response.hasFrequency, true);
  assert.equal(response.numeratorDegree, 0);
  assert.equal(response.denominatorDegree, 1);
  assert.equal(response.dc.kind, 'finite');
  assert.equal(formatExpression(response.dc.value), '1');
  assert.equal(response.poles.length, 1);
  assert.equal(response.poles[0].index, 0);
  assert.equal(formatExpression(response.poles[0].root), '-(C*R)^-1');
});

test('derives an RL high-pass zero at the origin and finite high-frequency limit', () => {
  const response = analyzeResponse(rationalFunction(multiply(L, s), add(R, multiply(L, s))));

  assert.equal(response.dc.kind, 'zero');
  assert.equal(formatExpression(response.dc.value), '0');
  assert.equal(response.zeros.length, 1);
  assert.equal(response.zeros[0].index, 0);
  assert.equal(formatExpression(response.zeros[0].root), '0');
  assert.equal(response.infinity.kind, 'finite');
  assert.equal(formatExpression(response.infinity.value), '1');
});

test('reports canceled numerator and denominator degrees', () => {
  const factor = add(s, integer(1));
  const response = analyzeResponse(rationalFunction(
    multiply(factor, add(s, integer(2))),
    multiply(factor, add(s, integer(3))),
  ));

  assert.equal(formatExpression(response.numerator), 's + 2');
  assert.equal(formatExpression(response.denominator), 's + 3');
  assert.deepEqual(response.degrees, { numerator: 1, denominator: 1 });
});

test('derives finite nonzero and infinite DC limits by valuation', () => {
  const finite = analyzeResponse(rationalFunction(add(multiply(integer(2), s), integer(4)), add(multiply(integer(3), s), integer(6))));
  assert.equal(finite.dc.kind, 'finite');
  assert.equal(formatExpression(finite.dc.value), '2/3');

  const pole = analyzeResponse(rationalFunction(integer(1), multiply(s, add(s, integer(1)))));
  assert.equal(pole.dc.kind, 'pole');
  assert.equal(pole.dc.order, 1);
  assert.equal(formatExpression(pole.dc.coefficient), '1');
});

test('reports a pole at infinity from the high-frequency degree excess', () => {
  const response = analyzeResponse(rationalFunction(multiply(s, s), add(s, integer(1))));

  assert.equal(response.infinity.kind, 'pole');
  assert.equal(response.infinity.order, 1);
  assert.equal(formatExpression(response.infinity.coefficient), '1');
});

test('solves a second-order denominator with a perfect-square discriminant exactly', () => {
  const response = analyzeResponse(rationalFunction(
    integer(1),
    add(multiply(s, s), multiply(integer(3), s), integer(2)),
  ));

  assert.deepEqual(response.poles.map(({ index, kind }) => ({ index, kind })), [
    { index: 0, kind: 'root' },
    { index: 1, kind: 'root' },
  ]);
  assert.deepEqual(response.poles.map(({ root }) => formatExpression(root)), ['-2', '-1']);
});

test('uses quadratic formula records for second-order poles', () => {
  const response = analyzeResponse(rationalFunction(
    integer(1),
    add(multiply(R, C, s, s), multiply(integer(3), R, C, s), integer(1)),
  ));

  assert.equal(response.poles.length, 2);
  assert.deepEqual(response.poles.map(({ index, kind }) => ({ index, kind })), [
    { index: 0, kind: 'quadratic-root' },
    { index: 1, kind: 'quadratic-root' },
  ]);
  assert.equal(response.poles[0].root.sign, -1);
  assert.equal(response.poles[1].root.sign, 1);
  assert.equal(renderRootEquation('pole', 0, response.poles[0].root), 'p_{0} = \\frac{-3 \\, C \\, R - \\sqrt{C \\, R \\, \\left(9 \\, C \\, R - 4\\right)}}{2 \\, C \\, R}');
});

test('reports roots at the origin exactly and cancels common factors', () => {
  const gm = symbol('g_m');
  const CL = symbol('C_L');
  const response = analyzeResponse(rationalFunction(
    add(multiply(gm, s), multiply(gm, R)),
    add(multiply(CL, C, s, s), multiply(gm, C, s)),
  ));
  assert.deepEqual(response.poles.map(({ index, kind }) => ({ index, kind })), [
    { index: 0, kind: 'root' },
    { index: 1, kind: 'root' },
  ]);
  assert.deepEqual(response.poles.map(({ root }) => formatExpression(root)), ['0', '-g_m*C_L^-1'], 'C cancels from the second pole');
  assert.deepEqual(response.zeros.map(({ root }) => formatExpression(root)), ['-R'], 'g_m cancels from the zero');
});

test('falls back to one symbolic polynomial record above second order', () => {
  const response = analyzeResponse(rationalFunction(
    integer(1),
    add(multiply(s, s, s), multiply(integer(2), s, s), multiply(integer(3), s), integer(4)),
  ));

  assert.equal(response.poles.length, 1);
  assert.equal(response.poles[0].index, 0);
  assert.equal(response.poles[0].kind, 'polynomial');
  assert.equal(response.poles[0].order, 3);
});

test('hides AC metadata after s cancels from the final response', () => {
  const response = analyzeResponse(rationalFunction(multiply(s, add(s, integer(1))), multiply(s, add(s, integer(1)))));

  assert.equal(response.hasFrequency, false);
  assert.deepEqual(response.poles, []);
  assert.deepEqual(response.zeros, []);
  assert.equal(response.dc.kind, 'finite');
  assert.equal(formatExpression(response.expression.numerator), '1');
  assert.equal(formatExpression(response.expression.denominator), '1');
});

test('processes the response trio with the same canonical contract', () => {
  const result = processResponses({
    Av: rationalFunction(integer(1), add(integer(1), s)),
    Zin: integer(10),
    Zout: rationalFunction(s, add(integer(1), s)),
  });

  assert.deepEqual(Object.keys(result), ['Av', 'Zin', 'Zout']);
  assert.equal(result.Zin.hasFrequency, false);
  assert.equal(result.Zout.dc.kind, 'zero');
});
