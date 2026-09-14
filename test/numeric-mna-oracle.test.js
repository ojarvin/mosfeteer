import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  branchCurrent,
  complexMagnitude,
  nodeVoltage,
  samplePositive,
  samplePositiveParameters,
  solveNumericMna,
} from './helpers/numeric-mna-oracle.js';

function close(actual, expected, tolerance = 1e-9) {
  const error = complexMagnitude({ re: actual.re - expected.re, im: actual.im - expected.im });
  const scale = Math.max(1, complexMagnitude(expected));
  assert.ok(error <= tolerance * scale, `expected ${JSON.stringify(actual)} ≈ ${JSON.stringify(expected)}`);
}

function voltageSource(id, positive, negative, value) {
  return { type: 'voltage-source', id, positive, negative, value };
}

test('numeric MNA oracle solves a resistive divider and voltage-source current', () => {
  const result = solveNumericMna([
    voltageSource('VIN', 'in', '0', 1),
    { type: 'resistor', positive: 'in', negative: 'out', resistance: 1000 },
    { type: 'resistor', positive: 'out', negative: '0', resistance: 2000 },
  ], 0);

  assert.equal(result.status, 'ok');
  close(nodeVoltage(result, 'in'), { re: 1, im: 0 });
  close(nodeVoltage(result, 'out'), { re: 2 / 3, im: 0 });
  close(branchCurrent(result, 'VIN'), { re: -1 / 3000, im: 0 });
});

test('numeric MNA oracle evaluates an RC pole at an angular frequency', () => {
  const result = solveNumericMna([
    voltageSource('VIN', 'in', '0', 1),
    { type: 'resistor', positive: 'in', negative: 'out', resistance: 1000 },
    { type: 'capacitor', positive: 'out', negative: '0', capacitance: 1e-6 },
  ], 1000);

  close(nodeVoltage(result, 'out'), { re: 0.5, im: -0.5 });
});

test('numeric MNA oracle represents an inductor with a branch current', () => {
  const result = solveNumericMna([
    { type: 'inductor', id: 'L1', positive: 'out', negative: '0', inductance: 2e-3 },
    { type: 'current-source', positive: '0', negative: 'out', value: 1 },
  ], 1000);

  close(nodeVoltage(result, 'out'), { re: 0, im: 2 });
  close(branchCurrent(result, 'L1'), { re: 1, im: 0 });
});

test('numeric MNA oracle preserves VCCS current orientation', () => {
  const result = solveNumericMna([
    voltageSource('VIN', 'in', '0', 1),
    { type: 'resistor', positive: 'out', negative: '0', resistance: 1000 },
    {
      type: 'vccs',
      positive: 'out',
      negative: '0',
      controlPositive: 'in',
      controlNegative: '0',
      transconductance: 2e-3,
    },
  ], 0);

  close(nodeVoltage(result, 'out'), { re: -2, im: 0 });
});

test('numeric MNA oracle supports multiple current-source RHS excitations', () => {
  const result = solveNumericMna([
    { type: 'resistor', positive: 'out', negative: '0', resistance: 1000 },
  ], 0, {
    excitations: [
      [{ type: 'current-source', positive: '0', negative: 'out', value: 1e-3 }],
      [{ type: 'current-source', positive: '0', negative: 'out', value: 2e-3 }],
    ],
  });

  assert.equal(result.solutions.length, 2);
  close(nodeVoltage(result, 'out', 0), { re: 1, im: 0 });
  close(nodeVoltage(result, 'out', 1), { re: 2, im: 0 });
});

test('numeric MNA oracle supports multiple voltage-source test excitations', () => {
  const result = solveNumericMna([
    { type: 'resistor', positive: 'out', negative: '0', resistance: 1000 },
  ], 0, {
    excitations: [
      [{ type: 'voltage-source', id: 'VTEST', positive: 'out', negative: '0', value: 1 }],
      [{ type: 'voltage-source', id: 'VTEST', positive: 'out', negative: '0', value: 2 }],
    ],
  });

  assert.equal(result.solutions.length, 2);
  close(nodeVoltage(result, 'out', 0), { re: 1, im: 0 });
  close(nodeVoltage(result, 'out', 1), { re: 2, im: 0 });
  close(branchCurrent(result, 'VTEST', 0), { re: -1e-3, im: 0 });
  close(branchCurrent(result, 'VTEST', 1), { re: -2e-3, im: 0 });
});

test('numeric MNA oracle reports singular systems instead of returning garbage', () => {
  const result = solveNumericMna([
    { type: 'resistor', positive: 'a', negative: 'b', resistance: 1000 },
  ], 0);

  assert.equal(result.ok, false);
  assert.equal(result.status, 'singular');
  assert.match(result.diagnostics.message, /singular MNA system/);
  assert.equal(result.diagnostics.rank, 1);
});

test('numeric MNA oracle identifies a finite but ill-conditioned system', () => {
  const result = solveNumericMna([
    { type: 'resistor', positive: 'a', negative: '0', resistance: 1 },
    { type: 'resistor', positive: 'b', negative: '0', resistance: 1e15 },
  ], 0);

  assert.equal(result.ok, true);
  assert.equal(result.status, 'ill-conditioned');
  assert.ok(result.diagnostics.conditionEstimate > 1e12);
  assert.match(result.diagnostics.message, /ill-conditioned MNA system/);
});

test('numeric MNA sampling is seeded, positive, and covers model parameters', () => {
  const first = samplePositiveParameters(12345, 3);
  assert.deepEqual(first, samplePositiveParameters(12345, 3));
  assert.notDeepEqual(first, samplePositiveParameters(12346, 3));
  for (const sample of first) {
    for (const name of ['gm', 'gmb', 'go', 'R', 'C', 'L']) assert.ok(sample[name] > 0);
  }
  assert.equal(samplePositive(7, 10, 10), 10);
});
