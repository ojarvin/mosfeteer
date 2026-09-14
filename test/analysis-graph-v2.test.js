import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AC_GROUND } from '../src/core/analysis/context.js';
import { coupledSubgraph } from '../src/core/analysis/graph.js';

const p = (kind, id, a, b, value = 1, control) => ({
  kind, id, terminals: { a, b }, value,
  ...(control ? { control: { a: control[0], b: control[1] } } : {}),
});

test('disconnected RLC islands are excluded while ground does not bridge islands', () => {
  const primitives = [
    p('resistor', 'R1', 'IN', AC_GROUND),
    p('capacitor', 'CISO', 'ISO1', 'ISO2'),
    p('inductor', 'LISO', 'ISO2', AC_GROUND),
    p('resistor', 'R2', AC_GROUND, 'OTHER'),
  ];
  const result = coupledSubgraph(primitives, ['IN']);
  assert.deepEqual(result.primitiveIndices, [0]);
  assert.deepEqual(result.nodeOrder, ['IN']);
  assert.deepEqual([...result.nodes], ['IN']);
});

test('controlled sources couple output and every control dependency', () => {
  const primitives = [
    p('resistor', 'RIN', 'IN', 'GATE'),
    p('vccs', 'GM1', 'OUT', AC_GROUND, 1, ['GATE', AC_GROUND]),
    p('capacitor', 'CLOAD', 'OUT', AC_GROUND),
    p('resistor', 'RISO', 'ISOLATED', 'ISO_GROUND'),
  ];
  const result = coupledSubgraph(primitives, ['OUT']);
  assert.deepEqual(result.primitiveIndices, [0, 1, 2]);
  assert.deepEqual(result.nodeOrder, ['OUT', 'IN', 'GATE']);
});

test('controlled sources use the strict terminal contract', () => {
  const primitives = [
    p('conductance', 'R1', 'N1', 'N2'),
    p('vccs', 'E1', 'OUT', '0', 1, ['N1', '0']),
  ];
  const result = coupledSubgraph(primitives, ['OUT'], {
    nodeAliases: { '0': AC_GROUND },
  });
  assert.deepEqual(result.primitiveIndices, [0, 1]);
  assert.deepEqual(result.nodeOrder, ['OUT', 'N1', 'N2']);
});

test('controlled sources retain output and control dependencies', () => {
  const primitives = [
    p('vccs', 'M3', 'OUT', AC_GROUND, 1, ['MIRROR', AC_GROUND]),
    p('resistor', 'RBIAS', 'MIRROR', AC_GROUND),
  ];
  const result = coupledSubgraph(primitives, ['OUT']);
  assert.deepEqual(result.primitiveIndices, [0, 1]);
  assert.deepEqual(result.nodeOrder, ['OUT', 'MIRROR']);
});

test('unsupported controlled-source kinds are ignored by the relevance graph', () => {
  const result = coupledSubgraph([
    p('vcvs', 'E1', 'OUT', '0', 1, ['IN', '0']),
  ], ['OUT']);
  assert.equal(result.primitives.length, 0);
  assert.deepEqual(result.diagnostics, []);
});

test('graph ordering follows primitive order and uses linear queue traversal', () => {
  const primitives = [
    p('resistor', 'R2', 'B', 'C'),
    p('resistor', 'R1', 'A', 'B'),
    p('resistor', 'R3', 'C', 'D'),
  ];
  const result = coupledSubgraph(primitives, ['A']);
  assert.deepEqual(result.primitiveIndices, [0, 1, 2]);
  assert.deepEqual(result.nodeOrder, ['A', 'B', 'C', 'D']);
});
