import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { componentToPrimitives, convertCircuitToPrimitives } from '../src/core/analysis/devices.js';

function attach(circuit, name, ...refs) {
  const net = circuit._createNet(name);
  net.terminals = refs.map((ref) => circuit.resolveTerm(ref));
  return net;
}

function contextFor(circuit, referenceNodes = { VSS: '0', VDD: '0' }) {
  const terminalNodes = new Map();
  for (const net of circuit.nets.values()) {
    for (const terminal of net.terminals) terminalNodes.set(`${terminal.comp}.${terminal.term}`, net.id);
  }
  return { terminalNodes, referenceNodes };
}

function find(primitives, id) {
  return primitives.find((primitive) => primitive.id === id);
}

test('converts passive RLC components to stable primitive descriptors', () => {
  const circuit = new Circuit();
  const resistor = circuit.addComponent('resistor', { refdes: 'R1', x: 0, y: 0 });
  const capacitor = circuit.addComponent('capacitor', { refdes: 'C1', x: 0, y: 160 });
  const inductor = circuit.addComponent('inductor', { refdes: 'L1', x: 0, y: 320 });
  attach(circuit, 'NR1', 'R1.a');
  attach(circuit, 'NR2', 'R1.b');
  attach(circuit, 'NC1', 'C1.a');
  attach(circuit, 'NC2', 'C1.b');
  attach(circuit, 'NL1', 'L1.a');
  attach(circuit, 'NL2', 'L1.b');

  const result = convertCircuitToPrimitives(circuit, contextFor(circuit));
  assert.equal(result.ok, true);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(find(result.primitives, 'R1.resistor'), {
    kind: 'resistor', id: 'R1.resistor',
    terminals: { a: 'N1', b: 'N2' }, value: 'R1',
    metadata: { component: 'R1' },
  });
  for (const primitive of result.primitives) {
    assert.ok(primitive.kind && primitive.id && primitive.terminals && primitive.value !== undefined);
    assert.equal('nodes' in primitive, false);
    assert.equal('output' in primitive, false);
    assert.equal('a' in primitive, false);
    assert.equal('b' in primitive, false);
  }
  assert.equal(find(result.primitives, 'C1.capacitor').value, 'C1');
  assert.equal(find(result.primitives, 'L1.inductor').value, 'L1');
  assert.equal(resistor.type, 'resistor');
  assert.equal(capacitor.type, 'capacitor');
  assert.equal(inductor.type, 'inductor');
});

test('a resistor marked "treat as R = infinity" (model.js setComponentAnalysis) drops its branch entirely', () => {
  const circuit = new Circuit();
  circuit.addComponent('resistor', { refdes: 'R1', x: 0, y: 0 });
  attach(circuit, 'NR1', 'R1.a');
  attach(circuit, 'NR2', 'R1.b');
  circuit.setComponentAnalysis('R1', { resistance: 'infinite' });

  const result = convertCircuitToPrimitives(circuit, contextFor(circuit));
  assert.equal(result.ok, true);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(find(result.primitives, 'R1.resistor'), undefined);
});

test('converts DC sources with zero small-signal excitation', () => {
  const circuit = new Circuit();
  circuit.addComponent('voltage_source', { refdes: 'V1', x: 0, y: 0, value: 'VDD' });
  circuit.addComponent('current_source', { refdes: 'I1', x: 0, y: 200, value: 'ITAIL' });
  attach(circuit, 'VPLUS', 'V1.a');
  attach(circuit, 'VMINUS', 'V1.b');
  attach(circuit, 'IPLUS', 'I1.a');
  attach(circuit, 'IMINUS', 'I1.b');

  const result = convertCircuitToPrimitives(circuit, contextFor(circuit));
  assert.equal(result.ok, true);
  assert.equal(find(result.primitives, 'V1.voltage-source').value, 0);
  assert.equal(find(result.primitives, 'I1.current-source').value, 0);
  assert.equal(find(result.primitives, 'V1.voltage-source').metadata.dcValue, 'VDD');
});

function inverterCircuit() {
  const circuit = new Circuit();
  const nmos = circuit.addComponent('nmos', { refdes: 'M1', x: 0, y: 0 });
  const pmos = circuit.addComponent('pmos', { refdes: 'M2', x: 240, y: 0, mirrorY: false });
  attach(circuit, 'VOUT', 'M1.d', 'M2.d');
  attach(circuit, 'VSS', 'M1.s');
  attach(circuit, 'VDD', 'M2.s');
  attach(circuit, 'VIN', 'M1.g', 'M2.g');
  return { circuit, nmos, pmos };
}

test('NMOS and PMOS use one drain-to-source gm convention, giving parallel inverter gm currents', () => {
  const { circuit } = inverterCircuit();
  const result = convertCircuitToPrimitives(circuit, contextFor(circuit));
  assert.equal(result.ok, true);
  for (const refdes of ['M1', 'M2']) {
    const gm = find(result.primitives, `${refdes}.gm`);
    assert.equal(gm.kind, 'vccs');
    assert.deepEqual(gm.terminals, { a: 'N1', b: refdes === 'M1' ? 'N2' : 'N3' });
    assert.deepEqual(gm.control, { a: 'N4', b: refdes === 'M1' ? 'N2' : 'N3' });
  }
  assert.deepEqual(result.primitives.filter((primitive) => primitive.kind === 'vccs').map((primitive) => primitive.value), [
    'gm1', 'gmb1', 'gm2', 'gmb2',
  ]);
});

test('moving-source MOS retains body effect with implicit VSS/VDD bulk', () => {
  const circuit = new Circuit();
  circuit.addComponent('nmos', { refdes: 'M1', x: 0, y: 0 });
  attach(circuit, 'VOUT', 'M1.d');
  attach(circuit, 'VS', 'M1.s');
  attach(circuit, 'VIN', 'M1.g');
  const result = componentToPrimitives(circuit, circuit.getComponent('M1'), contextFor(circuit));
  const gmb = find(result.primitives, 'M1.gmb');
  assert.equal(gmb.control.a, '0');
  assert.equal(gmb.control.b, 'N2');
  assert.equal(gmb.metadata.controlExpression, 'gmb1(v_b-v_s)');
  assert.equal(find(result.primitives, 'M1.ro').value, 'ro1');
});

test('three-terminal MOS uses implicit VSS/VDD while four-terminal MOS uses its explicit bulk net', () => {
  const circuit = new Circuit();
  circuit.addComponent('nmos', { refdes: 'M1', x: 0, y: 0 });
  circuit.addComponent('pmos', { refdes: 'M2', x: 240, y: 0, mirrorY: false });
  circuit.addComponent('nmosb', { refdes: 'M3', x: 480, y: 0 });
  attach(circuit, 'D1', 'M1.d');
  attach(circuit, 'S1', 'M1.s');
  attach(circuit, 'G1', 'M1.g');
  attach(circuit, 'D2', 'M2.d');
  attach(circuit, 'S2', 'M2.s');
  attach(circuit, 'G2', 'M2.g');
  attach(circuit, 'D3', 'M3.d');
  attach(circuit, 'S3', 'M3.s');
  attach(circuit, 'G3', 'M3.g');
  attach(circuit, 'B3', 'M3.b');
  const context = contextFor(circuit, { VSS: 'VSS', VDD: 'VDD' });
  const result = convertCircuitToPrimitives(circuit, context);
  assert.equal(find(result.primitives, 'M1.gmb').control.a, 'VSS');
  assert.equal(find(result.primitives, 'M2.gmb').control.a, 'VDD');
  assert.equal(find(result.primitives, 'M3.gmb').control.a, 'N10');
});

test('triode override emits rds instead of saturation primitives', () => {
  const circuit = new Circuit();
  const mos = circuit.addComponent('nmos', { refdes: 'M1', x: 0, y: 0 });
  mos.analysis.model = 'triode';
  attach(circuit, 'D', 'M1.d');
  attach(circuit, 'S', 'M1.s');
  attach(circuit, 'G', 'M1.g');
  const result = componentToPrimitives(circuit, mos, contextFor(circuit));
  assert.equal(result.diagnostics.length, 0);
  assert.deepEqual(result.primitives.map((primitive) => primitive.id), ['M1.rds']);
  assert.equal(result.primitives[0].value, 'rds1');
  assert.equal(result.primitives[0].metadata.model, 'triode');
});

test('structured deviceRegions override reaches triode conversion', () => {
  const circuit = new Circuit();
  const mos = circuit.addComponent('nmos', { refdes: 'M1', x: 0, y: 0 });
  attach(circuit, 'D', 'M1.d');
  attach(circuit, 'S', 'M1.s');
  attach(circuit, 'G', 'M1.g');
  const result = convertCircuitToPrimitives(circuit, {
    ...contextFor(circuit),
    deviceRegions: new Map([['M1', { region: 'triode' }]]),
  });
  assert.equal(result.ok, true, result.diagnostics.map(({ message }) => message).join('; '));
  assert.deepEqual(result.primitives.map(({ id }) => id), ['M1.rds']);
  assert.equal(result.primitives[0].metadata.model, 'triode');
  assert.deepEqual(result.primitives[0].metadata.deviceRegion, { region: 'triode' });
  assert.equal(mos.type, 'nmos');
});

test('structured triode flag reaches primitive conversion', () => {
  const circuit = new Circuit();
  const mos = circuit.addComponent('nmos', { refdes: 'M1', x: 0, y: 0 });
  attach(circuit, 'D', 'M1.d');
  attach(circuit, 'S', 'M1.s');
  attach(circuit, 'G', 'M1.g');
  const result = componentToPrimitives(circuit, mos, {
    ...contextFor(circuit),
    deviceRegions: new Map([['M1', { triode: true }]]),
  });
  assert.deepEqual(result.primitives.map(({ id }) => id), ['M1.rds']);
  assert.equal(result.primitives[0].metadata.deviceRegion.triode, true);
});

test('legacy MOS current-source override is rejected with a migration diagnostic', () => {
  const circuit = new Circuit();
  const mos = circuit.addComponent('pmos', { refdes: 'M1', x: 0, y: 0, mirrorY: false });
  attach(circuit, 'D', 'M1.d');
  attach(circuit, 'S', 'M1.s');
  attach(circuit, 'G', 'M1.g');
  const result = componentToPrimitives(circuit, mos, {
    ...contextFor(circuit),
    modelOverrides: new Map([['M1', 'current-source']]),
  });
  assert.deepEqual(result.primitives, []);
  assert.equal(result.diagnostics[0].code, 'legacy-mos-current-source');
  assert.equal(result.diagnostics[0].severity, 'error');
  assert.match(result.diagnostics[0].migration, /Remove the override/);
  assert.equal(convertCircuitToPrimitives(circuit, {
    ...contextFor(circuit),
    modelOverrides: new Map([['M1', 'current-source']]),
  }).ok, false);
});
