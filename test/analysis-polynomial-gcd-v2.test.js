import { test } from 'node:test';
import assert from 'node:assert/strict';
import { add, formatExpression, integer, multiply, power, rationalFunction, substituteRational, symbol } from '../src/core/analysis/rational.js';
import { analyzeResponse } from '../src/core/analysis/response.js';
import { cancelCommonPolynomialFactor } from '../src/core/analysis/polynomial-gcd.js';

const s = symbol('s');
const R = symbol('R');
const C = symbol('C');
const L = symbol('C_L');
const g = symbol('g_m');

function valueAt(value) {
  const point = new Map([['s', integer(3)], ['R', integer(5)], ['C', integer(7)], ['C_L', integer(11)], ['g_m', integer(13)]]);
  const result = substituteRational(value, point, { variable: 'z' });
  return `${formatExpression(result.numerator)}/${formatExpression(result.denominator)}`;
}

test('cancels a shared symbolic frequency-dependent factor hidden in expanded sums', () => {
  const shared = add(multiply(s, R, add(C, L)), integer(1));
  const numerator = multiply(g, shared);
  const denominator = multiply(shared, add(multiply(s, C), g));
  // Expand both sides so no structural factor is visible.
  const expanded = rationalFunction(
    add(multiply(g, s, R, C), multiply(g, s, R, L), g),
    add(multiply(s, s, R, C, C), multiply(s, s, R, C, L), multiply(s, C), multiply(g, s, R, C), multiply(g, s, R, L), g),
  );
  assert.equal(valueAt(expanded), valueAt(rationalFunction(numerator, denominator)));
  assert.equal(analyzeResponse(expanded).denominatorDegree, 2);

  const canceled = cancelCommonPolynomialFactor(expanded);
  assert.equal(valueAt(canceled), valueAt(expanded));
  const response = analyzeResponse(canceled);
  assert.equal(response.numeratorDegree, 0);
  assert.equal(response.denominatorDegree, 1);
  assert.equal(response.poles.length, 1);
});

test('returns the same value when numerator and denominator are coprime', () => {
  const value = rationalFunction(add(s, g), add(multiply(s, s, R, C), multiply(s, C), integer(1)));
  assert.equal(cancelCommonPolynomialFactor(value), value);
});

test('ignores factors that do not depend on the frequency variable', () => {
  const value = rationalFunction(multiply(add(R, L), s), multiply(add(R, L), add(s, g)));
  const canceled = cancelCommonPolynomialFactor(value);
  assert.equal(valueAt(canceled), valueAt(value));
});

test('factors free of the frequency are set aside, so a large product still cancels', () => {
  // Twelve symbols summed: a frequency-free factor that alone would push the
  // expanded product past the term limit.
  const names = Array.from({ length: 12 }, (_, i) => symbol(`x${i}`));
  const wide = add(...names);
  const shared = add(multiply(s, R, C), integer(1));
  const other = add(multiply(s, C), g);
  const big = multiply(...Array.from({ length: 4 }, () => wide));
  // As the solver leaves it: products, not expanded.
  const value = { kind: 'rational', variable: 's', numerator: multiply(big, shared, g), denominator: multiply(wide, shared, other) };
  assert.equal(value.denominator.kind, 'multiply');
  const canceled = cancelCommonPolynomialFactor(value);
  assert.notEqual(canceled, value);
  const response = analyzeResponse(canceled);
  assert.deepEqual([response.numeratorDegree, response.denominatorDegree], [0, 1]);
});

test('a high-degree common factor comes out the same by remainders down to its degree', () => {
  // (s^2 R C + s (R + g) + 1)(s C + 1) shared; numerator and denominator
  // cofactors of degree one and two.
  const quadratic = add(multiply(power(s, 2), R, C), multiply(s, add(R, g)), integer(1));
  const linear = add(multiply(s, C), integer(1));
  const shared = multiply(quadratic, linear);
  const value = rationalFunction(
    multiply(shared, add(multiply(s, L), R)),
    multiply(shared, add(multiply(power(s, 2), L, C), multiply(s, g), integer(1))),
  );
  const canceled = cancelCommonPolynomialFactor(value);
  const response = analyzeResponse(canceled);
  assert.deepEqual([response.numeratorDegree, response.denominatorDegree], [1, 2]);
  assert.equal(valueAt(canceled), valueAt(value));
});

test('a factor still cancels when the polynomials run past s^12', () => {
  // (s + 2)(s^13 + 1) / ((s + 2)(s + 5)), expanded: a numeric loop gain's
  // uncanceled factors take its degree this high.
  const value = rationalFunction(
    add(power(s, 14), multiply(integer(2), power(s, 13)), s, integer(2)),
    add(power(s, 2), multiply(integer(7), s), integer(10)),
  );
  const canceled = cancelCommonPolynomialFactor(value);
  assert.notEqual(canceled, value);
  assert.equal(valueAt(canceled), valueAt(value));
  const response = analyzeResponse(canceled);
  assert.equal(response.numeratorDegree, 13);
  assert.equal(response.denominatorDegree, 1);
});
