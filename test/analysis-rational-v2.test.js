import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  add,
  formatExpression,
  infinity,
  integer,
  keyOf,
  multiply,
  polynomialCoefficients,
  power,
  rational,
  rationalAdd,
  rationalFunction,
  rationalAt,
  rationalDivide,
  rationalMultiply,
  simplify,
  substitute,
  symbol,
} from '../src/core/analysis/rational.js';

const s = symbol('s');
const gm = symbol('g_m');

test('exact numbers and immutable expressions normalize deterministically', () => {
  assert.equal(formatExpression(add(rational(1, 2), rational(1, 3))), '5/6');
  const expression = multiply(gm, gm);
  assert.equal(expression.kind, 'power');
  assert.equal(expression.exponent, 2);
  assert.equal(formatExpression(expression), 'g_m^2');
  assert.equal(Object.isFrozen(expression), true);
  assert.equal(Object.isFrozen(expression.base), true);
});

test('negative common factors are placed in front of a grouped sum', () => {
  const expression = add(multiply(integer(-1), symbol('g_m1')), multiply(integer(-1), symbol('g_m2')));
  assert.equal(formatExpression(expression), '-(g_m1 + g_m2)');
  assert.equal(keyOf(expression), keyOf(multiply(integer(-1), add(symbol('g_m1'), symbol('g_m2')))));
});

test('polynomial coefficients are collected in descending s order', () => {
  const expression = add(
    multiply(symbol('a'), power(s, 2)),
    multiply(symbol('b'), s),
    symbol('c'),
  );
  assert.deepEqual(polynomialCoefficients(expression).map(({ power: exponent }) => exponent), [2, 1, 0]);
  assert.equal(formatExpression(expression), 'a*s^2 + b*s + c');
  assert.equal(formatExpression(add(integer(1), s)), 's + 1');
});

test('rational functions cancel identical factors and evaluate exactly', () => {
  const factor = add(s, integer(1));
  const transfer = rationalFunction(multiply(s, factor), multiply(symbol('k'), factor));
  assert.equal(formatExpression(transfer.numerator), 's');
  assert.equal(formatExpression(transfer.denominator), 'k');
  assert.equal(formatExpression(rationalAt(transfer, integer(0))), '0');
});

test('cancels common polynomial content from expanded coefficients', () => {
  const R = symbol('R');
  const C = symbol('C');
  const transfer = rationalFunction(
    multiply(integer(-1), R),
    add(multiply(integer(-1), C, symbol('s'), power(R, 2)), multiply(integer(-1), R)),
  );
  const expected = rationalFunction(integer(1), add(integer(1), multiply(symbol('s'), R, C)));
  assert.equal(keyOf(transfer.numerator), keyOf(expected.numerator));
  assert.equal(keyOf(transfer.denominator), keyOf(expected.denominator));
});

test('represents safe division by zero as explicit infinity', () => {
  const positive = rationalDivide(integer(1), integer(0));
  const negative = rationalDivide(integer(-1), integer(0));
  assert.equal(positive.kind, 'infinity');
  assert.equal(positive.sign, 1);
  assert.equal(negative.sign, -1);
  assert.equal(rationalDivide(integer(2), positive).kind, 'number');
  assert.equal(rationalMultiply(positive, symbol('R')).kind, 'infinity');
  assert.equal(keyOf(infinity()), keyOf(positive));
  assert.throws(() => rationalDivide(integer(0), integer(0)), /undefined zero divided by zero/);
  assert.throws(() => rationalDivide(positive, positive), /undefined infinity division/);
});

test('signed powers combine and common factors stay factored', () => {
  const x = symbol('x');
  assert.equal(formatExpression(multiply(power(x, -1), power(x, 2))), 'x');
  const numerator = add(multiply(integer(-1), symbol('g_m1'), symbol('R_D')), multiply(integer(-1), symbol('g_m1'), symbol('r_o1')));
  assert.equal(formatExpression(numerator), '-g_m1*(R_D + r_o1)');
});

test('substitution removes go and gmb terms exactly', () => {
  const expression = add(
    multiply(symbol('g_o'), symbol('r_o')),
    multiply(symbol('g_mb'), symbol('v_bs')),
    symbol('g_m'),
  );
  const reduced = substitute(expression, { g_o: integer(0), g_mb: integer(0) });
  assert.equal(formatExpression(reduced), 'g_m');
});

test('operation budget keeps a valid factored rational fallback', () => {
  const factors = Array.from({ length: 12 }, (_, index) => add(s, symbol(`p${index}`)));
  const numerator = multiply(factors);
  const denominator = multiply(factors.slice(0, 6).concat([symbol('q')]));
  const result = rationalFunction(numerator, denominator, { maxOperations: 2 });
  assert.equal(result.kind, 'rational');
  assert.equal(result.budgetExceeded, true);
  assert.notEqual(result.denominator, undefined);
  assert.equal(rationalAt(result, integer(0)).kind, 'rational');
});

test('bounded rational addition remains valid when expansion is refused', () => {
  const left = rationalFunction(add(s, symbol('a')), add(s, symbol('b')));
  const right = rationalFunction(add(s, symbol('c')), add(s, symbol('d')));
  const result = rationalAdd(left, right, { maxOperations: 1 });
  assert.equal(result.kind, 'rational');
  assert.notEqual(result.numerator, undefined);
  assert.notEqual(result.denominator, undefined);
});

test('simplify returns the original valid expression when its budget is exhausted', () => {
  const expression = multiply(...Array.from({ length: 5 }, (_, index) => add(s, symbol(`x${index}`))));
  assert.equal(keyOf(simplify(expression, { maxOperations: 1 })), keyOf(expression));
});
