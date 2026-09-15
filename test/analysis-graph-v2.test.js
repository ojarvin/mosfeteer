import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AC_GROUND } from '../src/core/analysis/context.js';
import { coupledSubgraph, splitAtNode } from '../src/core/analysis/graph.js';

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

test('independent current sources do not couple an attached island', () => {
  const primitives = [
    p('resistor', 'R1', 'IN', 'OUT'),
    p('current-source', 'IISO', 'OUT', 'ISO'),
    p('resistor', 'RISO', 'ISO', AC_GROUND),
  ];
  const result = coupledSubgraph(primitives, ['IN']);
  assert.deepEqual(result.primitiveIndices, [0]);
  assert.deepEqual(result.nodeOrder, ['IN', 'OUT']);
});

test('zero-admittance branches and s=0 capacitors do not couple islands', () => {
  const primitives = [
    p('resistor', 'R1', 'IN', 'OUT'),
    p('conductance', 'G0', 'OUT', 'G_ISO', 0),
    p('capacitor', 'C0', 'OUT', 'C_ISO', 0),
    p('resistor', 'RG', 'G_ISO', AC_GROUND),
    p('resistor', 'RC', 'C_ISO', AC_GROUND),
    p('capacitor', 'CS', 'OUT', 'S_ISO', { kind: 'symbol', name: 'sC' }),
    p('resistor', 'RS', 'S_ISO', AC_GROUND),
  ];
  const result = coupledSubgraph(primitives, ['IN']);
  assert.deepEqual(result.primitiveIndices, [0, 5, 6]);
  assert.deepEqual(result.nodeOrder, ['IN', 'OUT', 'S_ISO']);
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

test('splitAtNode separates two branches joined only at the boundary node', () => {
  const primitives = [
    p('resistor', 'R1', 'A', 'OUT'),
    p('resistor', 'R2', 'A', AC_GROUND),
    p('resistor', 'R3', 'B', 'OUT'),
    p('resistor', 'R4', 'B', AC_GROUND),
  ];
  const split = splitAtNode(primitives, 'OUT');
  assert.equal(split.components.length, 2);
  assert.deepEqual(split.shunts, []);
  const groups = split.components.map(({ primitiveIndices }) => [...primitiveIndices].sort());
  assert.deepEqual(groups.sort(), [[0, 1], [2, 3]]);
  assert.equal(split.componentOf('OUT'), null);
  assert.notEqual(split.componentOf('A'), split.componentOf('B'));
});

test('splitAtNode refuses a split when a controlled source crosses branches', () => {
  const primitives = [
    p('resistor', 'R1', 'A', 'OUT'),
    p('resistor', 'R2', 'A', AC_GROUND),
    p('resistor', 'R3', 'B', 'OUT'),
    p('resistor', 'R4', 'B', AC_GROUND),
    p('vccs', 'GX', 'A', AC_GROUND, 1, ['B', AC_GROUND]),
  ];
  assert.equal(splitAtNode(primitives, 'OUT'), null);
});

test('splitAtNode reports a direct node-to-ground shunt separately', () => {
  const primitives = [
    p('resistor', 'R1', 'A', 'OUT'),
    p('resistor', 'R2', 'A', AC_GROUND),
    p('resistor', 'R3', 'B', 'OUT'),
    p('resistor', 'R4', 'B', AC_GROUND),
    p('resistor', 'RSHUNT', 'OUT', AC_GROUND),
  ];
  const split = splitAtNode(primitives, 'OUT');
  assert.equal(split.components.length, 2);
  assert.deepEqual(split.shunts, [4]);
});

test('splitAtNode returns null when the node is not an articulation point', () => {
  const primitives = [
    p('resistor', 'R1', 'A', 'OUT'),
    p('resistor', 'R2', 'A', 'B'),
    p('resistor', 'R3', 'B', 'OUT'),
  ];
  assert.equal(splitAtNode(primitives, 'OUT'), null);
});
