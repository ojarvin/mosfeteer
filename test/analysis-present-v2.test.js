import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  equation,
  infinity,
  provenParallel,
  quantityLabel,
  renderExpression,
  renderQuantityEquation,
  renderRootEquation,
} from '../src/core/analysis/present.js';
import {
  add,
  integer,
  multiply,
  power,
  rationalFunction,
  symbol,
} from '../src/core/analysis/rational.js';

const s = symbol('s');
const gm1 = symbol('gm1');
const gm2 = symbol('gm2');
const rd = symbol('RD');

test('renders precedence with only required grouping', () => {
  assert.equal(renderExpression(multiply(s, add(gm1, gm2))), 's \\, \\left(g_{m1} + g_{m2}\\right)');
  assert.equal(renderExpression(power(add(gm1, gm2), 2)), '\\left(g_{m1} + g_{m2}\\right)^{2}');
  assert.equal(renderExpression(add(multiply(gm1, gm2), rd)), 'g_{m1} \\, g_{m2} + R_{D}');
});

test('keeps unary minus outside a grouped sum and combines powers', () => {
  assert.equal(renderExpression(add(multiply(integer(-1), gm1), multiply(integer(-1), gm2))), '-\\left(g_{m1} + g_{m2}\\right)');
  assert.equal(renderExpression(multiply(gm1, gm1)), 'g_{m1}^{2}');
});

test('orders s powers before factors and sums by descending degree', () => {
  const expression = add(
    multiply(symbol('b'), s),
    multiply(symbol('a'), power(s, 2)),
    symbol('c'),
  );
  assert.equal(renderExpression(expression), 's^{2} \\, a + s \\, b + c');
});

test('renders concise fractions, exact zero, and infinity', () => {
  const transfer = rationalFunction(add(s, integer(1)), add(symbol('k'), integer(1)));
  assert.equal(renderExpression(transfer), '\\frac{s + 1}{1 + k}');
  assert.equal(renderExpression(integer(0)), '0');
  assert.equal(renderExpression(infinity()), '\\infty');
});

test('uses parallel notation only with explicit proven equivalence metadata', () => {
  const r1 = symbol('R1');
  const r2 = symbol('R2');
  const equivalent = rationalFunction(multiply(r1, r2), add(r1, r2));
  assert.notEqual(renderExpression(equivalent), 'R_{1} \\parallel R_{2}');
  assert.equal(renderExpression(equivalent, { equivalence: provenParallel(equivalent, r1, r2) }), 'R_{1} \\parallel R_{2}');
});

test('renders standard quantity and zero-based root labels', () => {
  assert.equal(quantityLabel('Zin', 's'), 'Z_{in}(s)');
  assert.equal(quantityLabel('Zout', 0), 'Z_{out}(0)');
  assert.equal(renderQuantityEquation('Av', 's', gm1), 'A_v(s) = g_{m1}');
  assert.equal(equation('Z_{in}(0)', infinity()), 'Z_{in}(0) = \\infty');
  assert.equal(renderRootEquation('pole', 0, multiply(integer(-1), symbol('p1'))), 'p_{0} = -p_{1}');
  assert.equal(renderRootEquation('zero', 0, integer(0)), 'z_{0} = 0');
});
