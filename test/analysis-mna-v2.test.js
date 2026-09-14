import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMNA, numberOps } from '../src/core/analysis/mna.js';

const ops = numberOps();
const element = (kind, id, a, b, value, control) => ({
  kind, id, terminals: { a, b }, value,
  ...(control ? { control: { a: control[0], b: control[1] } } : {}),
});

function matrixWithTolerance(actual, expected) {
  assert.equal(actual.length, expected.length);
  for (let row = 0; row < expected.length; row++) {
    assert.equal(actual[row].length, expected[row].length);
    for (let column = 0; column < expected[row].length; column++) {
      assert.ok(Math.abs(actual[row][column] - expected[row][column]) < 1e-12,
        `A[${row}][${column}] = ${actual[row][column]}, expected ${expected[row][column]}`);
    }
  }
}

test('stamps passive RLC elements with stable node and branch unknowns', () => {
  const system = buildMNA([
    element('resistor', 'R1', 'in', 'out', 10),
    element('capacitor', 'C1', 'out', '0', 2),
    element('inductor', 'L1', 'in', '0', 3),
  ], { ops, nodes: ['in', 'out'], ground: '0' });

  assert.deepEqual(system.nodes, ['in', 'out']);
  assert.deepEqual(system.unknowns, ['V(in)', 'V(out)', 'I(L1)']);
  matrixWithTolerance(system.A, [
    [0.1, -0.1, 1],
    [-0.1, 2.1, 0],
    [1, 0, -3],
  ]);
});

test('allocates an ideal voltage-source branch current and stamps its RHS', () => {
  const system = buildMNA([
    element('resistor', 'R1', 'n', '0', 10),
    element('voltage-source', 'V1', 'n', '0', 5),
  ], { ops, ground: '0' });

  assert.deepEqual(system.unknowns, ['V(n)', 'I(V1)']);
  matrixWithTolerance(system.A, [[0.1, 1], [1, 0]]);
  assert.deepEqual(system.B, [[0], [5]]);
});

test('stamps VCCS current with the declared output and control polarity', () => {
  const system = buildMNA([
    element('voltage-source', 'VIN', 'in', '0', 1),
    element('resistor', 'RL', 'out', '0', 5),
    element('vccs', 'G1', 'out', '0', 2, ['in', '0']),
  ], { ops, ground: '0' });

  matrixWithTolerance(system.A, [
    [0, 0, 1],
    [2, 0.2, 0],
    [1, 0, 0],
  ]);
  // The VCCS changes the output row's input coefficient from zero to +gm.
  assert.equal(system.A[1][0], 2);
  assert.equal(system.A[1][1], 0.2);
});

test('accepts multiple source excitations in one RHS matrix', () => {
  const system = buildMNA([
    element('resistor', 'R1', 'in', '0', 1),
    element('voltage-source', 'VIN', 'in', '0', [1, 2]),
  ], { ops, ground: '0', rhsCount: 2 });

  assert.deepEqual(system.B, [[0, 0], [1, 2]]);
  assert.equal(system.B[0].length, 2);
});

test('stamps an independent current source from a to b', () => {
  const system = buildMNA([
    element('current-source', 'I1', 'a', 'b', 3),
  ], { ops, nodes: ['a', 'b'], ground: '0' });

  assert.deepEqual(system.B, [[-3], [3]]);
});

test('rejects inconsistent RHS widths instead of silently truncating', () => {
  assert.throws(() => buildMNA([
    element('voltage-source', 'V1', 'n', '0', [1, 2]),
  ], { ops, rhsCount: 1 }), /RHS source width/);
});

test('rejects duplicate branch identities before stamping', () => {
  assert.throws(() => buildMNA([
    element('voltage-source', 'V1', 'a', '0', 0),
    element('inductor', 'V1', 'b', '0', 1),
  ], { ops }), /branch names must be unique/);
});

test('rejects a zero resistor before taking its reciprocal', () => {
  assert.throws(() => buildMNA([
    element('resistor', 'R1', 'a', '0', 0),
  ], { ops }), /resistance must be nonzero/);
});
