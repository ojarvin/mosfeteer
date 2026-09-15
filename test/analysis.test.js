import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import {
  analyzeInputImpedance,
  analyzeOutputImpedance,
  analyzeSmallSignal,
  analyzeTransferFunction,
  expressionHasFrequency,
} from '../src/core/analysis/index.js';

function net(circuit, name, ...refs) {
  const result = circuit._createNet(name);
  result.terminals = refs.map((ref) => circuit.resolveTerm(ref));
  return result;
}

function divider({ capacitor = false } = {}) {
  const circuit = new Circuit();
  circuit.addComponent('input', { refdes: 'IN', x: -240, y: 0 });
  circuit.addComponent('output', { refdes: 'OUT', x: 240, y: 0 });
  circuit.addComponent('resistor', { refdes: 'R1', x: 0, y: 0 });
  circuit.addComponent('resistor', { refdes: 'R2', x: 240, y: 160 });
  circuit.addComponent('ground', { refdes: 'GND', x: 400, y: 240 });
  if (capacitor) circuit.addComponent('capacitor', { refdes: 'C1', x: 480, y: 160 });
  net(circuit, 'VIN', 'IN.p', 'R1.a');
  net(circuit, 'VOUT', 'R1.b', 'R2.a', 'OUT.p', ...(capacitor ? ['C1.a'] : []));
  net(circuit, 'VSS', 'R2.b', 'GND.gnd', ...(capacitor ? ['C1.b'] : []));
  return circuit;
}

function commonSource() {
  const circuit = new Circuit();
  circuit.addComponent('input', { refdes: 'IN', x: -240, y: 0 });
  circuit.addComponent('output', { refdes: 'OUT', x: 240, y: 0 });
  circuit.addComponent('nmos', { refdes: 'M1', x: 0, y: 0 });
  circuit.addComponent('resistor', { refdes: 'RD', x: 0, y: -160 });
  circuit.addComponent('ground', { refdes: 'GND', x: 160, y: 160 });
  net(circuit, 'VIN', 'IN.p', 'M1.g');
  net(circuit, 'VOUT', 'M1.d', 'RD.a', 'OUT.p');
  net(circuit, 'VSS', 'M1.s', 'RD.b', 'GND.gnd');
  return circuit;
}

function sourceFollower() {
  const circuit = new Circuit();
  circuit.addComponent('input', { refdes: 'IN', x: -240, y: 0 });
  circuit.addComponent('output', { refdes: 'OUT', x: 240, y: 0 });
  circuit.addComponent('nmos', { refdes: 'M1', x: 0, y: 0 });
  circuit.addComponent('resistor', { refdes: 'RS', x: 240, y: 160 });
  circuit.addComponent('ground', { refdes: 'GND', x: 400, y: 240 });
  circuit.addComponent('supply', { refdes: 'VDD', x: 0, y: -160 });
  net(circuit, 'VIN', 'IN.p', 'M1.g');
  net(circuit, 'VOUT', 'M1.s', 'RS.a', 'OUT.p');
  net(circuit, 'VSS', 'RS.b', 'GND.gnd');
  net(circuit, 'VDD', 'M1.d', 'VDD.p');
  return circuit;
}

test('public analysis performs one combined solve for all three quantities', () => {
  const report = analyzeSmallSignal(divider(), { input: 'VIN', output: 'VOUT' });

  assert.equal(report.ok, true, report.error);
  assert.equal(report.complete, true);
  assert.deepEqual(report.equationOrder, [
    'DC input impedance',
    'DC output impedance',
    'DC gain',
  ]);
  assert.strictEqual(report.reports.input.solution, report.details.solution);
  assert.strictEqual(report.reports.output.solution, report.details.solution);
  assert.strictEqual(report.reports.transfer.solution, report.details.solution);
  assert.strictEqual(report.details.solution, report.details.pipeline.solution);
});

test('reactive analysis exposes AC, DC, poles, and zero-based indexing', () => {
  const report = analyzeSmallSignal(divider({ capacitor: true }), {
    input: 'VIN',
    output: 'VOUT',
  });

  assert.equal(report.ok, true, report.error);
  assert.ok(report.reports.input.frequencyResponse?.hasFrequency);
  assert.ok(report.reports.output.frequencyResponse?.hasFrequency);
  assert.ok(report.reports.transfer.acTransfer);
  assert.equal(report.dcGain.ok, true);
  assert.equal(report.dcInputImpedance.ok, true);
  assert.equal(report.dcOutputImpedance.ok, true);
  assert.equal(report.frequencyResponse.poles[0].index, 0);
  assert.deepEqual(report.equationOrder, [
    'AC input impedance',
    'DC input impedance',
    'AC output impedance',
    'DC output impedance',
    'AC gain',
    'DC gain',
    'Poles',
  ]);
});

test('canonical approximation options reach the v2 engine', () => {
  const exact = analyzeSmallSignal(commonSource(), {
    input: 'VIN',
    output: 'VOUT',
    neglectBodyEffect: false,
    highIntrinsicGain: false,
  });
  const textbook = analyzeSmallSignal(commonSource(), {
    input: 'VIN',
    output: 'VOUT',
    neglectBodyEffect: true,
    highIntrinsicGain: true,
    neglectChannelLengthModulation: true,
  });
  const withBody = analyzeSmallSignal(sourceFollower(), {
    input: 'VIN', output: 'VOUT', neglectBodyEffect: false, highIntrinsicGain: false,
  });
  const withoutBody = analyzeSmallSignal(sourceFollower(), {
    input: 'VIN', output: 'VOUT', neglectBodyEffect: true, highIntrinsicGain: false,
  });

  assert.equal(exact.ok, true, exact.error);
  assert.match(exact.reports.transfer.exactEquation, /r_\{o1\}/);
  assert.equal(textbook.ok, true, textbook.error);
  assert.doesNotMatch(textbook.reports.transfer.equation, /g_\{mb1\}|r_\{o1\}/);
  assert.match(textbook.assumptions.join('\n'), /r_o -> infinity/);
  assert.match(withBody.reports.transfer.equation, /g_\{mb1\}/);
  assert.doesNotMatch(withoutBody.reports.transfer.equation, /g_\{mb1\}/);
});

test('structured triode regions replace MOS controlled sources', () => {
  const report = analyzeSmallSignal(commonSource(), {
    input: 'VIN',
    output: 'VOUT',
    deviceRegions: { M1: { region: 'triode' } },
  });

  assert.equal(report.ok, true, report.error);
  assert.match(report.smallSignalNetlist, /RDS_M1/);
  assert.doesNotMatch(report.smallSignalNetlist, /G_M1/);
});

test('removed legacy controls cannot alter the combined analysis', () => {
  const circuit = divider({ capacitor: true });
  const options = { input: 'VIN', output: 'VOUT' };
  const baseline = analyzeSmallSignal(circuit, options);
  const legacy = analyzeSmallSignal(circuit, {
    ...options,
    dcOnly: true,
    millerApproximation: true,
    cascodeApproximation: true,
    context: 'old hint',
    models: ['R1=current-source'],
  });

  assert.equal(legacy.reports.transfer.equation, baseline.reports.transfer.equation);
  assert.ok(legacy.reports.transfer.acTransfer);
});

test('single-quantity wrappers select rows from the combined report', () => {
  const circuit = divider({ capacitor: true });
  const options = { input: 'VIN', output: 'VOUT' };
  const combined = analyzeSmallSignal(circuit, options);
  const input = analyzeInputImpedance(circuit, 'VIN', { output: 'VOUT' });
  const output = analyzeOutputImpedance(circuit, 'VOUT', { input: 'VIN' });
  const transfer = analyzeTransferFunction(circuit, 'VOUT', { input: 'VIN' });

  assert.equal(input.equation, combined.reports.input.equation);
  assert.equal(output.equation, combined.reports.output.equation);
  assert.equal(transfer.equation, combined.reports.transfer.equation);
  assert.equal(transfer.dcGain.equation, combined.dcGain.equation);
  assert.equal(transfer.frequencyResponse.poles[0].index, 0);
});

test('missing or ambiguous ports return structured failures', () => {
  const circuit = divider();
  net(circuit, 'VIN', 'R2.b');
  const report = analyzeSmallSignal(circuit, { input: 'VIN', output: 'VOUT' });

  assert.equal(report.ok, false);
  assert.match(report.error, /multiple physical nets/);
  assert.equal(report.reports.input.ok, false);
  assert.equal(report.reports.output.ok, false);
  assert.equal(report.reports.transfer.ok, false);
});

test('frequency detection understands canonical rational expressions', () => {
  const report = analyzeSmallSignal(divider({ capacitor: true }), {
    input: 'VIN',
    output: 'VOUT',
  });

  assert.equal(expressionHasFrequency(report.reports.transfer.expression), true);
  assert.equal(expressionHasFrequency(report.dcGain.expression), false);
  assert.equal(expressionHasFrequency('gain'), false);
});
