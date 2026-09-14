import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractSmallSignalQueries } from '../src/core/analysis/queries.js';
import { createRationalOps } from '../src/core/analysis/algebra-ops.js';

const numberOps = {
  zero: 0,
  one: 1,
  add: (a, b) => a + b,
  sub: (a, b) => a - b,
  mul: (a, b) => a * b,
  div: (a, b) => a / b,
  neg: (a) => -a,
  isZero: (value) => value === 0,
};

const symbolicOps = {
  zero: '0',
  one: '1',
  add: (a, b) => `(${a}+${b})`,
  sub: (a, b) => `(${a}-${b})`,
  mul: (a, b) => `(${a}*${b})`,
  div: (a, b) => `(${a}/${b})`,
  neg: (a) => `(-${a})`,
  isZero: (value) => value === '0',
};

function solved(ops = numberOps, columns = [
  [2, -6, -0.5, 3, -1],
  [4, -12, -1, 5, -2],
]) {
  return {
    ok: true,
    ops,
    unknowns: ['V(IN)', 'V(OUT)', 'I(VIN)', 'V(TEST)', 'I(VTEST)'],
    columns,
  };
}

const metadata = {
  inputDrive: {
    rhsColumn: 0,
    voltageUnknown: 'V(IN)',
    currentUnknown: 'I(VIN)',
    currentSign: -1,
  },
  outputTest: {
    rhsColumn: 1,
    inputZeroed: true,
    voltageUnknown: 'V(TEST)',
    currentUnknown: 'I(VTEST)',
    currentSign: -1,
  },
};

test('extracts direct gain and correctly signed input/output impedances', () => {
  const result = extractSmallSignalQueries(solved(), {
    ...metadata,
    outputVoltageUnknown: 'V(OUT)',
  });

  assert.equal(result.ok, true);
  assert.equal(result.av.value, -3);
  assert.equal(result.zin.value, 4);
  assert.equal(result.zout.value, 2.5);
  assert.equal(result.zin.denominator.sign, -1);
  assert.equal(result.zout.denominator.sign, -1);
});

test('uses explicit RHS columns and accepts node and branch shorthand', () => {
  const result = extractSmallSignalQueries(solved(), {
    inputDrive: { rhsColumn: 0, source: { node: 'IN', branch: 'VIN', currentSign: -1 } },
    outputNode: 'OUT',
    outputTest: {
      rhsColumn: 1,
      source: { node: 'TEST', branch: 'VTEST', currentSign: -1 },
      inputZeroed: true,
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.av.rhsColumn, 0);
  assert.equal(result.zout.rhsColumn, 1);
  assert.equal(result.av.value, -3);
  assert.equal(result.zin.value, 4);
  assert.equal(result.zout.value, 2.5);
});

test('preserves exact symbolic and infinite-like values without numeric assumptions', () => {
  const result = extractSmallSignalQueries({
    ops: symbolicOps,
    variables: ['V(IN)', 'V(OUT)', 'I(VIN)', 'V(TEST)', 'I(VTEST)'],
    values: [
      ['VIN', 'VIN2'],
      ['0', 'OUT2'],
      ['IIN', 'IIN2'],
      ['VTEST', 'INF'],
      ['ITEST', 'INF'],
    ],
  }, {
    ...metadata,
    outputVoltageUnknown: 'V(OUT)',
  });

  assert.equal(result.ok, true);
  assert.equal(result.av.value, '(0/VIN)');
  assert.equal(result.zin.value, '(VIN/(-IIN))');
  assert.equal(result.zout.value, '(INF/(-INF))');
  assert.notEqual(result.zout.value, undefined);
});

test('reports a missing current branch instead of returning an invalid impedance', () => {
  const result = extractSmallSignalQueries({
    ...solved(),
    unknowns: ['V(IN)', 'V(OUT)', 'V(TEST)', 'I(VTEST)'],
    columns: [
      [2, -6, 3, -1],
      [4, -12, 5, -2],
    ],
  }, { ...metadata, outputVoltageUnknown: 'V(OUT)' });

  assert.equal(result.ok, false);
  assert.equal(result.av.ok, true);
  assert.equal(result.zin.ok, false);
  assert.equal(result.zin.code, 'missing-unknown');
  assert.match(result.zin.error, /I\(VIN\)/);
  assert.equal(result.zin.value, null);
  assert.equal(result.zout.ok, true);
});

test('rejects missing and non-independent RHS columns explicitly', () => {
  const missing = extractSmallSignalQueries(solved(), {
    ...metadata,
    inputDrive: { ...metadata.inputDrive, rhsColumn: 4 },
    outputVoltageUnknown: 'V(OUT)',
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.av.code, 'missing-rhs-column');
  assert.equal(missing.zin.code, 'missing-rhs-column');

  const sameColumn = extractSmallSignalQueries(solved(), {
    ...metadata,
    outputVoltageUnknown: 'V(OUT)',
    outputTest: { ...metadata.outputTest, rhsColumn: 0 },
  });
  assert.equal(sameColumn.zout.code, 'non-independent-test');
});

test('keeps direct Av authoritative when an optional cross-check disagrees', () => {
  const result = extractSmallSignalQueries(solved(), {
    ...metadata,
    outputVoltageUnknown: 'V(OUT)',
    avCrossCheck: { value: 12345 },
  });

  assert.equal(result.av.value, -3);
  assert.equal(result.av.crossCheck.value, 12345);
  assert.equal(result.av.crossCheck.source, 'optional-cross-check');
});

test('supports positive injected-current sign and zero numerator values', () => {
  const result = extractSmallSignalQueries({
    ops: numberOps,
    unknowns: ['V(IN)', 'V(OUT)', 'I(INJECT)', 'V(TEST)', 'I(TEST)'],
    columns: [[2, 0, 2, 0, 4], [1, 2, 1, 3, 2]],
  }, {
    inputDrive: {
      rhsColumn: 0,
      voltageUnknown: 'V(IN)',
      currentUnknown: 'I(INJECT)',
      currentSign: 1,
    },
    outputVoltageUnknown: 'V(OUT)',
    outputTest: {
      rhsColumn: 1,
      voltageUnknown: 'V(TEST)',
      currentUnknown: 'I(TEST)',
      currentSign: 1,
    },
  });

  assert.equal(result.av.value, 0);
  assert.equal(result.zin.value, 1);
  assert.equal(result.zout.value, 1.5);
});

test('returns exact infinity for an ideal open input current', () => {
  const ops = createRationalOps({ maxOperations: 100000 });
  const result = extractSmallSignalQueries({
    ops,
    unknowns: ['V(IN)', 'V(OUT)', 'I(VIN)', 'V(TEST)', 'I(VTEST)'],
    columns: [
      [ops.one, ops.one, ops.zero, ops.zero, ops.zero],
      [ops.zero, ops.zero, ops.zero, ops.one, ops.one],
    ],
  }, {
    inputDrive: {
      rhsColumn: 0,
      voltageUnknown: 'V(IN)',
      currentUnknown: 'I(VIN)',
      currentSign: -1,
    },
    output: { voltageUnknown: 'V(OUT)' },
    outputTest: {
      rhsColumn: 1,
      inputZeroed: true,
      voltageUnknown: 'V(TEST)',
      currentUnknown: 'I(VTEST)',
      currentSign: 1,
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.zin.value.kind, 'infinity');
  assert.equal(result.zin.value.sign, 1);
});
