import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { buildExactAnalysisPipeline } from '../src/core/analysis/pipeline.js';

function net(circuit, name, ...refs) {
  const result = circuit._createNet(name);
  result.terminals = refs.map((ref) => circuit.resolveTerm(ref));
  return result;
}

function ports(circuit) {
  circuit.addComponent('input', { refdes: 'IN', x: 0, y: 0 });
  circuit.addComponent('output', { refdes: 'OUT', x: 800, y: 0 });
  circuit.addComponent('ground', { refdes: 'GND1', x: 400, y: 400 });
  return {
    input: 'VIN', output: 'VOUT', ground: 'VSS',
  };
}

function attachPorts(circuit) {
  net(circuit, 'VIN', 'IN.p');
  net(circuit, 'VOUT', 'OUT.p');
  net(circuit, 'VSS', 'GND1.gnd');
}

function analyze(circuit, values = {}, extra = {}) {
  return buildExactAnalysisPipeline(circuit, {
    input: 'VIN', output: 'VOUT', values, s: extra.s ?? 1, ...extra,
  });
}

function divider() {
  const circuit = new Circuit();
  ports(circuit);
  circuit.addComponent('resistor', { refdes: 'R1', x: 200, y: 0 });
  circuit.addComponent('resistor', { refdes: 'R2', x: 600, y: 0 });
  net(circuit, 'VIN', 'IN.p', 'R1.a');
  net(circuit, 'VOUT', 'R1.b', 'R2.a', 'OUT.p');
  net(circuit, 'VSS', 'R2.b', 'GND1.gnd');
  return circuit;
}

test('runs one MNA system for a resistor divider and exposes raw port queries', () => {
  const report = analyze(divider(), { R1: 1000, R2: 1000 });
  assert.equal(report.ok, true, report.error);
  assert.equal(report.queries.transfer.value, 0.5);
  assert.equal(report.queries.inputImpedance.value, 2000);
  assert.ok(Math.abs(report.queries.outputImpedance.value - 500) < 1e-10);
  assert.deepEqual(report.solution.variables, report.system.unknowns);
  assert.equal(report.excitations.rhsCount, 2);
});

test('evaluates an RC transfer at the supplied s value', () => {
  const circuit = new Circuit();
  ports(circuit);
  circuit.addComponent('resistor', { refdes: 'R1', x: 200, y: 0 });
  circuit.addComponent('capacitor', { refdes: 'C1', x: 600, y: 200, mirrorX: false });
  net(circuit, 'VIN', 'IN.p', 'R1.a');
  net(circuit, 'VOUT', 'R1.b', 'C1.a', 'OUT.p');
  net(circuit, 'VSS', 'C1.b', 'GND1.gnd');
  const report = analyze(circuit, { R1: 1000, C1: 1e-6 }, { s: 1000 });
  assert.equal(report.ok, true, report.error);
  assert.ok(Math.abs(report.queries.transfer.value - (1 / 2)) < 1e-12);
  assert.equal(report.primitives.find(({ id }) => id === 'C1.capacitor').admittance, 0.001);
});

function commonSource() {
  const circuit = new Circuit();
  ports(circuit);
  circuit.addComponent('nmos', { refdes: 'M1', x: 400, y: 0 });
  circuit.addComponent('resistor', { refdes: 'RD', x: 400, y: -240 });
  net(circuit, 'VIN', 'IN.p', 'M1.g');
  net(circuit, 'VOUT', 'M1.d', 'RD.a', 'OUT.p');
  net(circuit, 'VSS', 'M1.s', 'RD.b', 'GND1.gnd');
  return circuit;
}

test('gets the common-source transconductance sign from the exact VCCS stamp', () => {
  const report = analyze(commonSource(), { gm1: 0.01, gmb1: 0, ro1: 1e9, RD: 1000 });
  assert.equal(report.ok, true, report.error);
  assert.ok(Math.abs(report.queries.transfer.value - -10) < 1e-4, String(report.queries.transfer.value));
});

test('carries a structured triode region through the full pipeline', () => {
  const circuit = commonSource();
  const report = analyze(circuit, { rds1: 1000, RD: 1000 }, {
    deviceRegions: { M1: { region: 'triode' } },
  });
  assert.equal(report.ok, true, report.error);
  assert.deepEqual(report.exactPrimitives.filter(({ id }) => id.startsWith('M1.')).map(({ id }) => id), ['M1.rds']);
  assert.equal(report.selectedMna.some(({ id }) => id === 'M1.gm'), false);
  assert.equal(report.context.deviceRegions.get('M1').region, 'triode');
  assert.equal(report.queries.transfer.value, 0);
  assert.equal(report.queries.outputImpedance.value, 500);
});

function inverter() {
  const circuit = new Circuit();
  ports(circuit);
  circuit.addComponent('nmos', { refdes: 'M1', x: 400, y: 160 });
  circuit.addComponent('pmos', { refdes: 'M2', x: 400, y: -160, mirrorY: false });
  net(circuit, 'VIN', 'IN.p', 'M1.g', 'M2.g');
  net(circuit, 'VOUT', 'M1.d', 'M2.d', 'OUT.p');
  net(circuit, 'VSS', 'M1.s', 'GND1.gnd');
  net(circuit, 'VDD', 'M2.s');
  return circuit;
}

test('gets parallel NMOS and PMOS gm signs in a CMOS inverter', () => {
  const report = analyze(inverter(), { gm1: 1, gm2: 2, gmb1: 0, gmb2: 0, ro1: 100, ro2: 100 });
  assert.equal(report.ok, true, report.error);
  assert.equal(report.queries.transfer.value, -150);
});

test('uses an output current test source with the input voltage source zeroed', () => {
  const report = analyze(divider(), { R1: 1000, R2: 1000 });
  assert.equal(report.ok, true, report.error);
  const outputColumn = report.solution.columns[1];
  const inputVoltageIndex = report.solution.variables.indexOf('V(N1)');
  assert.ok(Math.abs(outputColumn[inputVoltageIndex]) < 1e-10);
  assert.equal(report.queries.outputImpedance.current, 1);
});

test('prunes a disconnected passive island before MNA stamping', () => {
  const circuit = divider();
  circuit.addComponent('resistor', { refdes: 'RISO', x: 1000, y: 400 });
  circuit.addComponent('capacitor', { refdes: 'CISO', x: 1200, y: 400 });
  net(circuit, 'ISO1', 'RISO.a');
  net(circuit, 'ISO2', 'RISO.b', 'CISO.a');
  net(circuit, 'ISO3', 'CISO.b');
  const report = analyze(circuit, { R1: 1000, R2: 1000, RISO: 10, CISO: 1 }, { s: 10 });
  assert.equal(report.ok, true, report.error);
  assert.deepEqual(report.coupled.primitiveIndices, [0, 1]);
  assert.equal(report.system.unknowns.some((name) => /ISO/.test(name)), false);
});

test('returns singular diagnostics for an un-driven output node', () => {
  const circuit = new Circuit();
  ports(circuit);
  attachPorts(circuit);
  const report = analyze(circuit);
  assert.equal(report.ok, false);
  assert.equal(report.stage, 'solve');
  assert.ok(['singular', 'inconsistent'].includes(report.solution.code));
  assert.match(report.error, /(?:singular|inconsistent) system/);
});
