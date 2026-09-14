import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { analyzeSmallSignalV2 } from '../src/core/analysis/engine.js';
import { formatExpression } from '../src/core/analysis/rational.js';

function net(circuit, name, ...refs) {
  const physicalNet = circuit._createNet(name);
  physicalNet.terminals = refs.map((ref) => circuit.resolveTerm(ref));
  return physicalNet;
}

function ports(circuit) {
  circuit.addComponent('input', { refdes: 'IN', x: -240, y: 0 });
  circuit.addComponent('output', { refdes: 'OUT', x: 240, y: 0 });
  return { input: 'VIN', output: 'VOUT' };
}

function divider() {
  const circuit = new Circuit();
  ports(circuit);
  circuit.addComponent('resistor', { refdes: 'R1', x: 0, y: 0 });
  circuit.addComponent('resistor', { refdes: 'R2', x: 240, y: 160 });
  circuit.addComponent('ground', { refdes: 'GND', x: 320, y: 160 });
  net(circuit, 'VIN', 'IN.p', 'R1.a');
  net(circuit, 'VOUT', 'R1.b', 'R2.a', 'OUT.p');
  net(circuit, 'VSS', 'R2.b', 'GND.gnd');
  return circuit;
}

function rcTransfer() {
  const circuit = new Circuit();
  ports(circuit);
  circuit.addComponent('resistor', { refdes: 'R1', x: 0, y: 0 });
  circuit.addComponent('resistor', { refdes: 'R2', x: 240, y: 160 });
  circuit.addComponent('capacitor', { refdes: 'C1', x: 480, y: 160 });
  circuit.addComponent('ground', { refdes: 'GND', x: 640, y: 240 });
  net(circuit, 'VIN', 'IN.p', 'R1.a');
  net(circuit, 'VOUT', 'R1.b', 'R2.a', 'C1.a', 'OUT.p');
  net(circuit, 'VSS', 'R2.b', 'C1.b', 'GND.gnd');
  return circuit;
}

function commonSource() {
  const circuit = new Circuit();
  ports(circuit);
  circuit.addComponent('nmos', { refdes: 'M1', x: 0, y: 0 });
  circuit.addComponent('resistor', { refdes: 'RD', x: 0, y: -160 });
  circuit.addComponent('ground', { refdes: 'GND', x: 160, y: 160 });
  net(circuit, 'VIN', 'IN.p', 'M1.g');
  net(circuit, 'VOUT', 'M1.d', 'RD.a', 'OUT.p');
  net(circuit, 'VSS', 'M1.s', 'RD.b', 'GND.gnd');
  return circuit;
}

function inverter() {
  const circuit = new Circuit();
  ports(circuit);
  circuit.addComponent('nmos', { refdes: 'M1', x: 0, y: 160 });
  circuit.addComponent('pmos', { refdes: 'M2', x: 0, y: -160, mirrorY: false });
  circuit.addComponent('ground', { refdes: 'GND', x: -160, y: 320 });
  circuit.addComponent('supply', { refdes: 'VDD', x: 160, y: -320 });
  net(circuit, 'VIN', 'IN.p', 'M1.g', 'M2.g');
  net(circuit, 'VOUT', 'M1.d', 'M2.d', 'OUT.p');
  net(circuit, 'VSS', 'M1.s', 'GND.gnd');
  net(circuit, 'VDD', 'M2.s', 'VDD.p');
  return circuit;
}

function sourceFollower() {
  const circuit = new Circuit();
  ports(circuit);
  circuit.addComponent('nmos', { refdes: 'M1', x: 0, y: 0 });
  circuit.addComponent('resistor', { refdes: 'RS', x: 240, y: 160 });
  circuit.addComponent('ground', { refdes: 'GND', x: 320, y: 240 });
  circuit.addComponent('supply', { refdes: 'VDD', x: -160, y: -240 });
  net(circuit, 'VIN', 'IN.p', 'M1.g');
  net(circuit, 'VOUT', 'M1.s', 'RS.a', 'OUT.p');
  net(circuit, 'VSS', 'RS.b', 'GND.gnd');
  net(circuit, 'VDD', 'M1.d', 'VDD.p');
  return circuit;
}

function expressionText(response) {
  return `${formatExpression(response.numerator)} / ${formatExpression(response.denominator)}`;
}

test('combines exact, textbook, DC, and presentation results for a resistor divider', () => {
  const report = analyzeSmallSignalV2(divider());
  assert.equal(report.ok, true, report.error);
  assert.equal(formatExpression(report.exact.Av.numerator), 'R2');
  assert.equal(formatExpression(report.exact.Av.denominator), 'R1 + R2');
  assert.equal(report.transfer.ac, null);
  assert.equal(report.transfer.dc.kind, 'finite');
  assert.match(report.transfer.dc.equation, /\\frac\{R_\{2\}\}\{R_\{1\} \+ R_\{2\}\}/);
  assert.equal(report.input.exact.hasFrequency, false);
  assert.ok(report.netlist.text.includes('R_R1'));
  assert.deepEqual(report.assumptions, []);
});

test('retains AC transfer and canonical pole data for an RC network', () => {
  const report = analyzeSmallSignalV2(rcTransfer());
  assert.equal(report.ok, true, report.error);
  assert.equal(report.transfer.response.hasFrequency, true);
  assert.equal(formatExpression(report.transfer.response.numerator), 'R2');
  assert.equal(formatExpression(report.transfer.response.denominator), 'C1*R1*R2*s + R1 + R2');
  assert.doesNotMatch(formatExpression(report.transfer.response.denominator), /R1\^2|R2\^2/);
  assert.equal(report.transfer.response.denominatorDegree, 1);
  assert.ok(formatExpression(report.transfer.response.denominator).includes('C1'));
  assert.equal(report.poles.length, 1);
  assert.equal(report.poles[0].index, 0);
  assert.ok(report.transfer.ac.equation.startsWith('A_v(s) = '));
  assert.strictEqual(report.details.solution, report.details.pipeline.solution);
});

test('derives common-source gain from the shared exact model', () => {
  const report = analyzeSmallSignalV2(commonSource());
  assert.equal(report.ok, true, report.error);
  assert.match(expressionText(report.exact.Av), /gm1/);
  assert.match(expressionText(report.exact.Av), /go1/);
  assert.match(report.netlist.text, /G_M1 .* V_\{IN\}/);
});

test('keeps NMOS and PMOS transconductances parallel in an inverter', () => {
  const report = analyzeSmallSignalV2(inverter());
  assert.equal(report.ok, true, report.error);
  assert.match(expressionText(report.exact.Av), /gm1.*gm2|gm2.*gm1/);
  assert.match(report.netlist.text, /G_M1/);
  assert.match(report.netlist.text, /G_M2/);
});

test('body-effect selection changes only the post-solve copy', () => {
  const withBody = analyzeSmallSignalV2(sourceFollower(), {
    ignoreBodyEffect: false,
    devices: { M1: { highIntrinsicGain: true } },
  });
  const withoutBody = analyzeSmallSignalV2(sourceFollower(), { ignoreBodyEffect: true });
  assert.equal(withBody.ok, true, withBody.error);
  assert.equal(withoutBody.ok, true, withoutBody.error);
  assert.match(expressionText(withBody.exact.Av), /gmb1/);
  assert.match(expressionText(withBody.transfer.response), /gmb1/);
  assert.doesNotMatch(expressionText(withoutBody.transfer.response), /gmb1/);
  assert.match(expressionText(withBody.exact.Av), /gmb1/);
});

test('r_o infinity takes precedence over high intrinsic gain', () => {
  const report = analyzeSmallSignalV2(commonSource(), {
    ignoreChannelLengthModulation: true,
    gmroLarge: true,
  });
  assert.equal(report.ok, true, report.error);
  assert.doesNotMatch(expressionText(report.transfer.response), /go1/);
  assert.ok(report.assumptions.some((value) => value.startsWith('r_o -> infinity')));
  assert.doesNotMatch(report.assumptions.join('\n'), /g_m r_o/);
});

test('prunes disconnected reactive islands without adding AC rows', () => {
  const circuit = divider();
  circuit.addComponent('capacitor', { refdes: 'CISO', x: 800, y: 400 });
  net(circuit, 'ISO1', 'CISO.a');
  net(circuit, 'ISO2', 'CISO.b');
  const report = analyzeSmallSignalV2(circuit);
  assert.equal(report.ok, true, report.error);
  assert.equal(report.transfer.ac, null);
  assert.equal(report.details.pipeline.system.unknowns.some((name) => /ISO/.test(name)), false);
});

test('returns structured singular diagnostics for a floating output', () => {
  const circuit = new Circuit();
  ports(circuit);
  net(circuit, 'VIN', 'IN.p');
  net(circuit, 'VOUT', 'OUT.p');
  const report = analyzeSmallSignalV2(circuit);
  assert.equal(report.ok, false);
  assert.equal(report.stage, 'solve');
  assert.deepEqual(report.diagnostics.errors.map(({ code }) => code), ['singular-system']);
  assert.match(report.log, /singular-system/);
  assert.equal(report.details.solution.code, 'inconsistent');
});

test('returns one top-level diagnostic when the finite analysis budget is exhausted', () => {
  const report = analyzeSmallSignalV2(divider(), { maxOperations: 0 });

  assert.equal(report.ok, false);
  assert.equal(report.stage, 'budget');
  assert.deepEqual(report.diagnostics.errors.map(({ code }) => code), ['operation-budget']);
  assert.equal(report.details.code, 'operation-budget');
  assert.equal(report.details.budget.limit, 0);
});
