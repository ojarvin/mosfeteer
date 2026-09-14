import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMNA } from '../src/core/analysis/mna.js';
import { createRationalOps } from '../src/core/analysis/algebra-ops.js';
import {
  add,
  integer,
  keyOf,
  multiply,
  rationalFunction,
  substituteRational,
  symbol,
} from '../src/core/analysis/rational.js';
import { solveMNA, solveLinearSystem } from '../src/core/analysis/solve.js';

const element = (kind, id, a, b, value, control) => ({
  kind, id, terminals: { a, b }, value,
  ...(control ? { control: { a: control[0], b: control[1] } } : {}),
});

function assertSameRational(actual, expected) {
  assert.equal(actual.kind, 'rational');
  assert.equal(keyOf(actual.numerator), keyOf(expected.numerator));
  assert.equal(keyOf(actual.denominator), keyOf(expected.denominator));
}

function assertEquivalent(ops, actual, expected) {
  assert.equal(ops.isZero(ops.sub(actual, expected)), true);
}

test('solves a symbolic resistor divider through the injected algebra ops', () => {
  const ops = createRationalOps();
  const r1 = ops.symbol('R_1');
  const r2 = ops.symbol('R_2');
  const system = buildMNA([
    element('resistor', 'R1', 'in', 'out', r1),
    element('resistor', 'R2', 'out', '0', r2),
    element('voltage-source', 'VIN', 'in', '0', ops.one),
  ], { ops, ground: '0' });
  const result = solveMNA(system, { ops });

  assert.equal(result.ok, true);
  assertSameRational(
    result.byVariable[0].get('V(out)'),
    rationalFunction(symbol('R_2'), add(symbol('R_1'), symbol('R_2'))),
  );
  assert.equal(Object.isFrozen(result.byVariable[0].get('V(out)')), true);
});

test('solves an RC transfer with s supplied by the adapter', () => {
  const ops = createRationalOps();
  const r = ops.symbol('R');
  const c = ops.symbol('C');
  const system = buildMNA([
    element('resistor', 'R1', 'in', 'out', r),
    element('capacitor', 'C1', 'out', '0', ops.mul(ops.s(), c)),
    element('voltage-source', 'VIN', 'in', '0', ops.one),
  ], { ops, ground: '0' });
  const result = solveMNA(system, { ops });

  assert.equal(result.ok, true);
  assertEquivalent(
    ops,
    result.byVariable[0].get('V(out)'),
    rationalFunction(integer(1), add(integer(1), multiply(symbol('s'), symbol('R'), symbol('C')))),
  );
});

test('maps a fraction-free solution after a row swap', () => {
  const ops = createRationalOps();
  const result = solveLinearSystem(
    [[ops.zero, ops.one], [ops.one, ops.one]],
    [[ops.one], [ops.add(ops.one, ops.one)]],
    { ops, variables: ['x', 'y'] },
  );

  assert.equal(result.ok, true);
  assertSameRational(result.byVariable[0].get('x'), ops.one);
  assertSameRational(result.byVariable[0].get('y'), ops.one);
});

test('keeps multiple symbolic RHS columns in one solve', () => {
  const ops = createRationalOps();
  const r1 = ops.symbol('R_1');
  const r2 = ops.symbol('R_2');
  const divider = rationalFunction(symbol('R_2'), add(symbol('R_1'), symbol('R_2')));
  const system = buildMNA([
    element('resistor', 'R1', 'in', 'out', r1),
    element('resistor', 'R2', 'out', '0', r2),
    element('voltage-source', 'VIN', 'in', '0', [ops.one, ops.add(ops.one, ops.one)]),
  ], { ops, ground: '0', rhsCount: 2 });
  const result = solveMNA(system, { ops });

  assert.equal(result.ok, true);
  assertSameRational(result.byVariable[0].get('V(out)'), divider);
  assertSameRational(result.byVariable[1].get('V(out)'), ops.mul(divider, ops.add(ops.one, ops.one)));
});

test('detects zero after exact substitution', () => {
  const ops = createRationalOps();
  const x = ops.symbol('x');
  const canceled = ops.sub(x, x);
  const substituted = substituteRational(canceled, { x: integer(7) });

  assert.equal(ops.isZero(canceled), true);
  assert.equal(ops.isZero(substituted), true);
});

test('keeps ideal open-circuit quotients as an explicit infinity value', () => {
  const ops = createRationalOps({ maxOperations: 100000 });
  const result = ops.div(ops.one, ops.zero);

  assert.equal(result.kind, 'infinity');
  assert.equal(result.sign, 1);
  assert.equal(ops.symbol('\\infty').kind, 'infinity');
  assert.equal(ops.isZero(ops.div(ops.zero, result)), true);
  assert.throws(() => ops.div(ops.zero, ops.zero), /undefined zero divided by zero/);
});

test('propagates a shared operation budget without invalidating results', () => {
  const ops = createRationalOps({ maxOperations: 1000 });
  const a = ops.symbol('a');
  const b = ops.symbol('b');
  const first = ops.add(a, b);
  const product = Array.from({ length: 24 }, (_, index) => (
    ops.add(ops.symbol(`s${index}`), ops.symbol(`p${index}`))
  )).reduce((left, right) => ops.mul(left, right));
  const second = ops.mul(first, product);

  assert.equal(first.budgetExceeded, false);
  assert.equal(second.budgetExceeded, true);
  assert.ok(ops.budget.used > 2);
  assert.equal(ops.isZero(second), false);
  assert.equal(Object.isFrozen(second), true);
});
