import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { analyzeSmallSignalV2 } from '../src/core/analysis/engine.js';
import { adaptCombinedReport } from '../src/core/analysis/report-adapter.js';
import { add, integer, multiply, rationalFunction, symbol } from '../src/core/analysis/rational.js';
import { analyzeResponse } from '../src/core/analysis/response.js';

const R = symbol('R');
const C = symbol('C');
const s = symbol('s');

function exact(expression) {
  return analyzeResponse(expression);
}

function fixture(overrides = {}) {
  return {
    context: {
      input: { node: 'VIN', name: 'V_{IN}' },
      output: { node: 'VOUT', name: 'V_{OUT}' },
      reference: { node: '0', name: 'AC_GROUND' },
    },
    results: {
      Zin: exact(R),
      Zout: exact(R),
      Av: exact(integer(1)),
    },
    details: { equations: ['VOUT = VIN'], solution: { 'V(VOUT)': 'VIN' }, log: ['solved'] },
    smallSignalNetlist: '* v2 netlist',
    ...overrides,
  };
}

test('maps an exact non-reactive response without AC rows', () => {
  const report = adaptCombinedReport(fixture());

  assert.equal(report.ok, true);
  assert.equal(report.complete, true);
  assert.equal(report.reports.input.equation, 'Z_{in} = R');
  assert.equal(report.reports.input.frequencyResponse, undefined);
  assert.equal(report.reports.transfer.acTransfer, undefined);
  assert.equal(report.reports.transfer.dcGain.equation, 'A_v(0) = 1');
  assert.deepEqual(report.equationOrder, ['DC input impedance', 'DC output impedance', 'DC gain']);
  assert.deepEqual(report.reports.transfer.equations, ['VOUT = VIN']);
  assert.deepEqual(report.reports.transfer.solution, { 'V(VOUT)': 'VIN' });
  assert.equal(report.smallSignalNetlist, '* v2 netlist');
});

test('keeps selected ports separate from solved impedance quantities', () => {
  const report = adaptCombinedReport(fixture());

  assert.deepEqual(report.input, fixture().context.input);
  assert.deepEqual(report.output, fixture().context.output);
  assert.deepEqual(report.reference, fixture().context.reference);
  assert.deepEqual(report.inputPort, report.context.input);
  assert.deepEqual(report.outputPort, report.context.output);
  assert.deepEqual(report.referencePort, report.context.reference);
  assert.strictEqual(report.inputImpedance, report.reports.input);
  assert.strictEqual(report.outputImpedance, report.reports.output);
  assert.strictEqual(report.voltageTransfer, report.reports.transfer);
  assert.notEqual(report.input, report.inputImpedance);
});

test('maps selected approximations while retaining exact equations', () => {
  const report = adaptCombinedReport(fixture({
    assumptions: ['g_mb = 0'],
    approximations: ['g_m r_o >> 1'],
    results: {
      Zin: exact(R),
      Zout: { exact: exact(multiply(R, symbol('g_m'))), selected: exact(R) },
      Av: exact(integer(1)),
    },
  }));

  const output = report.reports.output;
  assert.equal(output.equation, 'Z_{out} \\approx R');
  assert.equal(output.exactEquation, 'Z_{out} = g_{m} \\, R');
  assert.deepEqual(report.assumptions, ['g_mb = 0']);
  assert.deepEqual(report.approximations, ['g_m r_o >> 1']);
});

test('maps reactive responses, DC limits, and zero-based roots', () => {
  const transfer = rationalFunction(integer(1), add(integer(1), multiply(R, C, s)));
  const report = adaptCombinedReport(fixture({
    results: { Zin: exact(rationalFunction(integer(1), multiply(s, C))), Zout: exact(R), Av: exact(transfer) },
  }));

  assert.equal(report.reports.input.equation, 'Z_{in}(s) = \\frac{1}{s \\, C}');
  assert.equal(report.reports.transfer.acTransfer.equation, 'A_v(s) = \\frac{1}{s \\, C \\, R + 1}');
  assert.equal(report.reports.transfer.dcGain.equation, 'A_v(0) = 1');
  assert.equal(report.reports.transfer.frequencyResponse.poles[0].index, 0);
  assert.equal(report.reports.transfer.frequencyResponse.poles[0].equation, 'p_{0} = -\\frac{1}{C \\, R}');
  assert.deepEqual(report.equationOrder, [
    'AC input impedance', 'DC input impedance', 'DC output impedance',
    'AC gain', 'DC gain', 'Poles',
  ]);
});

test('preserves partial child failures and marks the combined report incomplete', () => {
  const report = adaptCombinedReport(fixture({
    results: {
      Zin: exact(R),
      Zout: { ok: false, error: 'singular output test', diagnostics: [{ code: 'singular-system' }] },
      Av: exact(integer(1)),
    },
  }));

  assert.equal(report.ok, true);
  assert.equal(report.complete, false);
  assert.equal(report.reports.output.ok, false);
  assert.equal(report.reports.output.error, 'singular output test');
  assert.deepEqual(report.reports.output.diagnostics, [{ code: 'singular-system' }]);
});

test('maps a singular combined report into three explicit failures', () => {
  const report = adaptCombinedReport({
    ok: false,
    error: 'singular system',
    stage: 'solve',
    diagnostics: [{ code: 'singular-system' }],
    details: { equations: ['0 = 1'], solution: null, log: ['pivot failed'] },
  });

  assert.equal(report.ok, false);
  assert.equal(report.complete, false);
  assert.equal(report.reports.input.error, 'singular system');
  assert.equal(report.reports.output.error, 'singular system');
  assert.equal(report.reports.transfer.error, 'singular system');
  assert.equal(report.reports.transfer.stage, 'solve');
  assert.deepEqual(report.reports.transfer.equations, ['0 = 1']);
  assert.deepEqual(report.reports.transfer.log, ['pivot failed']);
});

test('carries network-pre-reduction parallel notation through to the legacy shape the GUI actually renders', () => {
  // web/main.js calls exactly this combination — adaptCombinedReport() has
  // its own, separate equation-rendering path from engine.js's own report
  // fields, and previously threaded neither the single `equivalence` nor
  // the `equivalences` table into it, so `\|` never reached the app despite
  // being present on `analyzeSmallSignalV2`'s own return value.
  const circuit = new Circuit();
  circuit.addComponent('input', { refdes: 'IN', x: -240, y: 0 });
  circuit.addComponent('output', { refdes: 'OUT', x: 240, y: 0 });
  circuit.addComponent('nmos', { refdes: 'M1', x: 0, y: 0 });
  circuit.addComponent('resistor', { refdes: 'RD', x: 0, y: -160 });
  circuit.addComponent('ground', { refdes: 'GND', x: 160, y: 160 });
  circuit.connect('IN.p', 'M1.g');
  circuit.connect('M1.d', 'RD.a', 'OUT.p');
  circuit.connect('M1.s', 'RD.b', 'GND.gnd');

  const v2 = analyzeSmallSignalV2(circuit, { input: 'IN.p', output: 'OUT.p' });
  assert.equal(v2.ok, true, v2.error);
  const legacy = adaptCombinedReport(v2);
  assert.equal(legacy.dcOutputImpedance.equation, 'Z_{out}(0) = r_{o1} \\parallel R_{D}');
  const outputEntry = legacy.equationEntries.find(({ title }) => title === 'DC output impedance');
  assert.equal(outputEntry.result.equation, 'Z_{out}(0) = r_{o1} \\parallel R_{D}');
});

test('does not mutate the v2 report while producing the legacy shape', () => {
  const input = fixture();
  const before = JSON.stringify(input, (_, value) => typeof value === 'bigint' ? `${value}n` : value);
  adaptCombinedReport(input);
  const after = JSON.stringify(input, (_, value) => typeof value === 'bigint' ? `${value}n` : value);
  assert.equal(after, before);
});
