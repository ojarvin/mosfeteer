import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRationalOps } from '../src/core/analysis/algebra-ops.js';
import { buildExactAnalysisPipeline } from '../src/core/analysis/pipeline.js';
import { numberOps } from '../src/core/analysis/mna.js';
import { smallSignalGoldenCorpus } from './fixtures/small-signal-golden.js';

// Wall clock is a smoke check against pathological slowdowns, not the real
// guard -- the operation ceilings below are deterministic and unchanged. The
// multiplier carries enough slack for a loaded machine: the suite runs its
// files in parallel, and an exact solve of a compensated cascode now runs
// beside these.
const TIMING_MULTIPLIER = 12;
const BASELINE_CEILINGS_MS = Object.freeze({ oneTransistor: 50, twoTransistor: 200 });
const OPERATION_CEILINGS = Object.freeze({
  oneTransistor: 500,
  twoTransistor: 1500,
  secondOrderRlc: 5000,
});

function fixture(id) {
  const result = smallSignalGoldenCorpus.find((entry) => entry.id === id);
  assert.ok(result, `missing golden fixture ${id}`);
  return result;
}

function valuesFor(sample) {
  const values = { ...sample.values };
  for (const [name, value] of Object.entries(sample.values)) {
    if (/^ro\d/.test(name)) values[`go${name.slice(2)}`] = 1 / value;
    if (/^gm\d/.test(name)) values[`gmb${name.slice(2)}`] = 0;
  }
  return values;
}

function countingNumberOps() {
  const base = numberOps();
  const counts = Object.fromEntries(['add', 'sub', 'mul', 'div', 'neg', 'isZero'].map((name) => [name, 0]));
  const ops = { ...base };
  for (const name of Object.keys(counts)) {
    ops[name] = (...args) => {
      counts[name] += 1;
      return base[name](...args);
    };
  }
  Object.defineProperty(ops, 'counts', { value: counts });
  return ops;
}

function operationCount(ops) {
  return Object.values(ops.counts).reduce((total, count) => total + count, 0);
}

function analysisOptions(entry, sampleIndex = 0, extra = {}) {
  const sample = entry.expected.samples[sampleIndex];
  return {
    input: entry.ports.input,
    output: entry.ports.output,
    values: valuesFor(sample),
    s: sample.s,
    ...(entry.id.includes('cascode') ? { acGrounds: ['VBIAS'] } : {}),
    ...extra,
  };
}

function timedAnalysis(entry, options) {
  const circuit = entry.build();
  const firstOps = countingNumberOps();
  const firstStart = performance.now();
  const first = buildExactAnalysisPipeline(circuit, { ...options, ops: firstOps });
  const firstMs = performance.now() - firstStart;
  assert.equal(first.ok, true, first.error);

  const warm = [];
  for (let index = 0; index < 3; index += 1) {
    const ops = countingNumberOps();
    const start = performance.now();
    const report = buildExactAnalysisPipeline(circuit, { ...options, ops });
    warm.push({ report, ms: performance.now() - start, operations: operationCount(ops) });
    assert.equal(report.ok, true, report.error);
  }
  return {
    first,
    firstMs,
    firstOperations: operationCount(firstOps),
    warm,
  };
}

function assertTiming(result, ceiling, label) {
  const limit = ceiling * TIMING_MULTIPLIER;
  assert.ok(result.firstMs <= limit, `${label} first construction took ${result.firstMs.toFixed(2)} ms; limit ${limit} ms`);
  for (const [index, sample] of result.warm.entries()) {
    assert.ok(sample.ms <= limit, `${label} warm run ${index} took ${sample.ms.toFixed(2)} ms; limit ${limit} ms`);
  }
}

test('bounds one-transistor exact analysis and repeated warm runs', () => {
  const entry = fixture('nmos-common-source');
  const result = timedAnalysis(entry, analysisOptions(entry));

  assertTiming(result, BASELINE_CEILINGS_MS.oneTransistor, entry.id);
  assert.ok(result.firstOperations <= OPERATION_CEILINGS.oneTransistor, `${entry.id} used ${result.firstOperations} operations`);
  assert.ok(result.first.system.unknowns.length <= 4);
  assert.ok(result.warm.every(({ operations }) => operations <= OPERATION_CEILINGS.oneTransistor));
});

test('bounds two-transistor inverter and cascode analysis', () => {
  for (const id of ['cmos-inverter', 'nmos-cascode']) {
    const entry = fixture(id);
    const result = timedAnalysis(entry, analysisOptions(entry));
    assertTiming(result, BASELINE_CEILINGS_MS.twoTransistor, id);
    assert.ok(result.firstOperations <= OPERATION_CEILINGS.twoTransistor, `${id} used ${result.firstOperations} operations`);
    assert.ok(result.warm.every(({ operations }) => operations <= OPERATION_CEILINGS.twoTransistor));
  }
});

test('prunes disconnected islands without increasing exact solve work', () => {
  const entry = fixture('disconnected-reactive-island');
  const result = timedAnalysis(entry, analysisOptions(entry));

  assertTiming(result, BASELINE_CEILINGS_MS.oneTransistor, entry.id);
  assert.deepEqual(result.first.coupled.primitiveIndices, [0, 1, 2, 3]);
  assert.equal(result.first.system.unknowns.some((name) => /ISO/.test(name)), false);
  assert.ok(result.firstOperations <= OPERATION_CEILINGS.oneTransistor);
});

test('bounds a symbolic second-order RLC solve and preserves its algebra budget', () => {
  const entry = fixture('rlc-second-order');
  const ops = createRationalOps({ maxOperations: OPERATION_CEILINGS.secondOrderRlc });
  const start = performance.now();
  const report = buildExactAnalysisPipeline(entry.build(), {
    input: entry.ports.input,
    output: entry.ports.output,
    ops,
    s: ops.s(),
    valueOf: (value) => typeof value === 'string' ? ops.symbol(value) : value,
  });
  const elapsed = performance.now() - start;

  assert.equal(report.ok, true, report.error);
  assert.equal(ops.budget.exceeded, false);
  assert.ok(ops.budget.used <= OPERATION_CEILINGS.secondOrderRlc, `RLC used ${ops.budget.used} operations`);
  assert.equal(report.queries.transfer.value.kind, 'rational');
  assert.ok(elapsed <= BASELINE_CEILINGS_MS.twoTransistor * TIMING_MULTIPLIER, `RLC solve took ${elapsed.toFixed(2)} ms`);
});
