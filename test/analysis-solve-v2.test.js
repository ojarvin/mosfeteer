import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRationalOps } from '../src/core/analysis/algebra-ops.js';
import { buildMNA, numberOps } from '../src/core/analysis/mna.js';
import { solveLinearSystem, solveMNA } from '../src/core/analysis/solve.js';

const ops = numberOps();
const element = (kind, id, a, b, value, control) => ({
  kind, id, terminals: { a, b }, value,
  ...(control ? { control: { a: control[0], b: control[1] } } : {}),
});

function rational(numerator, denominator = 1) {
  const sign = denominator < 0 ? -1 : 1;
  const gcd = (a, b) => b ? gcd(b, a % b) : Math.abs(a);
  const divisor = gcd(numerator, denominator) || 1;
  return { n: sign * numerator / divisor, d: sign * denominator / divisor };
}

const rationalOps = {
  zero: rational(0),
  one: rational(1),
  add: (a, b) => rational(a.n * b.d + b.n * a.d, a.d * b.d),
  sub: (a, b) => rational(a.n * b.d - b.n * a.d, a.d * b.d),
  mul: (a, b) => rational(a.n * b.n, a.d * b.d),
  div: (a, b) => rational(a.n * b.d, a.d * b.n),
  neg: (a) => rational(-a.n, a.d),
  isZero: (a) => a.n === 0,
};

test('solves a voltage-source resistor circuit and maps branch current', () => {
  const system = buildMNA([
    element('resistor', 'R1', 'n', '0', 10),
    element('voltage-source', 'V1', 'n', '0', 5),
  ], { ops, ground: '0' });
  const result = solveMNA(system);

  assert.equal(result.ok, true);
  assert.deepEqual(result.columns[0], [5, -0.5]);
  assert.equal(result.byVariable[0].get('V(n)'), 5);
  assert.equal(result.byVariable[0].get('I(V1)'), -0.5);
});

test('solves an inductor branch unknown independently of source current', () => {
  const system = buildMNA([
    element('inductor', 'L1', 'n', '0', 4),
    element('voltage-source', 'V1', 'n', '0', 8),
  ], { ops, ground: '0' });
  const result = solveMNA(system);

  assert.equal(result.ok, true);
  assert.deepEqual(result.variables, ['V(n)', 'I(L1)', 'I(V1)']);
  assert.deepEqual(result.columns[0], [8, 2, -2]);
});

test('solves VCCS polarity and two RHS columns together', () => {
  const system = buildMNA([
    element('resistor', 'RL', 'out', '0', 5),
    element('voltage-source', 'VIN', 'in', '0', [1, 2]),
    element('vccs', 'G1', 'out', '0', 2, ['in', '0']),
  ], { ops, ground: '0', rhsCount: 2 });
  const result = solveMNA(system);

  assert.equal(result.ok, true);
  assert.deepEqual(result.columns[0], [-10, 1, 0]);
  assert.deepEqual(result.columns[1], [-20, 2, 0]);
});

test('performs a required row swap and preserves variable order', () => {
  const result = solveLinearSystem([[0, 1], [1, 1]], [[1], [2]], {
    ops, variables: ['x', 'y'], fractionFree: true,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.columns[0], [1, 1]);
  assert.deepEqual([...result.byVariable[0]], [['x', 1], ['y', 1]]);
});

test('works with an injected exact rational ring', () => {
  const result = solveLinearSystem(
    [[rational(0), rational(2)], [rational(3), rational(3)]],
    [[rational(4)], [rational(9)]],
    { ops: rationalOps, variables: ['x', 'y'] },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.columns[0], [rational(1), rational(2)]);
});

test('reports a floating singular system', () => {
  const system = buildMNA([
    element('resistor', 'R1', 'a', 'b', 10),
  ], { ops, ground: '0' });
  const result = solveMNA(system);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'singular');
  assert.match(result.error, /singular system/);
  assert.equal(result.pivotColumn, 1);
});

test('reports an inconsistent matrix without dividing by a zero pivot', () => {
  const result = solveLinearSystem([[1, 0], [0, 0]], [[1], [3]], { ops, variables: ['x', 'y'] });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'inconsistent');
  assert.match(result.error, /RHS is nonzero/);
});

test('rejects matrices above the configured size limit', () => {
  const result = solveLinearSystem([[1, 0], [0, 1]], [[1], [2]], { ops, maxMatrixSize: 1 });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'matrix-size-limit');
  assert.equal(result.size, 2);
});

test('stops elimination when the solver work limit is exhausted', () => {
  const result = solveLinearSystem([[1, 0], [0, 1]], [[1], [2]], { ops, maxWork: 1 });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'solver-work-limit');
  assert.ok(result.work > 1);
});

test('returns one structured diagnostic when the shared algebra budget is exhausted', () => {
  const exactOps = createRationalOps({ maxOperations: 0 });
  const result = solveLinearSystem([[exactOps.one]], [[exactOps.one]], { ops: exactOps });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'operation-budget');
  assert.equal(result.budget.limit, 0);
});
