import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSmallSignalV2 } from '../src/core/analysis/engine.js';
import { buildExactAnalysisPipeline } from '../src/core/analysis/pipeline.js';
import { createRationalOps } from '../src/core/analysis/algebra-ops.js';
import { adaptCombinedReport } from '../src/core/analysis/report-adapter.js';
import { smallSignalGoldenCorpus } from './fixtures/small-signal-golden.js';
import { commonSourceCascade, cascodeBranches } from './fixtures/topological-small-signal.js';

function evaluate(value, values) {
  if (value.kind === 'rational') return evaluate(value.numerator, values) / evaluate(value.denominator, values);
  if (value.kind === 'infinity') return value.sign * Infinity;
  if (value.kind === 'number') return Number(value.numerator) / Number(value.denominator);
  if (value.kind === 'symbol') {
    assert.notEqual(values[value.name], undefined, `missing ${value.name}`);
    return values[value.name];
  }
  if (value.kind === 'power') return evaluate(value.base, values) ** value.exponent;
  if (value.kind === 'multiply') return value.factors.reduce((a, b) => a * evaluate(b, values), 1);
  return value.terms.reduce((a, b) => a + evaluate(b, values), 0);
}

function close(actual, expected, label) {
  if (!Number.isFinite(expected)) assert.equal(Math.abs(actual), Math.abs(expected), label);
  else assert.ok(Math.abs(actual - expected) <= 1e-6 * Math.max(1, Math.abs(expected)), `${label}: ${actual} != ${expected}`);
}

function symbolic(circuit, options = {}) {
  const ops = createRationalOps({ maxOperations: options.maxOperations || 50000 });
  const pipeline = buildExactAnalysisPipeline(circuit, { input: 'IN.p', output: 'OUT.p', ops, s: ops.s(),
    valueOf: (value) => typeof value === 'string' ? ops.symbol(value) : value, millerApproximation: false, ...options });
  assert.equal(pipeline.ok, true, pipeline.error);
  return { pipeline, ops };
}

test('topological exact queries agree with a combined numeric solve across the golden corpus', () => {
  for (const fixture of smallSignalGoldenCorpus.filter((fixture) => fixture.id !== 'singular-floating')) {
    const options = fixture.id.includes('cascode') ? { acGrounds: ['VBIAS'] } : {};
    const { pipeline } = symbolic(fixture.build(), options);
    for (const sample of fixture.expected.samples) {
      const values = { ...sample.values };
      for (const name of Object.keys(values).filter((name) => /^gm/.test(name))) values[`gmb${name.slice(2)}`] ??= 0;
      const numeric = buildExactAnalysisPipeline(fixture.build(), { input: 'IN.p', output: 'OUT.p',
        values, s: sample.s, topologicalSolve: false, millerApproximation: false, ...options });
      assert.equal(numeric.ok, true, `${fixture.id}: ${numeric.error}`);
      for (const key of ['transfer', 'inputImpedance', 'outputImpedance']) close(
        evaluate(pipeline.queries[key].value, { ...values, s: sample.s }), numeric.queries[key].value, `${fixture.id} ${key}`,
      );
    }
  }
});

test('solves a long unilateral cascade in small blocks within a bounded budget', () => {
  const { pipeline, ops } = symbolic(commonSourceCascade(8), { maxOperations: 6000 });
  assert.equal(pipeline.solution.method, 'topological');
  assert.equal(pipeline.solution.blocks.length, 8);
  assert.ok(pipeline.solution.blocks.every((block) => block.length === 1));
  assert.equal(ops.budget.exceeded, false);
  const oldOps = createRationalOps({ maxOperations: 6000 });
  const old = buildExactAnalysisPipeline(commonSourceCascade(8), { input: 'IN.p', output: 'OUT.p',
    ops: oldOps, s: oldOps.s(), valueOf: (value) => typeof value === 'string' ? oldOps.symbol(value) : value,
    millerApproximation: false, topologicalSolve: false });
  assert.equal(old.ok, false);
  assert.equal(old.stage, 'budget');
  const values = { s: 100 };
  for (let i = 1; i <= 8; i++) Object.assign(values, { [`gm${i}`]: 0.001, [`ro${i}`]: 10000, [`R${i}`]: 1000 });
  close(evaluate(pipeline.queries.transfer.value, values), (-(1000 / 1100)) ** 8, 'cascade gain');
});

test('recursively combines parallel active branches before solving their common output', () => {
  const circuit = cascodeBranches();
  const options = { acGrounds: ['VBIASN', 'VBIASP'] };
  const { pipeline } = symbolic(circuit, options);
  assert.ok(pipeline.solution.partitions.some((split) => split.branches.length === 2));
  const values = { gm1: 0.002, gm2: 0.003, gm3: 0.002, ro1: 10000, ro2: 8000, ro3: 12000, ro4: 20000, gmb2: 0, gmb3: 0 };
  const lower = values.ro1 + values.ro2 + values.gm2 * values.ro1 * values.ro2;
  const upper = values.ro3 + values.ro4 + values.gm3 * values.ro3 * values.ro4;
  close(evaluate(pipeline.queries.outputImpedance.value, values), lower * upper / (lower + upper), 'cascode load');
});

test('keeps feedback across stages coupled and rejects a false cascade cut', () => {
  const report = analyzeSmallSignalV2(commonSourceCascade(3, { feedback: true }), { input: 'IN.p', output: 'OUT.p', millerApproximation: false });
  assert.equal(report.ok, true, report.error);
  assert.equal(report.details.topology.stages.length, 1);
  assert.ok(report.details.pipeline.solution.blocks.some((block) => block.length === 3));
});

test('preserves stage gains and parallel loading through the GUI adapter for a reactive cascade', () => {
  const report = analyzeSmallSignalV2(commonSourceCascade(3, { reactive: true }), { input: 'IN.p', output: 'OUT.p' });
  assert.equal(report.ok, true, report.error);
  assert.equal(report.details.topology.stages.length, 3);
  const gui = adaptCombinedReport(report);
  assert.match(gui.reports.transfer.equation, /g_\{m1\}.*g_\{m2\}.*g_\{m3\}/);
  assert.ok((gui.reports.transfer.equation.match(/\\parallel/g) || []).length >= 6);
  assert.match(gui.dcGain.equation, /\\parallel/);
  assert.doesNotMatch(gui.dcGain.equation, /C_\{/);
  assert.doesNotMatch(gui.dcGain.equation, /\\, -g_/);
});

test('preserves gm RS when high intrinsic gain is selected, including weak degeneration', () => {
  const fixture = smallSignalGoldenCorpus.find((fixture) => fixture.id === 'source-degeneration');
  const report = analyzeSmallSignalV2(fixture.build(), { input: 'IN.p', output: 'OUT.p' });
  const gui = adaptCombinedReport(report);
  assert.match(gui.dcGain.equation, /g_\{m1\}.*R_\{S\} \+ 1/);
  assert.match(gui.dcOutputImpedance.equation, /r_\{o1\}.*\\parallel R_\{D\}/);
  const values = { gm1: 0.001, ro1: 1e6, RS: 10, RD: 1000, gmb1: 0 };
  const gm = values.gm1 / (1 + values.gm1 * values.RS);
  const branch = values.ro1 * (1 + values.gm1 * values.RS);
  close(evaluate(report.transfer.expression, values), -gm * branch * values.RD / (branch + values.RD), 'weak degeneration');
});

test('a large cascode intrinsic gain retains an independent finite drain load', () => {
  const fixture = smallSignalGoldenCorpus.find((fixture) => fixture.id === 'nmos-cascode');
  const report = analyzeSmallSignalV2(fixture.build(), { input: 'IN.p', output: 'OUT.p', acGrounds: ['VBIAS'] });
  assert.match(report.output.dc.equation, /r_\{o2\}.*\\parallel R_\{D\}/);
  assert.match(report.transfer.dc.equation, /-g_\{m1\} \\,/);
  assert.doesNotMatch(report.transfer.dc.equation, /\\frac/);
  assert.ok(report.transfer.dc.equation.length < 300);
});

test('selected gm ro reduces cascode transconductance and keeps flat parallel loads in the GUI', () => {
  const report = analyzeSmallSignalV2(cascodeBranches(), { input: 'IN.p', output: 'OUT.p', acGrounds: ['VBIASN', 'VBIASP'] });
  const gui = adaptCombinedReport(report);
  assert.match(gui.dcGain.equation, /-g_\{m1\} \\,/);
  assert.doesNotMatch(gui.dcGain.equation, /\\frac/);
  assert.match(gui.dcOutputImpedance.equation, /g_\{m2\} \\, r_\{o2\} \\, r_\{o1\} \\parallel/);
  assert.match(gui.dcOutputImpedance.equation, /g_\{m3\} \\, r_\{o3\} \\, r_\{o4\}/);
  assert.doesNotMatch(gui.dcOutputImpedance.equation, /\\left/);
});

test('topological display remains exact when all approximations are disabled', () => {
  for (const id of ['nmos-common-gate', 'nmos-common-drain', 'source-degeneration', 'nmos-cascode', 'pivot-cross-coupled-pair']) {
    const fixture = smallSignalGoldenCorpus.find((fixture) => fixture.id === id);
    const options = { input: 'IN.p', output: 'OUT.p', millerApproximation: false,
      ignoreBodyEffect: false, gmroLarge: false, ...(id.includes('cascode') ? { acGrounds: ['VBIAS'] } : {}) };
    const report = analyzeSmallSignalV2(fixture.build(), options);
    assert.equal(report.ok, true, `${id}: ${report.error}`);
    assert.deepEqual(report.assumptions, [], id);
    const sample = fixture.expected.samples[0];
    const values = { ...sample.values, s: sample.s };
    for (const name of Object.keys(values).filter((name) => /^gm/.test(name))) values[`gmb${name.slice(2)}`] = 0.0001;
    const numeric = buildExactAnalysisPipeline(fixture.build(), { ...options, values, s: sample.s, topologicalSolve: false });
    close(evaluate(report.transfer.expression, values), numeric.queries.transfer.value, id);
  }
});
