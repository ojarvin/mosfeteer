import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRationalOps } from '../src/core/analysis/algebra-ops.js';
import { reduceNetwork, reduceTwoTerminalNetwork } from '../src/core/analysis/reduce.js';
import { formatExpression } from '../src/core/analysis/rational.js';

const ops = createRationalOps({ maxOperations: 10000 });

function expression(result) {
  assert.equal(result.ok, true, 'expected a reducible network');
  return `${formatExpression(result.impedance.numerator)} / ${formatExpression(result.impedance.denominator)}`;
}

function p(kind, a, b, value) {
  return { kind, terminals: { a, b }, value: ops.symbol(value) };
}

test('reduces a series pair to the sum of their impedances', () => {
  const result = reduceTwoTerminalNetwork([
    p('resistor', 'A', 'M', 'R1'),
    p('resistor', 'M', 'B', 'R2'),
  ], 'A', 'B', ops);
  assert.equal(expression(result), 'R1 + R2 / 1');
});

test('reduces a parallel pair to the product-over-sum form', () => {
  const result = reduceTwoTerminalNetwork([
    p('resistor', 'A', 'B', 'R1'),
    p('resistor', 'A', 'B', 'R2'),
  ], 'A', 'B', ops);
  assert.equal(expression(result), 'R1*R2 / R1 + R2');
});

test('reduces a series resistor and capacitor using the capacitor impedance 1/(sC)', () => {
  const result = reduceTwoTerminalNetwork([
    p('resistor', 'A', 'M', 'R1'),
    p('capacitor', 'M', 'B', 'C1'),
  ], 'A', 'B', ops);
  assert.equal(expression(result), 'C1*R1*s + 1 / C1*s');
});

test('reduces a series inductor and resistor using the inductor impedance sL', () => {
  const result = reduceTwoTerminalNetwork([
    p('inductor', 'A', 'M', 'L1'),
    p('resistor', 'M', 'B', 'R1'),
  ], 'A', 'B', ops);
  assert.equal(expression(result), 'L1*s + R1 / 1');
});

test('reduces a series-then-parallel combination to a fixed point', () => {
  // (R1 series C1) in parallel with R2, between A and B via a private node M.
  const result = reduceTwoTerminalNetwork([
    p('resistor', 'A', 'M', 'R1'),
    p('capacitor', 'M', 'B', 'C1'),
    p('resistor', 'A', 'B', 'R2'),
  ], 'A', 'B', ops);
  assert.equal(expression(result), 'R2*(C1*R1*s + 1) / C1*s*(R1 + R2) + 1');
});

test('reports not reducible for a dangling branch that never reaches the far terminal', () => {
  const result = reduceTwoTerminalNetwork([
    p('resistor', 'A', 'B', 'R1'),
    p('resistor', 'A', 'D', 'R2'),
  ], 'A', 'B', ops);
  assert.equal(result.ok, false);
});

test('reports not reducible for a bridge/lattice network that needs a star-mesh transform', () => {
  const result = reduceTwoTerminalNetwork([
    p('resistor', 'A', 'M', 'R1'),
    p('resistor', 'M', 'B', 'R2'),
    p('resistor', 'A', 'N', 'R3'),
    p('resistor', 'N', 'B', 'R4'),
    p('resistor', 'M', 'N', 'R5'),
  ], 'A', 'B', ops);
  assert.equal(result.ok, false);
});

test('reports not reducible for an unsupported (e.g. vccs) primitive kind', () => {
  const result = reduceTwoTerminalNetwork([
    { kind: 'vccs', terminals: { a: 'A', b: 'B' }, control: { a: 'A', b: 'B' }, value: ops.symbol('gm1') },
  ], 'A', 'B', ops);
  assert.equal(result.ok, false);
});

test('rejects a degenerate request with the same node on both sides', () => {
  const result = reduceTwoTerminalNetwork([p('resistor', 'A', 'B', 'R1')], 'A', 'A', ops);
  assert.equal(result.ok, false);
});

test('reduceNetwork merges parallel edges but never series-merges (deliberately, for Bareiss efficiency)', () => {
  const result = reduceNetwork([
    p('resistor', 'A', 'B', 'R1'),
    p('resistor', 'A', 'B', 'R2'),
    p('resistor', 'B', 'C', 'R3'),
    p('resistor', 'C', 'D', 'R4'),
  ], ['A', 'D'], ops);
  // R1 || R2 merges into one edge; the private series chain B-C-D (R3, R4)
  // is left alone even though B/C/D aren't in the boundary set.
  assert.equal(result.primitives.length, 3);
  assert.equal(result.proofs.length, 1);
  assert.equal(formatExpression(result.proofs[0].impedance.numerator), 'R1*R2');
  assert.equal(formatExpression(result.proofs[0].impedance.denominator), 'R1 + R2');
});

test('reduceNetwork passes an untouched primitive through unchanged (kind, id, metadata intact)', () => {
  const original = { kind: 'resistor', id: 'M1.rds', terminals: { a: 'A', b: 'B' }, value: ops.symbol('rds1'), metadata: { model: 'triode' } };
  const result = reduceNetwork([original], ['A', 'B'], ops);
  assert.equal(result.primitives.length, 1);
  assert.equal(result.primitives[0], original);
  assert.equal(result.proofs.length, 0);
});

test('reduceNetwork never eliminates a node touched by a vccs control or terminal', () => {
  const result = reduceNetwork([
    p('resistor', 'A', 'M', 'R1'),
    p('resistor', 'M', 'B', 'R2'),
    { kind: 'vccs', terminals: { a: 'X', b: 'Y' }, control: { a: 'M', b: 'Y' }, value: ops.symbol('gm1') },
  ], ['A', 'B'], ops);
  // M is degree-2 among the passives, but a vccs control also reads it, so
  // it must survive as its own node — R1 and R2 stay separate.
  const kinds = result.primitives.map((primitive) => primitive.kind).sort();
  assert.deepEqual(kinds, ['resistor', 'resistor', 'vccs']);
});

test('reduceNetwork reports no proofs and returns the original list for a non-series-parallel (bridge) network', () => {
  const primitives = [
    p('resistor', 'A', 'M', 'R1'),
    p('resistor', 'M', 'B', 'R2'),
    p('resistor', 'A', 'N', 'R3'),
    p('resistor', 'N', 'B', 'R4'),
    p('resistor', 'M', 'N', 'R5'),
  ];
  const result = reduceNetwork(primitives, ['A', 'B'], ops);
  assert.deepEqual(result.proofs, []);
  assert.deepEqual(result.primitives, primitives);
});
