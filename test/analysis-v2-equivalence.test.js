import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildExactAnalysisPipeline } from '../src/core/analysis/pipeline.js';
import { smallSignalGoldenCorpus } from './fixtures/small-signal-golden.js';
import {
  branchCurrent,
  complexMagnitude,
  nodeVoltage,
  solveNumericMna,
} from './helpers/numeric-mna-oracle.js';

const ZERO = Object.freeze({ re: 0, im: 0 });
const ONE = Object.freeze({ re: 1, im: 0 });

function asComplex(value) {
  return typeof value === 'number' ? { re: value, im: 0 } : value;
}

function add(left, right) {
  const a = asComplex(left);
  const b = asComplex(right);
  return { re: a.re + b.re, im: a.im + b.im };
}

function subtract(left, right) {
  const a = asComplex(left);
  const b = asComplex(right);
  return { re: a.re - b.re, im: a.im - b.im };
}

function multiply(left, right) {
  const a = asComplex(left);
  const b = asComplex(right);
  return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re };
}

function divide(left, right) {
  const a = asComplex(left);
  const b = asComplex(right);
  const denominator = b.re ** 2 + b.im ** 2;
  if (denominator === 0) return { re: Infinity, im: 0 };
  return {
    re: (a.re * b.re + a.im * b.im) / denominator,
    im: (a.im * b.re - a.re * b.im) / denominator,
  };
}

function negate(value) {
  const item = asComplex(value);
  return { re: -item.re, im: -item.im };
}

const complexOps = Object.freeze({
  zero: ZERO,
  one: ONE,
  add,
  sub: subtract,
  mul: multiply,
  div: divide,
  neg: negate,
  isZero: (value) => {
    const item = asComplex(value);
    return item.re === 0 && item.im === 0;
  },
});

function sampleValues(sample) {
  const values = { ...sample.values };
  for (const [name, value] of Object.entries(sample.values)) {
    if (/^ro\d+$/.test(name)) values[`go${name.slice(2)}`] = 1 / value;
    if (/^gm\d+$/.test(name) && values[`gmb${name.slice(2)}`] === undefined) {
      values[`gmb${name.slice(2)}`] = 0;
    }
  }
  return values;
}

function nodeName(value) {
  return value === '@AC_GROUND' ? '0' : String(value);
}

function endpoint(primitive, positive) {
  if (primitive.kind === 'vccs') {
    return nodeName(positive ? primitive.outPlus : primitive.outMinus);
  }
  return nodeName(positive ? primitive.a : primitive.b);
}

function numericPrimitive(primitive) {
  const positive = endpoint(primitive, true);
  const negative = endpoint(primitive, false);
  if (primitive.kind === 'conductance') {
    return {
      id: primitive.id,
      type: 'resistor',
      positive,
      negative,
      resistance: 1 / primitive.value,
    };
  }
  if (primitive.kind === 'resistor') {
    return { id: primitive.id, type: 'resistor', positive, negative, resistance: primitive.value };
  }
  if (primitive.kind === 'capacitor') {
    return { id: primitive.id, type: 'capacitor', positive, negative, capacitance: primitive.value };
  }
  if (primitive.kind === 'inductor') {
    return { id: primitive.id, type: 'inductor', positive, negative, inductance: primitive.value };
  }
  if (primitive.kind === 'vccs') {
    return {
      id: primitive.id,
      type: 'vccs',
      positive,
      negative,
      controlPositive: nodeName(primitive.controlPlus),
      controlNegative: nodeName(primitive.controlMinus),
      transconductance: primitive.gm,
    };
  }
  throw new TypeError(`unsupported pipeline primitive in equivalence test: ${primitive.kind}`);
}

function numericElements(report, fixture) {
  const disconnected = fixture.id === 'disconnected-reactive-island';
  return report.primitives
    .filter((primitive) => !(disconnected && primitive.component === 'CISO'))
    .map(numericPrimitive);
}

function numericQueries(report, fixture, sample) {
  const input = nodeName(report.context.input.node);
  const output = nodeName(report.context.output.node);
  const numeric = solveNumericMna(numericElements(report, fixture), sample.s, {
    excitations: [
      [{ type: 'voltage-source', id: '@analysis-input', positive: input, negative: '0', value: 1 }],
      [{ type: 'current-source', id: '@analysis-output', positive: '0', negative: output, value: 1 }],
    ],
  });
  if (!numeric.ok) return numeric;
  const inputVoltage = nodeVoltage(numeric, input, 0);
  const outputVoltage = nodeVoltage(numeric, output, 0);
  const inputCurrent = negate(branchCurrent(numeric, '@analysis-input', 0));
  return {
    ok: true,
    numeric,
    values: {
      transfer: divide(outputVoltage, inputVoltage),
      inputImpedance: divide(inputVoltage, inputCurrent),
      outputImpedance: nodeVoltage(numeric, output, 1),
    },
  };
}

function closeEnough(actual, expected) {
  const a = asComplex(actual);
  const b = asComplex(expected);
  if (!Number.isFinite(a.re) || !Number.isFinite(b.re)) {
    return a.re === b.re && a.im === b.im;
  }
  const error = complexMagnitude({ re: a.re - b.re, im: a.im - b.im });
  const scale = Math.max(1, complexMagnitude(a), complexMagnitude(b));
  return error <= 2e-8 * scale;
}

function compareValues(report, expected, fixture, sampleIndex) {
  const failures = [];
  for (const name of ['transfer', 'inputImpedance', 'outputImpedance']) {
    const actual = report.queries[name].value;
    if (!closeEnough(actual, expected.values[name])) {
      failures.push(`${fixture.id} sample ${sampleIndex} ${name}: pipeline=${JSON.stringify(actual)} oracle=${JSON.stringify(expected.values[name])}`);
    }
  }
  return failures;
}

test('v2 pipeline agrees with the independent numeric MNA oracle', () => {
  const failures = [];
  const comparedFixtures = new Set();
  const blockedFixtures = new Set();
  const coverage = { fixtures: smallSignalGoldenCorpus.length, samples: 0, comparedSamples: 0 };

  for (const fixture of smallSignalGoldenCorpus) {
    for (const [sampleIndex, sample] of fixture.expected.samples.entries()) {
      coverage.samples += 1;
      const report = buildExactAnalysisPipeline(fixture.build(), {
        input: fixture.ports.input,
        output: fixture.ports.output,
        values: sampleValues(sample),
        s: { re: 0, im: sample.s },
        ops: complexOps,
      });
      if (!report.ok) {
        blockedFixtures.add(fixture.id);
        failures.push(`${fixture.id} sample ${sampleIndex}: pipeline ${report.stage} failure: ${report.error}`);
        continue;
      }
      const oracle = numericQueries(report, fixture, sample);
      if (!oracle.ok) {
        blockedFixtures.add(fixture.id);
        failures.push(`${fixture.id} sample ${sampleIndex}: numeric oracle ${oracle.status} failure`);
        continue;
      }
      comparedFixtures.add(fixture.id);
      coverage.comparedSamples += 1;
      failures.push(...compareValues(report, oracle, fixture, sampleIndex));
    }
  }

  const coverageText = `equivalence coverage ${comparedFixtures.size}/${coverage.fixtures} fixtures, `
    + `${coverage.comparedSamples}/${coverage.samples} samples; blocked: ${[...blockedFixtures].join(', ') || 'none'}`;
  assert.deepEqual(failures, [], `${coverageText}\n${failures.join('\n')}`);
});

test('disconnected reactive islands do not change port results', () => {
  const base = smallSignalGoldenCorpus.find(({ id }) => id === 'nmos-common-source');
  const isolated = smallSignalGoldenCorpus.find(({ id }) => id === 'disconnected-reactive-island');
  const sample = base.expected.samples[0];
  const options = {
    input: base.ports.input,
    output: base.ports.output,
    values: sampleValues(sample),
    s: { re: 0, im: sample.s },
    ops: complexOps,
  };
  const baseReport = buildExactAnalysisPipeline(base.build(), options);
  const isolatedReport = buildExactAnalysisPipeline(isolated.build(), {
    ...options,
    input: isolated.ports.input,
    output: isolated.ports.output,
  });
  assert.equal(baseReport.ok, true, baseReport.error);
  assert.equal(isolatedReport.ok, true, isolatedReport.error);
  for (const name of ['transfer', 'inputImpedance', 'outputImpedance']) {
    assert.equal(closeEnough(baseReport.queries[name].value, isolatedReport.queries[name].value), true, name);
  }
  assert.equal(isolatedReport.coupled.primitives.some(({ component }) => component === 'CISO'), false);
});

test('singular-fixture solvability status agrees with the numeric oracle', () => {
  const fixture = smallSignalGoldenCorpus.find(({ id }) => id === 'singular-floating');
  const sample = fixture.expected.samples[0];
  const report = buildExactAnalysisPipeline(fixture.build(), {
    input: fixture.ports.input,
    output: fixture.ports.output,
    values: sampleValues(sample),
    s: { re: 0, im: sample.s },
    ops: complexOps,
  });
  assert.equal(report.ok, true, report.error);
  const oracle = numericQueries(report, fixture, sample);
  assert.equal(oracle.ok, report.ok, `pipeline=${report.error} oracle=${oracle.diagnostics?.message}`);
});
