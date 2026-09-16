import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  equation,
  equivalenceTable,
  infinity,
  provenParallel,
  provenQuotient,
  provenSum,
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

test('flattens small resistive branches and places each transistor gm ro pair together', () => {
  const ro1 = symbol('ro1');
  const ro2 = symbol('ro2');
  const branch = multiply(ro2, add(multiply(gm2, ro1), integer(1)));
  assert.equal(renderExpression(branch), 'g_{m2} \\, r_{o2} \\, r_{o1} + r_{o2}');
  assert.equal(renderExpression(add(branch, rd)), 'g_{m2} \\, r_{o2} \\, r_{o1} + R_{D} + r_{o2}');
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

test('finds a nested proof in an equivalences table by structural key, not just a top-level match', () => {
  const r1 = symbol('R1');
  const r2 = symbol('R2');
  const r3 = symbol('R3');
  // R1 \| R2 written as one plain node (a valid factor within a larger sum,
  // unlike a full `rational`-kind fraction, which never nests inside a plain
  // expression tree in this codebase — every exact solve result is built
  // from plain add/multiply/power nodes with a `rational` wrapper only at
  // the very top).
  const parallelAsFactor = multiply(r1, r2, power(add(r1, r2), -1));
  const whole = add(r3, parallelAsFactor);
  assert.notEqual(renderExpression(parallelAsFactor), 'R_{1} \\parallel R_{2}');
  const equivalences = equivalenceTable([provenParallel(parallelAsFactor, r1, r2)]);
  assert.equal(renderExpression(whole, { equivalences }), '\\left(R_{1} \\parallel R_{2}\\right) + R_{3}');
});

test('renders standard quantity and zero-based root labels', () => {
  assert.equal(quantityLabel('Zin', 's'), 'Z_{in}(s)');
  assert.equal(quantityLabel('Zout', 0), 'Z_{out}(0)');
  assert.equal(renderQuantityEquation('Av', 's', gm1), 'A_v(s) = g_{m1}');
  assert.equal(equation('Z_{in}(0)', infinity()), 'Z_{in}(0) = \\infty');
  assert.equal(renderRootEquation('pole', 0, multiply(integer(-1), symbol('p1'))), 'p_{0} = -p_{1}');
  assert.equal(renderRootEquation('zero', 0, integer(0)), 'z_{0} = 0');
});

test('combines nested Miller quotient and reciprocal-sum identities into one fraction', () => {
  const c = symbol('CGD');
  const gain = multiply(gm1, rd);
  const feedback = rationalFunction(integer(1), multiply(s, c));
  const correction = rationalFunction(add(gain, integer(1)), gain);
  const impedance = rationalFunction(gain, multiply(s, c, add(gain, integer(1))));
  const equivalences = equivalenceTable([
    provenSum(correction, integer(1), rationalFunction(integer(1), gain)),
    provenQuotient(impedance, feedback, correction),
  ]);
  assert.equal(renderExpression(impedance, { equivalences }), '\\frac{g_{m1} \\, R_{D}}{s \\, C_{GD} \\, \\left(g_{m1} \\, R_{D} + 1\\right)}');
});

test('collects a pole reciprocal and all multiplying factors into its numerator', () => {
  const denominator = add(symbol('a'), symbol('b'));
  const pole = multiply(integer(-2), power(denominator, -1), gm1, add(rd, symbol('ro1')));
  assert.equal(renderRootEquation('pole', 0, pole), 'p_{0} = -\\frac{2 \\, g_{m1} \\, \\left(R_{D} + r_{o1}\\right)}{a + b}');
  assert.equal(renderExpression(multiply(integer(-2), gm1)), '-2 \\, g_{m1}');
  assert.equal(renderExpression(multiply(integer(-2), s, gm1)), '-s \\, 2 \\, g_{m1}');
});
