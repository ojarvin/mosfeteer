import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { analyzeSmallSignalV2 } from '../src/core/analysis/engine.js';
import { smallSignalSchematic } from '../src/core/analysis/model-schematic.js';
import { buildMNA } from '../src/core/analysis/mna.js';
import { solveMNA } from '../src/core/analysis/solve.js';

function net(circuit, name, ...refs) {
  const result = circuit._createNet(name);
  result.terminals = refs.map((ref) => circuit.resolveTerm(ref));
  return result;
}

function build(parts, nets) {
  const circuit = new Circuit();
  parts.forEach(([type, refdes], i) => circuit.addComponent(type, { refdes, x: i * 400, y: 0 }));
  for (const [name, ...refs] of nets) net(circuit, name, ...refs);
  return circuit;
}

function inverting(model) {
  const circuit = build(
    [['input', 'VIN'], ['output', 'VOUT'], ['resistor', 'R1'], ['resistor', 'R2'], ['opamp', 'U1'], ['ground', 'GND']],
    [['VIN', 'VIN.p', 'R1.a'], ['X', 'R1.b', 'R2.a', 'U1.im'], ['VOUT', 'R2.b', 'U1.o', 'VOUT.p'], ['VSS', 'U1.ip', 'GND.gnd']],
  );
  if (model) circuit.setComponentAnalysis('U1', { model });
  return circuit;
}

function analyze(circuit, output = 'VOUT') {
  const report = analyzeSmallSignalV2(circuit, { input: 'VIN', output });
  assert.equal(report.ok, true, report.error || '');
  return report;
}

test('an ideal opamp holds its inputs equal: the inverting amplifier is -R2/R1', () => {
  const report = analyze(inverting());
  assert.deepEqual(report.transfer.equations, ['A_v(0) = -\\frac{R_{2}}{R_{1}}']);
  assert.deepEqual(report.input.equations, ['Z_{in}(0) = R_{1}']);
});

test('a finite gain A and a single pole omega_t/s, chosen per opamp', () => {
  const finite = analyze(inverting('finite-gain'));
  assert.deepEqual(finite.transfer.equations, ['A_v(0) = -\\frac{A_{1} \\, R_{2}}{R_{1} \\, \\left(1 + A_{1}\\right) + R_{2}}']);
  const pole = analyze(inverting('gbw'));
  assert.equal(pole.transfer.equations[0], 'A_v(s) = -\\frac{\\omega_{t1} \\, R_{2}}{s \\, \\left(R_{1} + R_{2}\\right) + \\omega_{t1} \\, R_{1}}');
  // Ideal at DC: infinite gain below the pole.
  assert.equal(pole.transfer.equations[1], 'A_v(0) = -\\frac{R_{2}}{R_{1}}');
  assert.throws(() => inverting().setComponentAnalysis('R1', { model: 'gbw' }), /only to opamps/);
});

test('opamp-RC integrators make a Tow-Thomas biquad, solved small as virtual grounds', () => {
  const circuit = build(
    [['input', 'VIN'], ['output', 'VOUT'], ['ground', 'GND'],
      ...['R1', 'R2', 'R3', 'R4', 'R5', 'R6'].map((r) => ['resistor', r]), ['capacitor', 'C1'], ['capacitor', 'C2'],
      ['opamp', 'U1'], ['opamp', 'U2'], ['opamp', 'U3']],
    [['VIN', 'VIN.p', 'R1.a'],
      ['X1', 'R1.b', 'C1.a', 'R2.a', 'R3.b', 'U1.im'], ['BP', 'U1.o', 'C1.b', 'R2.b', 'R4.a'],
      ['X2', 'R4.b', 'C2.a', 'U2.im'], ['VOUT', 'U2.o', 'C2.b', 'R5.a', 'VOUT.p'],
      ['X3', 'R5.b', 'R6.a', 'U3.im'], ['LPN', 'U3.o', 'R6.b', 'R3.a'],
      ['VSS', 'U1.ip', 'U2.ip', 'U3.ip', 'GND.gnd']],
  );
  const report = analyze(circuit);
  assert.deepEqual(report.transfer.equations, [
    'A_v(s) = \\frac{R_{2} \\, R_{3} \\, R_{5}}{R_{1} \\, \\left(s^{2} \\, C_{1} \\, C_{2} \\, R_{2} \\, R_{3} \\, R_{4} \\, R_{5} + s \\, C_{2} \\, R_{3} \\, R_{4} \\, R_{5} + R_{2} \\, R_{6}\\right)}',
    'A_v(0) = \\frac{R_{3} \\, R_{5}}{R_{1} \\, R_{6}}',
  ]);
  // The audit netlist lists each opamp as a VCVS; the model drawing as a diamond.
  const lines = report.smallSignalNetlist.split('\n');
  assert.ok(lines.includes('E_U1 BP 0 0 X1 \\infty'), lines.join('\n'));
  const schematic = smallSignalSchematic(report, { circuit });
  assert.equal(schematic.ok, true);
  assert.equal([...schematic.circuit.components.values()].filter((c) => c.type === 'vcvs').length, 3);
});

test('a fully differential opamp holds its outputs\' common mode; a Gm cell is a VCCS', () => {
  const differential = build(
    [['input', 'VIN'], ['output', 'VOUT'], ['resistor', 'R1'], ['resistor', 'R2'], ['resistor', 'R3'], ['resistor', 'R4'], ['opamp_diff', 'U1'], ['ground', 'GND']],
    [['VIN', 'VIN.p', 'R1.a'], ['X1', 'R1.b', 'R3.a', 'U1.im'], ['X2', 'R2.b', 'R4.a', 'U1.ip'],
      ['VOUT', 'U1.op', 'R3.b', 'VOUT.p'], ['OM', 'U1.om', 'R4.b'], ['VSS', 'R2.a', 'GND.gnd']],
  );
  // -R3 (R2 + R4) / (2 R1 R2 + R1 R4 + R2 R3), by hand.
  assert.equal(analyze(differential).transfer.equations[0], 'A_v(0) = -\\frac{R_{3} \\, \\left(2 \\, R_{2} + 2 \\, R_{4}\\right)}{2 \\, R_{1} \\, R_{4} + 2 \\, R_{2} \\, R_{3} + 4 \\, R_{1} \\, R_{2}}');
  const gmC = build(
    [['input', 'VIN'], ['output', 'VOUT'], ['gm', 'G1'], ['capacitor', 'C1'], ['ground', 'GND']],
    [['VIN', 'VIN.p', 'G1.ip'], ['VOUT', 'G1.op', 'C1.a', 'VOUT.p'], ['VSS', 'G1.im', 'G1.om', 'C1.b', 'GND.gnd']],
  );
  assert.deepEqual(analyze(gmC).transfer.equations, ['A_v(s) = \\frac{G_{m1}}{s \\, C_{1}}']);
});

test('MNA folds an ideal opamp as a nullor and reports its input voltage as an alias', () => {
  // A unity buffer: v_out = v_in, the minus input on the output.
  const elements = [
    { kind: 'voltage-source', id: 'V1', terminals: { a: 'in', b: '0' }, value: 1 },
    { kind: 'opamp', id: 'U1', terminals: { a: 'out', b: '0' }, control: { a: 'in', b: 'out' }, value: 0 },
    { kind: 'resistor', id: 'RL', terminals: { a: 'out', b: '0' }, value: 2 },
  ];
  const system = buildMNA(elements);
  assert.equal(system.nullorReduced, true);
  const solution = solveMNA(system);
  assert.equal(solution.byVariable[0].get('V(out)'), 1);
  // Its inputs both on ground leave the output undetermined.
  assert.throws(() => buildMNA([{ kind: 'opamp', id: 'U2', terminals: { a: 'x', b: '0' }, control: { a: '0', b: '0' }, value: 0 }, { kind: 'resistor', id: 'R', terminals: { a: 'x', b: '0' }, value: 1 }]), /undetermined/);
});
