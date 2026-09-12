import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { analyzeInputImpedance, analyzeOutputImpedance, analyzeTransferFunction, deriveSmallSignalModel } from '../src/core/analysis/index.js';
import { commandHelp, runCommand } from '../src/core/commands.js';

function namedNet(circuit, ref, name) {
  const net = circuit.netOfTerminal(ref);
  circuit.renameNet(net, name);
  return net;
}

function singleResistor() {
  const circuit = new Circuit();
  circuit.addComponent('resistor', { refdes: 'R1', x: 0, y: 0 });
  circuit.addComponent('ground', { refdes: 'GND1', x: -80, y: 0 });
  circuit.addComponent('port', { refdes: 'P1', x: 80, y: 0 });
  circuit.connect('R1.a', 'GND1.gnd');
  circuit.connect('R1.b', 'P1.p');
  namedNet(circuit, 'P1.p', 'VOUT');
  return circuit;
}

function commonSource() {
  const circuit = new Circuit();
  circuit.addComponent('nmos', { refdes: 'M1', x: 0, y: 0 });
  circuit.addComponent('resistor', { refdes: 'RD', x: 0, y: -160 });
  circuit.addComponent('ground', { refdes: 'GND1', x: 0, y: 80 });
  circuit.addComponent('supply', { refdes: 'VDD1', x: 80, y: -160 });
  circuit.addComponent('port', { refdes: 'PIN', x: -120, y: 0 });
  circuit.addComponent('port', { refdes: 'POUT', x: 0, y: -80 });
  circuit.connect('RD.a', 'M1.d');
  circuit.connect('RD.b', 'VDD1.p');
  circuit.connect('M1.s', 'GND1.gnd');
  circuit.connect('M1.g', 'PIN.p');
  circuit.connect('M1.d', 'POUT.p');
  namedNet(circuit, 'PIN.p', 'VIN');
  namedNet(circuit, 'POUT.p', 'VOUT');
  return circuit;
}

function sourceDegeneratedCommonSource() {
  const circuit = new Circuit();
  circuit.addComponent('nmos', { refdes: 'M1', x: 0, y: 0 });
  circuit.addComponent('resistor', { refdes: 'RS', x: 160, y: 80 });
  circuit.addComponent('resistor', { refdes: 'RD', x: 0, y: -160 });
  circuit.addComponent('ground', { refdes: 'GND1', x: 240, y: 160 });
  circuit.addComponent('ground', { refdes: 'GND2', x: 80, y: -160 });
  circuit.addComponent('input', { refdes: 'IN', x: -240, y: 0 });
  circuit.addComponent('output', { refdes: 'OUT', x: 0, y: -240 });
  circuit.connect('M1.g', 'IN.p');
  circuit.connect('M1.s', 'RS.a');
  circuit.connect('RS.b', 'GND1.gnd');
  circuit.connect('M1.d', 'RD.a', 'OUT.p');
  circuit.connect('RD.b', 'GND2.gnd');
  namedNet(circuit, 'IN.p', 'VIN');
  namedNet(circuit, 'OUT.p', 'VOUT');
  return circuit;
}

function commonDrain() {
  const circuit = new Circuit();
  circuit.addComponent('nmos', { refdes: 'M1', x: 0, y: 0 });
  circuit.addComponent('supply', { refdes: 'VDD1', x: 0, y: -160 });
  circuit.addComponent('resistor', { refdes: 'RS', x: -80, y: 80 });
  circuit.addComponent('ground', { refdes: 'GND1', x: -160, y: 80 });
  circuit.addComponent('input', { refdes: 'IN', x: -120, y: 0 });
  circuit.addComponent('output', { refdes: 'OUT', x: 120, y: 80 });
  circuit.connect('M1.d', 'VDD1.p');
  circuit.connect('M1.s', 'RS.b', 'OUT.p');
  circuit.connect('RS.a', 'GND1.gnd');
  circuit.connect('M1.g', 'IN.p');
  namedNet(circuit, 'IN.p', 'VIN');
  namedNet(circuit, 'OUT.p', 'VOUT');
  return circuit;
}

function commonGate() {
  const circuit = new Circuit();
  circuit.addComponent('nmos', { refdes: 'M1', x: 0, y: 0 });
  circuit.addComponent('resistor', { refdes: 'RD', x: 0, y: -160 });
  circuit.addComponent('supply', { refdes: 'VDD1', x: 160, y: -160 });
  circuit.addComponent('port', { refdes: 'VIN', x: 120, y: 80 });
  circuit.addComponent('port', { refdes: 'VBIAS', x: -120, y: 0 });
  circuit.addComponent('port', { refdes: 'VOUT', x: 0, y: -80 });
  circuit.connect('M1.s', 'VIN.p');
  circuit.connect('M1.g', 'VBIAS.p');
  circuit.connect('M1.d', 'RD.a', 'VOUT.p');
  circuit.connect('RD.b', 'VDD1.p');
  namedNet(circuit, 'VIN.p', 'VIN');
  namedNet(circuit, 'VBIAS.p', 'VBIAS');
  namedNet(circuit, 'VOUT.p', 'VOUT');
  return circuit;
}

function cascodedCommonSource(depth = 2) {
  const circuit = new Circuit();
  for (let index = 1; index <= depth; index++) {
    circuit.addComponent('nmos', { refdes: `M${index}`, x: 0, y: -(index - 1) * 160 });
  }
  circuit.addComponent('resistor', { refdes: 'RD', x: 80, y: -depth * 160 });
  circuit.addComponent('input', { refdes: 'IN', x: -240, y: 0 });
  circuit.addComponent('ground', { refdes: 'GND1', x: 0, y: 200 });
  circuit.addComponent('ground', { refdes: 'GNDLOAD', x: 160, y: -depth * 160 });
  for (let index = 2; index <= depth; index++) {
    circuit.addComponent('ground', { refdes: `GB${index}`, x: -120, y: -(index - 1) * 160 });
  }
  circuit.connect('M1.g', 'IN.p');
  circuit.connect('M1.s', 'GND1.gnd');
  circuit.connect('RD.b', 'GNDLOAD.gnd');
  for (let index = 2; index <= depth; index++) {
    circuit.connect(`M${index}.g`, `GB${index}.gnd`);
  }
  for (let index = 1; index < depth; index++) {
    circuit.connect(`M${index}.d`, `M${index + 1}.s`);
  }
  circuit.connect(`M${depth}.d`, 'RD.a');
  namedNet(circuit, 'IN.p', 'VIN');
  namedNet(circuit, `M${depth}.d`, 'VOUT');
  namedNet(circuit, 'M1.d', 'VX');
  namedNet(circuit, 'M1.s', 'GND');
  namedNet(circuit, 'M2.g', 'VBIAS');
  return circuit;
}

function cascodeOutput() {
  const circuit = new Circuit();
  circuit.addComponent('nmos', { refdes: 'M1', x: 0, y: 0 });
  circuit.addComponent('nmos', { refdes: 'M2', x: 0, y: -240 });
  circuit.addComponent('ground', { refdes: 'GND1', x: -240, y: 80 });
  circuit.addComponent('port', { refdes: 'VBIAS1', x: -240, y: 0 });
  circuit.addComponent('port', { refdes: 'VBIAS2', x: -240, y: -240 });
  circuit.addComponent('port', { refdes: 'VOUT', x: 0, y: -320 });
  circuit.connect('M1.s', 'GND1.gnd');
  circuit.connect('M1.d', 'M2.s');
  circuit.connect('M1.g', 'VBIAS1.p');
  circuit.connect('M2.g', 'VBIAS2.p');
  circuit.connect('M2.d', 'VOUT.p');
  namedNet(circuit, 'VBIAS1.p', 'VBIAS1');
  namedNet(circuit, 'VBIAS2.p', 'VBIAS2');
  namedNet(circuit, 'VOUT.p', 'VOUT');
  return circuit;
}

function complementaryCascodeOutput() {
  const circuit = new Circuit();
  circuit.addComponent('nmos', { refdes: 'M1', x: 0, y: 160 });
  circuit.addComponent('nmos', { refdes: 'M2', x: 0, y: 0 });
  circuit.addComponent('pmos', { refdes: 'M3', x: 400, y: -160 });
  circuit.addComponent('pmos', { refdes: 'M4', x: 400, y: 0 });
  circuit.addComponent('ground', { refdes: 'GND', x: -240, y: 240 });
  circuit.addComponent('supply', { refdes: 'VDD', x: 640, y: -240 });
  circuit.addComponent('input', { refdes: 'IN', x: -240, y: 160 });
  circuit.addComponent('port', { refdes: 'VBIAS2', x: -240, y: 0 });
  circuit.addComponent('port', { refdes: 'VBIAS3', x: 640, y: -160 });
  circuit.addComponent('port', { refdes: 'VBIAS4', x: 640, y: 0 });
  circuit.addComponent('port', { refdes: 'VOUT', x: 200, y: -80 });
  circuit.connect('M1.s', 'GND.gnd');
  circuit.connect('M1.d', 'M2.s');
  circuit.connect('M2.d', 'VOUT.p');
  circuit.connect('M3.s', 'VDD.p');
  circuit.connect('M3.d', 'M4.s');
  circuit.connect('M4.d', 'VOUT.p');
  circuit.connect('M1.g', 'IN.p');
  circuit.connect('M2.g', 'VBIAS2.p', 'GND.gnd');
  circuit.connect('M4.g', 'VBIAS4.p');
  circuit.connect('M3.g', 'VBIAS3.p');
  namedNet(circuit, 'IN.p', 'VIN');
  namedNet(circuit, 'VOUT.p', 'VOUT');
  return circuit;
}

test('derives a symbolic resistor output impedance without numerical evaluation', () => {
  const circuit = singleResistor();
  const report = analyzeOutputImpedance(circuit, 'VOUT');
  assert.equal(report.ok, true);
  assert.equal(report.equation, 'Z_{out} = R_{1}');
  assert.ok(report.equationCount > report.unknownCount);
  assert.deepEqual(report.dependencies, ['R1']);
  assert.ok(report.approximations.some((text) => /Ideal passive approximation/.test(text)));
  assert.ok(report.assumptions.some((text) => /No numerical values/.test(text)));
});

test('preserves a letter-suffix resistor refdes as one subscript token', () => {
  const circuit = new Circuit();
  circuit.addComponent('resistor', { refdes: 'RD', x: 0, y: 0 });
  circuit.addComponent('ground', { refdes: 'GND1', x: -80, y: 0 });
  circuit.addComponent('port', { refdes: 'P1', x: 80, y: 0 });
  circuit.connect('RD.a', 'GND1.gnd');
  circuit.connect('RD.b', 'P1.p');
  namedNet(circuit, 'P1.p', 'VOUT');
  const report = analyzeOutputImpedance(circuit, 'VOUT');
  assert.equal(report.equation, 'Z_{out} = R_{D}');
  assert.match(report.smallSignalNetlist, /R_RD .* R_\{D\}/);
});

test('reduces parallel and series passive paths symbolically', () => {
  const parallel = new Circuit();
  parallel.addComponent('resistor', { refdes: 'R1', x: 0, y: 0 });
  parallel.addComponent('resistor', { refdes: 'R2', x: 0, y: 160 });
  parallel.addComponent('ground', { refdes: 'GND1', x: -80, y: 0 });
  parallel.addComponent('port', { refdes: 'P1', x: 80, y: 0 });
  parallel.connect('R1.a', 'R2.a', 'GND1.gnd');
  parallel.connect('R1.b', 'R2.b', 'P1.p');
  namedNet(parallel, 'P1.p', 'VOUT');
  const parallelReport = analyzeOutputImpedance(parallel, 'VOUT');
  assert.equal(parallelReport.equation, 'Z_{out} = R_{1} \\|\\| R_{2}');

  const series = new Circuit();
  series.addComponent('resistor', { refdes: 'R1', x: 0, y: 0 });
  series.addComponent('resistor', { refdes: 'R2', x: 400, y: 0 });
  series.addComponent('ground', { refdes: 'GND1', x: 480, y: 0 });
  series.addComponent('port', { refdes: 'P1', x: -80, y: 0 });
  series.connect('R1.a', 'P1.p');
  series.connect('R1.b', 'R2.a');
  series.connect('R2.b', 'GND1.gnd');
  namedNet(series, 'P1.p', 'VOUT');
  const seriesReport = analyzeOutputImpedance(series, 'VOUT');
  assert.equal(seriesReport.equation, 'Z_{out} = R_{1} + R_{2}');
});

test('recognizes an AC-grounded common-source MOS output resistance', () => {
  const circuit = new Circuit();
  circuit.addComponent('nmos', { refdes: 'M1', x: 0, y: 0 });
  circuit.addComponent('ground', { refdes: 'GND1', x: 200, y: 0 });
  circuit.addComponent('port', { refdes: 'P1', x: 0, y: -80 });
  circuit.connect('M1.s', 'M1.g', 'GND1.gnd');
  circuit.connect('M1.d', 'P1.p');
  namedNet(circuit, 'P1.p', 'VOUT');
  const report = analyzeOutputImpedance(circuit, 'VOUT');
  assert.equal(report.ok, true);
  assert.equal(report.equation, 'Z_{out} = r_{o1}');
  assert.match(report.smallSignalNetlist, /G_M1 .* g_\{m1\}/);
  assert.doesNotMatch(report.smallSignalNetlist, /-1.*g_\{m1\}/);
  assert.match(report.smallSignalNetlist, /R_M1 .* r_\{o1\}/);
  assert.ok(report.assumptions.some((text) => /M1 bulk is unused and is assumed tied to GND/.test(text)));
  assert.ok(report.assumptions.some((text) => /g_m and g_\{mb\} effects omitted/.test(text)));
  assert.ok(report.approximations.some((text) => /dependent-source effects are omitted/.test(text)));
});

test('assumes an unused NMOS bulk is tied to GND', () => {
  const circuit = new Circuit();
  circuit.addComponent('nmosb', { refdes: 'M1', x: 0, y: 0 });
  circuit.addComponent('ground', { refdes: 'GND1', x: 200, y: 0 });
  circuit.addComponent('port', { refdes: 'P1', x: 0, y: -80 });
  circuit.connect('M1.s', 'M1.g', 'GND1.gnd');
  circuit.connect('M1.d', 'P1.p');
  namedNet(circuit, 'P1.p', 'VOUT');
  const report = analyzeOutputImpedance(circuit, 'VOUT');
  assert.equal(report.ok, true);
  assert.ok(report.assumptions.some((text) => /bulk is unused and is assumed tied to GND/.test(text)));
});

test('does not mutate the circuit while rejecting ambiguous names', () => {
  const circuit = singleResistor();
  const before = JSON.stringify(circuit.toJSON());
  const command = runCommand(circuit, 'analyze output-impedance VOUT');
  assert.equal(command.mutated, false);
  assert.equal(command.json.ok, true);
  assert.equal(JSON.stringify(circuit.toJSON()), before);

  const ambiguous = new Circuit();
  ambiguous.addComponent('resistor', { refdes: 'R1', x: 0, y: 0 });
  ambiguous.addComponent('ground', { refdes: 'GND1', x: -80, y: 0 });
  ambiguous.connect('R1.a', 'GND1.gnd');
  ambiguous.renameNet(ambiguous.netOfTerminal('R1.a'), 'DUP');
  ambiguous.addComponent('resistor', { refdes: 'R2', x: 400, y: 0 });
  ambiguous.addComponent('ground', { refdes: 'GND2', x: 320, y: 0 });
  ambiguous.connect('R2.a', 'GND2.gnd');
  ambiguous.renameNet(ambiguous.netOfTerminal('R2.a'), 'DUP');
  const report = analyzeOutputImpedance(ambiguous, 'DUP');
  assert.equal(report.ok, false);
  assert.match(report.error, /multiple physical nets/);
});

test('allows an explicit current-source model override to remove a transistor branch', () => {
  const circuit = singleResistor();
  circuit.addComponent('nmos', { refdes: 'M1', x: 0, y: 240 });
  circuit.addComponent('ground', { refdes: 'GND2', x: 200, y: 240 });
  circuit.connect('M1.d', 'R1.b');
  circuit.connect('M1.s', 'M1.g', 'GND2.gnd', 'GND1.gnd');
  const before = analyzeOutputImpedance(circuit, 'VOUT', { reference: 'GND1.gnd' });
  assert.equal(before.equation, 'Z_{out} = R_{1} \\|\\| r_{o1}');
  const report = analyzeOutputImpedance(circuit, 'VOUT', { reference: 'GND1.gnd', models: ['M1=current-source'] });
  assert.equal(report.equation, 'Z_{out} = R_{1}');
  assert.ok(report.assumptions.some((text) => /M1.*ideal small-signal current source/.test(text)));
  assert.ok(report.approximations.some((text) => /infinite small-signal output resistance/.test(text)));
  const command = runCommand(circuit, 'analyze output-impedance VOUT --reference GND1.gnd --model M1=current-source');
  assert.equal(command.mutated, false);
  assert.equal(command.json.equation, 'Z_{out} = R_{1}');
});

test('supports an electrically relevant capacitor in the symbolic model', () => {
  const circuit = singleResistor();
  circuit.addComponent('capacitor', { refdes: 'C1', x: 0, y: 240 });
  circuit.connect('C1.a', 'R1.b');
  circuit.connect('C1.b', 'GND1.gnd');
  const report = analyzeOutputImpedance(circuit, 'VOUT');
  assert.equal(report.ok, true);
  assert.equal(report.equation, 'Z_{out} = R_{1} \\|\\| \\frac{1}{s \\, C_{1}}');
});

test('Miller approximation splits a high-gain MOS gate-drain capacitor', () => {
  const circuit = commonSource();
  circuit.addComponent('capacitor', { refdes: 'CGD', x: -40, y: 0 });
  circuit.connect('CGD.a', 'M1.g');
  circuit.connect('CGD.b', 'M1.d');

  const exact = deriveSmallSignalModel(circuit, 'VOUT', { input: 'VIN', millerApproximation: true });
  const exactCap = exact.model.elements.find((element) => element.component === 'CGD');
  assert.ok(exactCap);
  assert.equal(exactCap.millerRole, undefined);

  const miller = deriveSmallSignalModel(circuit, 'VOUT', {
    input: 'VIN',
    gmroLarge: true,
    millerApproximation: true,
  });
  const caps = miller.model.elements.filter((element) => element.component === 'CGD');
  assert.deepEqual(caps.map((element) => element.millerRole).sort(), ['input', 'output']);
  assert.ok(caps.every((element) => element.b === '@AC_GROUND'));
  assert.match(miller.netlist, /C_CGD_input/);
  assert.match(miller.netlist, /C_CGD_output/);
  assert.match(miller.approximations.join('\n'), /Miller approximation/);

  const transfer = analyzeTransferFunction(circuit, 'VOUT', {
    input: 'VIN',
    gmroLarge: true,
    millerApproximation: true,
  });
  assert.equal(transfer.ok, true);
  assert.match(transfer.equation, /g_\{m1\}/);
});

test('Miller approximation also splits a feedback resistor using the derived DC gain', () => {
  const circuit = commonSource();
  circuit.addComponent('resistor', { refdes: 'RF', x: -40, y: 0 });
  circuit.connect('RF.a', 'M1.g');
  circuit.connect('RF.b', 'M1.d');
  const model = deriveSmallSignalModel(circuit, circuit.netOfTerminal('POUT.p').id, {
    input: circuit.netOfTerminal('PIN.p').id,
    gmroLarge: true,
  });
  const branches = model.model.elements.filter((element) => element.component === 'RF');
  assert.deepEqual(branches.map((element) => element.millerRole).sort(), ['input', 'output']);
  assert.match(model.netlist, /R_RF_input/);
  assert.match(model.netlist, /R_RF_output/);
  assert.match(model.approximations.join('\n'), /derived DC stage gain/);
  assert.match(model.assumptions.join('\n'), /A_\{v1\}\\approx-g_\{m1\}/);
  assert.match(model.assumptions.join('\n'), /Z_\{in\}=.*1 - A_\{v1\}/);
  assert.match(model.assumptions.join('\n'), /Z_\{out\}=.*1 - \\frac\{1\}\{A_\{v1\}\}/);

  const input = analyzeInputImpedance(circuit, 'VIN', {
    gmroLarge: true,
    millerApproximation: true,
  });
  const output = analyzeOutputImpedance(circuit, 'VOUT', {
    input: 'VIN',
    gmroLarge: true,
    millerApproximation: true,
  });
  assert.match(input.equation, /,\\quad A_\{v1\}\\approx-g_\{m1\}/);
  assert.match(output.equation, /,\\quad A_\{v1\}\\approx-g_\{m1\}/);
});

test('treats unnamed ground, supply, and VCM markers as one AC reference group', () => {
  const circuit = singleResistor();
  circuit.addComponent('resistor', { refdes: 'R2', x: 0, y: 240 });
  circuit.addComponent('supply', { refdes: 'SUPPLY1', x: 80, y: 240 });
  circuit.connect('R2.a', 'P1.p');
  circuit.connect('R2.b', 'SUPPLY1.p');
  const report = analyzeOutputImpedance(circuit, 'VOUT');
  assert.equal(report.ok, true);
  assert.equal(report.equation, 'Z_{out} = R_{1} \\|\\| R_{2}');
  assert.equal(report.reference.name, 'AC_GROUND');
  assert.ok(report.assumptions.some((text) => /ground, supply, and VCM/.test(text)));
});

test('accepts named DC bias ports as additional AC-ground references', () => {
  const circuit = singleResistor();
  circuit.addComponent('resistor', { refdes: 'R2', x: 0, y: 240 });
  circuit.addComponent('port', { refdes: 'P2', x: 80, y: 240 });
  circuit.connect('R2.a', 'P1.p');
  circuit.connect('R2.b', 'P2.p');
  namedNet(circuit, 'P2.p', 'VBN');

  const report = analyzeOutputImpedance(circuit, 'VOUT', {
    acGrounds: ['VBN'],
    mode: 'differential',
    differentialSide: 'VBN',
    context: 'Bias port is held quiet for the small-signal test.',
  });
  assert.equal(report.ok, true);
  assert.equal(report.equation, 'Z_{out} = R_{1} \\|\\| R_{2}');
  assert.deepEqual(report.reference.acGrounds, ['VBN']);
  assert.ok(report.assumptions.some((text) => /VBN is treated as AC ground/.test(text)));
  assert.ok(report.assumptions.some((text) => /Differential analysis is reduced to a single-ended equivalent/.test(text)));
  assert.ok(report.assumptions.some((text) => /User context: Bias port/.test(text)));
});

test('can infer the reference from an AC-ground bias port when no marker exists', () => {
  const circuit = new Circuit();
  circuit.addComponent('resistor', { refdes: 'R1', x: 0, y: 0 });
  circuit.addComponent('port', { refdes: 'P1', x: -80, y: 0 });
  circuit.addComponent('port', { refdes: 'P2', x: 80, y: 0 });
  circuit.connect('R1.a', 'P1.p');
  circuit.connect('R1.b', 'P2.p');
  namedNet(circuit, 'P1.p', 'VOUT');
  namedNet(circuit, 'P2.p', 'VCASCN');
  const report = analyzeOutputImpedance(circuit, 'VOUT', { acGrounds: 'VCASCN' });
  assert.equal(report.ok, true);
  assert.equal(report.equation, 'Z_{out} = R_{1}');
  assert.equal(report.reference.name, 'AC_GROUND');
  assert.equal(report.reference.inferred, true);
});

test('derives a voltage transfer from the generic node-equation system', () => {
  const circuit = new Circuit();
  circuit.addComponent('resistor', { refdes: 'R1', x: 0, y: 0 });
  circuit.addComponent('resistor', { refdes: 'R2', x: 240, y: 160 });
  circuit.addComponent('port', { refdes: 'PIN', x: -80, y: 0 });
  circuit.addComponent('port', { refdes: 'POUT', x: 160, y: 0 });
  circuit.addComponent('ground', { refdes: 'GND1', x: 320, y: 160 });
  circuit.connect('R1.a', 'PIN.p');
  circuit.connect('R1.b', 'R2.a', 'POUT.p');
  circuit.connect('R2.b', 'GND1.gnd');
  namedNet(circuit, 'PIN.p', 'VIN');
  namedNet(circuit, 'POUT.p', 'VOUT');
  const report = analyzeTransferFunction(circuit, 'VOUT', { input: 'VIN' });
  assert.equal(report.ok, true);
  assert.match(report.equation, /^A_v = /);
  assert.equal(report.input.name, 'VIN');
  assert.ok(report.equations.some((equation) => equation.includes('V_{in}')));
  assert.ok(report.unknowns.includes('V_{out}'));
  assert.ok(report.equationCount > report.unknownCount);
  const command = runCommand(circuit, 'analyze transfer-function VOUT --input VIN --mode single-ended');
  assert.equal(command.mutated, false);
  assert.equal(command.json.query, 'voltage-transfer');
});

test('common-source gain presents the output loading as parallel resistance', () => {
  const report = analyzeTransferFunction(commonSource(), 'VOUT', { input: 'VIN' });
  assert.equal(report.ok, true);
  assert.equal(report.equation, 'A_v = -g_{m1} \\, \\left(r_{o1} \\|\\| R_{D}\\right)');
});

test('source degeneration is solved by the systematic nodal model', () => {
  const circuit = sourceDegeneratedCommonSource();
  const transfer = analyzeTransferFunction(circuit, 'VOUT', { input: 'VIN' });
  assert.equal(transfer.ok, true);
  assert.doesNotMatch(transfer.error || '', /source degeneration/);
  assert.ok(transfer.equation.includes('r_{o1}'));
  const output = analyzeOutputImpedance(circuit, 'VOUT', { input: 'VIN' });
  assert.equal(output.ok, true);
  assert.doesNotMatch(output.error || '', /source degeneration/);
  assert.ok(output.assumptions.some((text) => /source degeneration.*nodal/.test(text)));
  assert.equal(output.equation, 'Z_{out} = R_{D} \\|\\| \\left(r_{o1} + R_{S} + \\left(\\left(g_{m1} + g_{mb1}\\right) \\, r_{o1} \\, R_{S}\\right)\\right)');
  // The Norton gain reuses the same output-impedance expression.  A
  // reciprocal sum may be rendered as a parallel group, but must not turn
  // into the underlying `1/R_1 + 1/R_2` admittance when it is multiplied into
  // A_v.
  assert.match(output.equation, /\\|\\|/);
  assert.match(transfer.equation, /\\|\\|/);
  assert.doesNotMatch(transfer.equation, /\\frac\{1\}\{r_\{o1\}\} \+ \\frac\{1\}\{R_D\}/);
});

test('includes implicit MOS body effect in a common-drain source follower', () => {
  const report = analyzeTransferFunction(commonDrain(), 'VOUT', { input: 'VIN' });
  assert.equal(report.ok, true);
  assert.match(report.equation, /g_\{mb1\}/);
  assert.match(report.smallSignalNetlist, /G_M1 0 V_\{OUT\} 0 V_\{OUT\} g_\{mb1\}/);
  assert.ok(report.assumptions.some((text) => /M1 bulk is unused and is assumed tied to GND/.test(text)));

  const ignored = analyzeTransferFunction(commonDrain(), 'VOUT', {
    input: 'VIN',
    ignoreBodyEffect: true,
  });
  assert.equal(ignored.ok, true);
  assert.doesNotMatch(ignored.equation, /g_\{mb1\}/);
  assert.ok(ignored.approximations.some((text) => /g_\{mb\} = 0/.test(text)));
});

test('large-gmro approximation collapses a cascoded common-source gain', () => {
  const report = analyzeTransferFunction(cascodedCommonSource(), 'VOUT', {
    input: 'VIN',
    gmroLarge: true,
  });
  assert.equal(report.ok, true);
  assert.equal(report.equation, 'A_v \\approx -g_{m1} \\, R_{D}');
  assert.match(report.exactEquation, /r_\{o2\}/);
  assert.ok(report.approximations.some((text) => /g_m r_o.*1/.test(text)));
});

test('keeps an exact cascoded output load compact and parallel in the gain', () => {
  const circuit = cascodedCommonSource();
  const output = analyzeOutputImpedance(circuit, 'VOUT', { input: 'VIN' });
  assert.equal(output.ok, true);
  assert.equal(output.equation, 'Z_{out} = R_{D} \\|\\| \\left(r_{o1} + r_{o2} + \\left(r_{o1} \\, \\left(g_{m2} + g_{mb2}\\right) \\, r_{o2}\\right)\\right)');
  const gain = analyzeTransferFunction(circuit, 'VOUT', { input: 'VIN' });
  assert.equal(gain.ok, true);
  assert.match(gain.equation, /R_{D} \\|\\|/);
  assert.doesNotMatch(gain.equation, /\\frac\{1\}\{R_{D}\}/);
});

test('per-device gmro and body-effect overrides affect the symbolic model', () => {
  const gainCircuit = commonSource();
  gainCircuit.setComponentAnalysis('M1', { gmroLarge: true });
  const gain = analyzeTransferFunction(gainCircuit, 'VOUT', { input: 'VIN' });
  assert.equal(gain.ok, true);
  assert.equal(gain.equation, 'A_v \\approx -g_{m1} \\, \\left(r_{o1} \\|\\| R_{D}\\right)');
  assert.ok(gain.approximations.some((text) => /Per-device approximation: M1 g_m r_o/.test(text)));

  const selectiveCircuit = cascodedCommonSource();
  selectiveCircuit.setComponentAnalysis('M2', { gmroLarge: true });
  const selective = analyzeOutputImpedance(selectiveCircuit, 'VOUT');
  assert.equal(selective.ok, true);
  assert.ok(selective.approximations.some((text) => /Per-device approximation: M2 g_m r_o/.test(text)));

  const bodyCircuit = commonDrain();
  bodyCircuit.setComponentAnalysis('M1', { ignoreBodyEffect: true });
  const body = analyzeTransferFunction(bodyCircuit, 'VOUT', { input: 'VIN' });
  assert.equal(body.ok, true);
  assert.doesNotMatch(body.equation, /g_\{mb1\}/);
  assert.ok(body.approximations.some((text) => /Per-device approximation: M1 g_\{mb\} = 0/.test(text)));
});

test('large-gmro simplification reaches the load through a deeper cascode stack', () => {
  const report = analyzeTransferFunction(cascodedCommonSource(4), 'VOUT', {
    input: 'VIN',
    gmroLarge: true,
  });
  assert.equal(report.ok, true);
  assert.equal(report.equation, 'A_v \\approx -g_{m1} \\, R_{D}');
  assert.doesNotMatch(report.equation, /\\frac\{1\}\{0\}/);
});

test('per-device r_o policy overrides the form-wide channel-length approximation', () => {
  const circuit = cascodedCommonSource();
  circuit.setComponentAnalysis('M1', { channelLengthModulation: 'ignore' });
  circuit.setComponentAnalysis('M2', { channelLengthModulation: 'finite' });
  const report = analyzeTransferFunction(circuit, 'VOUT', {
    input: 'VIN',
    ignoreChannelLengthModulation: true,
  });
  assert.equal(report.ok, true);
  assert.match(report.equation, /r_\{o2\}/);
  assert.match(report.exactEquation, /r_\{o1\}/);
  assert.ok(report.assumptions.some((text) => /M2.*finite r_o/.test(text)));
});

test('a device-level r_o omission is applied without enabling it globally', () => {
  const circuit = commonSource();
  circuit.setComponentAnalysis('M1', { channelLengthModulation: 'ignore' });
  const report = analyzeTransferFunction(circuit, 'VOUT', { input: 'VIN' });
  assert.equal(report.ok, true);
  assert.equal(report.equation, 'A_v \\approx -g_{m1} \\, R_{D}');
  assert.ok(report.approximations.some((text) => /M1.*r_o.*∞/.test(text)));
});

test('common-gate gain and input impedance use the source-input half-circuit form', () => {
  const circuit = commonGate();
  const options = { input: 'VIN', acGrounds: ['VBIAS'] };
  const gain = analyzeTransferFunction(circuit, 'VOUT', options);
  assert.equal(gain.ok, true);
  assert.equal(gain.equation, 'A_v = \\left(\\frac{1}{r_{o1}} + g_{m1} + g_{mb1}\\right) \\, \\left(r_{o1} \\|\\| R_{D}\\right)');
  const input = analyzeInputImpedance(circuit, 'VIN', options);
  assert.equal(input.ok, true);
  assert.equal(input.equation, 'Z_{in} = \\frac{r_{o1} + R_{D}}{1 + \\left(\\left(g_{m1} + g_{mb1}\\right) \\, r_{o1}\\right)}');
  assert.ok(input.assumptions.some((text) => /common-gate device/.test(text)));
});

test('applies explicit textbook approximations and preserves the exact equation', () => {
  const source = analyzeTransferFunction(commonSource(), 'VOUT', {
    input: 'VIN',
    ignoreChannelLengthModulation: true,
  });
  assert.equal(source.equation, 'A_v \\approx -g_{m1} \\, R_{D}');
  assert.equal(source.exactEquation, 'A_v = -g_{m1} \\, \\left(r_{o1} \\|\\| R_{D}\\right)');
  assert.ok(source.approximations.some((text) => /r_o.*∞/.test(text)));
  const command = runCommand(commonSource(), 'analyze transfer-function VOUT --input VIN --ignore-channel-length-modulation');
  assert.equal(command.json.equation, source.equation);
  assert.match(commandHelp(), /--gmro-large/);

  const commonGateInput = analyzeInputImpedance(commonGate(), 'VIN', {
    acGrounds: ['VBIAS'],
    gmroLarge: true,
    ignoreChannelLengthModulation: true,
  });
  assert.equal(commonGateInput.equation, 'Z_{in} \\approx \\frac{1}{g_{m1} + g_{mb1}}');
  assert.equal(commonGateInput.exactEquation, 'Z_{in} = \\frac{r_{o1} + R_{D}}{1 + \\left(\\left(g_{m1} + g_{mb1}\\right) \\, r_{o1}\\right)}');
  assert.ok(commonGateInput.approximations.some((text) => /g_m r_o.*1/.test(text)));
});

test('shortens a cascode output resistance when g_m r_o is assumed large', () => {
  const exact = analyzeOutputImpedance(cascodeOutput(), 'VOUT', { acGrounds: ['VBIAS1', 'VBIAS2'] });
  assert.equal(exact.equation, 'Z_{out} = r_{o2} + r_{o1} + \\left(r_{o2} \\, r_{o1} \\, g_{m2}\\right) + \\left(r_{o2} \\, r_{o1} \\, g_{mb2}\\right)');
  const approximate = analyzeOutputImpedance(cascodeOutput(), 'VOUT', {
    acGrounds: ['VBIAS1', 'VBIAS2'],
    gmroLarge: true,
  });
  assert.equal(approximate.equation, 'Z_{out} \\approx \\left(r_{o2} \\, r_{o1} \\, g_{m2}\\right) + \\left(r_{o2} \\, r_{o1} \\, g_{mb2}\\right)');
  assert.equal(approximate.exactEquation, exact.equation);
  assert.ok(approximate.approximations.some((text) => /g_m r_o.*1/.test(text)));
});

test('renders complementary cascode output branches in parallel', () => {
  const report = analyzeOutputImpedance(complementaryCascodeOutput(), 'VOUT', {
    gmroLarge: true,
    acGrounds: ['VBIAS3.p', 'VBIAS4.p'],
  });
  assert.equal(report.ok, true);
  assert.equal(report.equation, 'Z_{out} \\approx \\left(r_{o1} \\, \\left(g_{m2} + g_{mb2}\\right) \\, r_{o2}\\right) \\|\\| \\left(r_{o3} \\, \\left(g_{m4} + g_{mb4}\\right) \\, r_{o4}\\right)');
  assert.match(report.smallSignalNetlist, /G_M1 .* V_\{IN\} 0 g_\{m1\}/);
  assert.match(report.smallSignalNetlist, /V_\{IN\} = 0/);
});

test('forms complementary cascode voltage gain from effective Gm and Rout', () => {
  const report = analyzeTransferFunction(complementaryCascodeOutput(), 'VOUT', {
    input: 'VIN',
    gmroLarge: true,
    acGrounds: ['VBIAS3.p', 'VBIAS4.p'],
  });
  assert.equal(report.ok, true);
  assert.equal(report.equation, 'A_v \\approx -g_{m1} \\, \\left(\\left(r_{o1} \\, \\left(g_{m2} + g_{mb2}\\right) \\, r_{o2}\\right) \\|\\| \\left(r_{o3} \\, \\left(g_{m4} + g_{mb4}\\right) \\, r_{o4}\\right)\\right)');
  assert.equal(report.effectiveTransconductance.equation, 'G_{m,eff} \\approx -g_{m1}');
  assert.equal(report.outputImpedance.equation, 'Z_{out} \\approx \\left(r_{o1} \\, \\left(g_{m2} + g_{mb2}\\right) \\, r_{o2}\\right) \\|\\| \\left(r_{o3} \\, \\left(g_{m4} + g_{mb4}\\right) \\, r_{o4}\\right)');
  assert.doesNotMatch(report.smallSignalNetlist, /V_\{IN\} = 0/);
  assert.match(report.smallSignalNetlist, /G_M1 .* V_\{IN\} 0 g_\{m1\}/);
});

test('keeps finite cascode r_o when large-gmro and global ro omission are both selected', () => {
  const report = analyzeOutputImpedance(complementaryCascodeOutput(), 'VOUT', {
    gmroLarge: true,
    ignoreChannelLengthModulation: true,
    acGrounds: ['VBIAS3.p', 'VBIAS4.p'],
    input: 'VIN',
  });
  assert.equal(report.ok, true);
  assert.equal(report.equation, 'Z_{out} \\approx \\left(r_{o1} \\, \\left(g_{m2} + g_{mb2}\\right) \\, r_{o2}\\right) \\|\\| \\left(r_{o3} \\, \\left(g_{m4} + g_{mb4}\\right) \\, r_{o4}\\right)');
  assert.doesNotMatch(report.equation, /\\infty/);
  assert.match(report.smallSignalNetlist, /R_M1 .* r_\{o1\}/);
  assert.match(report.smallSignalNetlist, /G_M1 .* V_\{IN\} 0 g_\{m1\}/);
  assert.ok(report.assumptions.some((text) => /Finite symbolic r_o is retained for cascode devices/.test(text)));
});

test('reports the ideal MOS gate input as infinite impedance', () => {
  const report = analyzeInputImpedance(commonSource(), 'VIN');
  assert.equal(report.ok, true);
  assert.equal(report.equation, 'Z_{in} = \\infty');
});

test('common-source output impedance zeroes the input source automatically', () => {
  const report = analyzeOutputImpedance(commonSource(), 'VOUT');
  assert.equal(report.ok, true);
  assert.equal(report.equation, 'Z_{out} = r_{o1} \\|\\| R_{D}');
  assert.equal(report.input.name, 'VIN');
  assert.equal(report.input.inferred, true);
  assert.ok(report.assumptions.some((text) => /VIN .*inferred as the input source.*set to zero/.test(text)));
  const explicit = runCommand(commonSource(), 'analyze output-impedance VOUT --input VIN');
  assert.equal(explicit.json.equation, 'Z_{out} = r_{o1} \\|\\| R_{D}');
  assert.equal(explicit.json.input.inferred, false);
});

test('supports capacitor impedance in output analysis', () => {
  const circuit = new Circuit();
  circuit.addComponent('capacitor', { refdes: 'C1', x: 0, y: 0 });
  circuit.addComponent('ground', { refdes: 'GND1', x: -80, y: 0 });
  circuit.addComponent('port', { refdes: 'P1', x: 80, y: 0 });
  circuit.connect('C1.a', 'GND1.gnd');
  circuit.connect('C1.b', 'P1.p');
  namedNet(circuit, 'P1.p', 'VOUT');
  const report = analyzeOutputImpedance(circuit, 'VOUT');
  assert.equal(report.ok, true);
  assert.equal(report.equation, 'Z_{out} = \\frac{1}{s \\, C_{1}}');
  assert.match(report.smallSignalNetlist, /C_C1 .* \\frac\{1\}\{s \\, C_\{1\}\}/);
});

test('derives input impedance with capacitive parallel loading', () => {
  const circuit = new Circuit();
  circuit.addComponent('resistor', { refdes: 'R1', x: 0, y: 0 });
  circuit.addComponent('capacitor', { refdes: 'C1', x: 0, y: 160 });
  circuit.addComponent('ground', { refdes: 'GND1', x: -80, y: 0 });
  circuit.addComponent('port', { refdes: 'PIN', x: 80, y: 0 });
  circuit.connect('R1.a', 'C1.a', 'GND1.gnd');
  circuit.connect('R1.b', 'C1.b', 'PIN.p');
  namedNet(circuit, 'PIN.p', 'VIN');
  const report = analyzeInputImpedance(circuit, 'VIN');
  assert.equal(report.ok, true);
  assert.equal(report.equation, 'Z_{in} = R_{1} \\|\\| \\frac{1}{s \\, C_{1}}');
  assert.ok(report.assumptions.some((text) => /AC test source/.test(text)));
  const command = runCommand(circuit, 'analyze input-impedance VIN');
  assert.equal(command.json.equation, report.equation);
});

test('uses persisted small-signal attributes as analysis context', () => {
  const circuit = singleResistor();
  circuit.setNetAnalysis(circuit.netOfTerminal('GND1.gnd'), { role: 'dc-bias', acGround: true });
  const report = analyzeOutputImpedance(circuit, 'VOUT');
  assert.equal(report.ok, true);
  assert.ok(report.reference.netIds.includes(circuit.netOfTerminal('GND1.gnd').id));
});

test('uses a persisted triode device attribute as a resistor model', () => {
  const circuit = singleResistor();
  circuit.addComponent('nmos', { refdes: 'M1', x: 0, y: 240 });
  circuit.addComponent('ground', { refdes: 'GND2', x: 200, y: 240 });
  circuit.connect('M1.d', 'R1.b');
  circuit.connect('M1.s', 'M1.g', 'GND2.gnd', 'GND1.gnd');
  circuit.setComponentAnalysis('M1', { model: 'triode' });
  const report = analyzeOutputImpedance(circuit, 'VOUT');
  assert.equal(report.ok, true);
  assert.match(report.equation, /r_\{ds1\}/);
  assert.ok(report.assumptions.some((text) => /triode device/.test(text)));
});
