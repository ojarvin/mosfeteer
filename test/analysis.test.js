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

function rcLowPass() {
  const circuit = new Circuit();
  circuit.addComponent('resistor', { refdes: 'R1', x: 0, y: 0 });
  circuit.addComponent('capacitor', { refdes: 'C1', x: 160, y: 160 });
  circuit.addComponent('ground', { refdes: 'GND1', x: 240, y: 240 });
  circuit.addComponent('input', { refdes: 'IN', x: -160, y: 0 });
  circuit.addComponent('output', { refdes: 'OUT', x: 320, y: 0 });
  circuit.connect('IN.p', 'R1.a');
  circuit.connect('R1.b', 'OUT.p', 'C1.a');
  circuit.connect('C1.b', 'GND1.gnd');
  namedNet(circuit, 'IN.p', 'VIN');
  namedNet(circuit, 'OUT.p', 'VOUT');
  return circuit;
}

function rlHighPass() {
  const circuit = new Circuit();
  circuit.addComponent('resistor', { refdes: 'R1', x: 0, y: 0 });
  circuit.addComponent('inductor', { refdes: 'L1', x: 160, y: 160 });
  circuit.addComponent('ground', { refdes: 'GND1', x: 240, y: 240 });
  circuit.addComponent('input', { refdes: 'IN', x: -160, y: 0 });
  circuit.addComponent('output', { refdes: 'OUT', x: 320, y: 0 });
  circuit.connect('IN.p', 'R1.a');
  circuit.connect('R1.b', 'OUT.p', 'L1.a');
  circuit.connect('L1.b', 'GND1.gnd');
  namedNet(circuit, 'IN.p', 'VIN');
  namedNet(circuit, 'OUT.p', 'VOUT');
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

function capacitiveCommonSource() {
  const circuit = new Circuit();
  for (const [type, refdes, x, y, rotation] of [
    ['nmos', 'M1', 0, 0, 0],
    ['resistor', 'RD', 0, -160, 0],
    ['capacitor', 'CGD', -40, 0, 0],
    ['capacitor', 'CLOAD', 120, 0, 90],
    ['ground', 'GND1', 0, 80, 0],
    ['supply', 'VDD1', 80, -160, 0],
    ['input', 'IN', -120, 0, 0],
    ['output', 'OUT', 0, -80, 0],
  ]) circuit.addComponent(type, { refdes, x, y, rotation });
  circuit.connect('RD.a', 'M1.d');
  circuit.connect('RD.b', 'VDD1.p');
  circuit.connect('M1.s', 'GND1.gnd');
  circuit.connect('M1.g', 'IN.p');
  circuit.connect('M1.d', 'OUT.p');
  circuit.connect('CGD.a', 'M1.g');
  circuit.connect('CGD.b', 'M1.d');
  circuit.connect('CLOAD.a', 'M1.d');
  circuit.connect('CLOAD.b', 'GND1.gnd');
  namedNet(circuit, 'IN.p', 'V_{IN}');
  namedNet(circuit, 'OUT.p', 'V_{OUT}');
  return circuit;
}

function cmosInverter() {
  const circuit = new Circuit();
  circuit.addComponent('nmos', { refdes: 'M1', x: 0, y: 0 });
  circuit.addComponent('pmos', { refdes: 'M2', x: 0, y: -240 });
  circuit.addComponent('ground', { refdes: 'GND1', x: -240, y: 80 });
  circuit.addComponent('supply', { refdes: 'VDD1', x: 240, y: -320 });
  circuit.addComponent('input', { refdes: 'IN', x: -240, y: 0 });
  circuit.addComponent('output', { refdes: 'OUT', x: 240, y: -80 });
  circuit.connect('M1.d', 'M2.d', 'OUT.p');
  circuit.connect('M1.s', 'GND1.gnd');
  circuit.connect('M2.s', 'VDD1.p');
  circuit.connect('M1.g', 'M2.g', 'IN.p');
  namedNet(circuit, 'IN.p', 'VIN');
  namedNet(circuit, 'OUT.p', 'VOUT');
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

function twoStageFeedback() {
  const circuit = new Circuit();
  const raw = (...refs) => {
    const net = circuit._createNet();
    net.terminals = refs.map((ref) => circuit.resolveTerm(ref));
    return net;
  };
  circuit.addComponent('nmos', { refdes: 'M1', x: 0, y: 0 });
  circuit.addComponent('resistor', { refdes: 'RD1', x: 0, y: -240 });
  circuit.addComponent('pmos', { refdes: 'M2', x: 400, y: 0 });
  circuit.addComponent('pmos', { refdes: 'M3', x: 400, y: 240 });
  circuit.addComponent('resistor', { refdes: 'RD2', x: 400, y: -240 });
  circuit.addComponent('resistor', { refdes: 'RF', x: 200, y: -400 });
  circuit.addComponent('ground', { refdes: 'GND', x: 0, y: 600 });
  circuit.addComponent('supply', { refdes: 'VDD', x: 400, y: -600 });
  circuit.addComponent('input', { refdes: 'IN', x: -240, y: 0 });
  circuit.addComponent('output', { refdes: 'OUT', x: 640, y: 0 });
  raw('M1.g', 'IN.p', 'RF.a');
  raw('M1.s', 'GND.gnd');
  raw('M1.d', 'RD1.a', 'M2.g');
  raw('M2.s', 'M3.d');
  raw('M2.d', 'M3.g', 'RD2.a', 'OUT.p', 'RF.b');
  raw('M3.s', 'VDD.p');
  raw('RD1.b', 'GND.gnd');
  raw('RD2.b', 'GND.gnd');
  namedNet(circuit, 'IN.p', 'VIN');
  namedNet(circuit, 'OUT.p', 'VOUT');
  const bias = namedNet(circuit, 'M2.s', 'VB');
  circuit.setNetAnalysis(bias, { acGround: true });
  return circuit;
}

function flippedVoltageFollower() {
  const circuit = new Circuit();
  // M5 is the source follower whose source is the output. M6 senses the
  // intermediate drain node and feeds the output through its drain.
  circuit.addComponent('pmos', { refdes: 'M5', x: 0, y: 160 });
  circuit.addComponent('pmos', { refdes: 'M6', x: 0, y: -160 });
  circuit.addComponent('input', { refdes: 'IN', x: -240, y: 160 });
  circuit.addComponent('output', { refdes: 'OUT', x: 240, y: 0 });
  circuit.addComponent('supply', { refdes: 'VDD', x: 160, y: -240 });
  circuit.addComponent('current_source', { refdes: 'I1', x: 160, y: 240 });
  circuit.addComponent('ground', { refdes: 'GND', x: 160, y: 400 });
  circuit.connect('M5.g', 'IN.p');
  circuit.connect('M5.s', 'M6.d', 'OUT.p');
  circuit.connect('M5.d', 'M6.g', 'I1.a');
  circuit.connect('M6.s', 'VDD.p');
  circuit.connect('I1.b', 'GND.gnd');
  namedNet(circuit, 'IN.p', 'VIN');
  namedNet(circuit, 'OUT.p', 'VOUT');
  namedNet(circuit, 'M5.d', 'VFB');
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

function loadedCascodeOutput() {
  const circuit = new Circuit();
  let x = 0;
  for (const [type, refdes] of [
    ['nmos', 'M1'], ['nmos', 'M2'], ['pmos', 'M3'], ['pmos', 'M4'], ['nmos', 'M5'],
    ['ground', 'GND'], ['supply', 'VDD'], ['output', 'OUT'],
  ]) circuit.addComponent(type, { refdes, x: x += 400, y: 0 });
  const raw = (name, ...refs) => {
    const net = circuit._createNet(name);
    net.terminals = refs.map((ref) => circuit.resolveTerm(ref));
    return net;
  };
  raw('VSS', 'M1.s', 'GND.gnd', 'M5.s');
  raw('VDD', 'M3.s', 'VDD.p');
  raw('NINTN', 'M1.d', 'M2.s');
  raw('NINTP', 'M3.d', 'M4.s', 'M5.d');
  raw('VOUT', 'M2.d', 'M4.d', 'OUT.p');
  for (let index = 1; index <= 5; index++) raw(`B${index}`, `M${index}.g`);
  return circuit;
}

function foldedCascodeOutputWithInputLoad() {
  const circuit = new Circuit();
  for (const [type, refdes, x, y] of [
    ['nmos', 'M8', 0, 240], ['nmos', 'M9', 0, 80],
    ['pmos', 'M10', 400, -80], ['pmos', 'M11', 400, -240], ['nmos', 'M3', 800, -80],
    ['resistor', 'RS', 680, 160], ['ground', 'GND', 0, 320], ['ground', 'GND2', 600, 160],
    ['supply', 'VDD', 400, -320], ['input', 'IN', 680, -80],
    ['port', 'BNO', -120, 240], ['port', 'BCN', -120, 80],
    ['port', 'BCP', 280, -80], ['port', 'BPO', 280, -240],
  ]) circuit.addComponent(type, { refdes, x, y });
  circuit.connect('M8.s', 'GND.gnd');
  circuit.connect('M8.d', 'M9.s');
  circuit.connect('M9.d', 'M10.d');
  circuit.connect('M10.s', 'M11.d', 'M3.d');
  circuit.connect('M11.s', 'VDD.p');
  circuit.connect('M3.g', 'IN.p');
  circuit.connect('M3.s', 'RS.b');
  circuit.connect('RS.a', 'GND2.gnd');
  circuit.connect('M9.g', 'BCN.p');
  circuit.connect('M10.g', 'BCP.p');
  circuit.connect('M8.g', 'BNO.p');
  circuit.connect('M11.g', 'BPO.p');
  namedNet(circuit, 'GND.gnd', 'VSS');
  namedNet(circuit, 'VDD.p', 'VDD');
  namedNet(circuit, 'IN.p', 'VIN');
  namedNet(circuit, 'M9.d', 'VOUT');
  namedNet(circuit, 'BCN.p', 'BCN');
  namedNet(circuit, 'BCP.p', 'BCP');
  namedNet(circuit, 'BNO.p', 'BNO');
  namedNet(circuit, 'BPO.p', 'BPO');
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

test('reduces a flipped-voltage follower output resistance through its feedback loop', () => {
  const options = {
    input: 'VIN',
    acGrounds: ['VDD', 'VSS'],
    gmroLarge: true,
    ignoreBodyEffect: true,
    ignoreChannelLengthModulation: true,
  };
  const report = analyzeOutputImpedance(flippedVoltageFollower(), 'VOUT', options);
  assert.equal(report.ok, true);
  assert.match(report.equation, /^Z_{out} \\approx \\frac\{1\}\{(?:g_{m5} \\, g_{m6}|g_{m6} \\, g_{m5}) \\, r_{o5}\}$/);
  assert.match(report.exactEquation, /g_\{m5\}/);
  assert.match(report.exactEquation, /g_\{m6\}/);
  assert.match(report.exactEquation, /r_\{o5\}/);
  assert.match(report.smallSignalNetlist, /R_M5 .*r_\{o5\}/);
  assert.doesNotMatch(report.smallSignalNetlist, /R_M6 .*r_\{o6\}/);
  assert.match(report.smallSignalNetlist, /OPEN I1/);
  assert.match(report.nodeEquations.join('\n'), /V_\{IN\} = 0/);
  assert.doesNotMatch(report.assumptions.join('\n'), /FVF|flipped-voltage/i);
  const transfer = analyzeTransferFunction(flippedVoltageFollower(), 'VOUT', options);
  assert.equal(transfer.ok, true);
  assert.equal(transfer.equation, 'A_v \\approx 1');
});

test('uses the direct Vout/Vin solve when the Norton shortcut sees a floating feedback node', () => {
  const report = analyzeTransferFunction(flippedVoltageFollower(), 'VOUT', {
    input: 'VIN',
    gmroLarge: true,
    ignoreBodyEffect: true,
  });
  assert.equal(report.ok, true);
  assert.equal(report.equation, 'A_v \\approx 1');
  assert.equal(report.directExpression.kind, 'number');
  assert.equal(report.directExpression.value, 1);
  assert.doesNotMatch(report.equation, /\\infty|0/);
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
  assert.match(report.smallSignalNetlist, /G_M1 current: g_\{m1\} \(0 - 0\)/);
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

test('independent DC sources use open/short small-signal equivalents', () => {
  const current = singleResistor();
  current.addComponent('current_source', { refdes: 'I1', x: 0, y: 240 });
  current.addComponent('ground', { refdes: 'GND2', x: 0, y: 400 });
  current.connect('I1.a', 'R1.b');
  current.connect('I1.b', 'GND2.gnd');
  const currentReport = analyzeOutputImpedance(current, 'VOUT');
  assert.equal(currentReport.ok, true);
  assert.equal(currentReport.equation, 'Z_{out} = R_{1}');
  assert.match(currentReport.smallSignalNetlist, /OPEN I1: independent DC current source/);

  const voltage = new Circuit();
  voltage.addComponent('voltage_source', { refdes: 'V1', x: 0, y: 0 });
  voltage.addComponent('ground', { refdes: 'GND1', x: 0, y: 160 });
  voltage.addComponent('port', { refdes: 'P1', x: 0, y: -80 });
  voltage.connect('V1.a', 'P1.p');
  voltage.connect('V1.b', 'GND1.gnd');
  namedNet(voltage, 'P1.p', 'VOUT');
  const voltageReport = analyzeOutputImpedance(voltage, 'VOUT');
  assert.equal(voltageReport.ok, true);
  assert.equal(voltageReport.equation, 'Z_{out} = 0');
  assert.match(voltageReport.smallSignalNetlist, /SHORT V1: independent DC voltage source/);
  assert.ok(voltageReport.assumptions.some((text) => /V1.*shorted/.test(text)));
});

test('supports an electrically relevant capacitor in the symbolic model', () => {
  const circuit = singleResistor();
  circuit.addComponent('capacitor', { refdes: 'C1', x: 0, y: 240 });
  circuit.connect('C1.a', 'R1.b');
  circuit.connect('C1.b', 'GND1.gnd');
  const report = analyzeOutputImpedance(circuit, 'VOUT');
  assert.equal(report.ok, true);
  assert.equal(report.equation, 'Z_{out}(s) = R_{1} \\|\\| \\frac{1}{s \\, C_{1}}');
});

test('separates DC and AC transfer results and derives a first-order pole', () => {
  const report = analyzeTransferFunction(rcLowPass(), 'VOUT', {
    input: 'VIN',
    millerApproximation: false,
  });
  assert.equal(report.ok, true);
  assert.equal(report.dcGain.equation, 'A_v(0) = 1');
  assert.equal(report.dcInputImpedance.equation, 'Z_{in}(0) = \\infty');
  assert.equal(report.dcOutputImpedance.equation, 'Z_{out}(0) = R_{1}');
  assert.equal(report.acTransfer.ok, true);
  assert.match(report.acTransfer.equation, /^A_v\(s\) =/);
  assert.equal(report.frequencyResponse.denominatorDegree, 1);
  assert.equal(report.frequencyResponse.poles.length, 1);
  assert.equal(report.frequencyResponse.poles[0].equation, 'p_{0} = -\\frac{1}{R_{1} \\, C_{1}}');
  assert.deepEqual(report.frequencyResponse.zeros, []);
});

test('takes the DC limit of an inductor-loaded transfer', () => {
  const report = analyzeTransferFunction(rlHighPass(), 'VOUT', {
    input: 'VIN',
    millerApproximation: false,
  });
  assert.equal(report.ok, true);
  assert.equal(report.dcGain.equation, 'A_v(0) = 0');
  assert.equal(report.dcInputImpedance.equation, 'Z_{in}(0) = R_{1}');
  assert.equal(report.dcOutputImpedance.equation, 'Z_{out}(0) = 0');
  assert.equal(report.frequencyResponse.zeros[0].equation, 'z_{0} = 0');
  assert.equal(report.frequencyResponse.poles[0].equation, 'p_{0} = -\\frac{R_{1}}{L_{1}}');
});

test('keeps a capacitor-loaded common-source analyzable in the DC companion', () => {
  const circuit = capacitiveCommonSource();
  const report = analyzeTransferFunction(circuit, 'V_{OUT}', {
    input: 'V_{IN}',
    cascodeApproximation: true,
    ignoreBodyEffect: true,
    gmroLarge: true,
    millerApproximation: true,
  });
  assert.equal(report.ok, true);
  assert.equal(report.dcGain.ok, true);
  assert.equal(report.dcInputImpedance.ok, true);
  assert.equal(report.dcOutputImpedance.ok, true);
  assert.equal(report.dcGain.equation, 'A_v(0) = -g_{m1} \\, \\left(r_{o1} \\|\\| R_{D}\\right)');
  assert.equal(report.dcOutputImpedance.equation, 'Z_{out}(0) = r_{o1} \\|\\| R_{D}');
  assert.match(report.acTransfer.equation, /^A_v\(s\)/);
  assert.match(report.acTransfer.equation, /g_\{m1\}\^\{2\}/);
  assert.doesNotMatch(report.acTransfer.equation, /g_\{m1\} \\, g_\{m1\}/);
  assert.equal(report.frequencyResponse.poles[0].equation, 'p_{0} = -\\frac{g_{m1} \\, \\left(R_{D} + r_{o1}\\right)}{C_{GD} \\, \\left(g_{m1} \\, r_{o1} \\, R_{D} + R_{D} + r_{o1}\\right) + g_{m1} \\, r_{o1} \\, R_{D} \\, C_{LOAD}}');
  assert.doesNotMatch(report.frequencyResponse.poles[0].equation, /\\left\(\\left\(/);

  const dc = deriveSmallSignalModel(circuit, 'V_{OUT}', { dcOnly: true });
  assert.deepEqual(dc.model.elements.filter((element) => element.kind === 'capacitor'), []);
  assert.deepEqual(dc.model.openCircuits.map(({ component }) => component), ['CGD', 'CLOAD']);
});

test('dominant-pole approximation reduces higher-order AC denominators', () => {
  const circuit = new Circuit();
  for (const [type, refdes, x, y] of [
    ['resistor', 'R1', 0, 0],
    ['capacitor', 'C1', 120, 160],
    ['resistor', 'R2', 240, 0],
    ['capacitor', 'C2', 360, 160],
    ['ground', 'GND', 360, 320],
    ['input', 'IN', -160, 0],
    ['output', 'OUT', 480, 0],
  ]) circuit.addComponent(type, { refdes, x, y });
  circuit.connect('IN.p', 'R1.a');
  circuit.connect('R1.b', 'C1.a', 'R2.a');
  circuit.connect('C1.b', 'GND.gnd');
  circuit.connect('R2.b', 'OUT.p', 'C2.a');
  circuit.connect('C2.b', 'GND.gnd');
  namedNet(circuit, 'IN.p', 'VIN');
  namedNet(circuit, 'OUT.p', 'VOUT');
  const report = analyzeTransferFunction(circuit, 'VOUT', {
    input: 'VIN',
    millerApproximation: false,
    dominantPoleApproximation: true,
  });
  assert.equal(report.ok, true);
  assert.ok(report.frequencyResponse.exact.denominatorDegree > 1);
  assert.equal(report.frequencyResponse.dominantPoleApplied, true);
  assert.equal(report.frequencyResponse.denominatorDegree, 1);
  assert.equal(report.frequencyResponse.poles.length, 1);
  assert.ok(report.approximations.some((text) => /Dominant-pole approximation/.test(text)));
  assert.match(report.acTransfer.equation, /^A_v\(s\) \\approx/);
  const exactEquation = report.acTransfer.exactEquation;
  const quadratic = exactEquation.indexOf('s^{2}');
  const linear = exactEquation.indexOf('s', quadratic + 's^{2}'.length);
  assert.ok(quadratic >= 0 && linear > quadratic, 'AC polynomial terms are ordered by descending s power');
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
  const millerAssumption = miller.assumptions.find((text) => text.startsWith('CGD is split'));
  assert.match(millerAssumption, /Z_\{in\}\(s\)=.*s \\, C_\{GD\}.*1 - A_\{v1\}/);
  assert.doesNotMatch(millerAssumption.split(', Z_\{out\}\(s\)=')[0], /1 - A_\{v1\}.*s \\, C_\{GD\}/);

  const transfer = analyzeTransferFunction(circuit, 'VOUT', {
    input: 'VIN',
    gmroLarge: true,
    millerApproximation: true,
  });
  assert.equal(transfer.ok, true);
  assert.match(transfer.equation, /g_\{m1\}/);
  const input = analyzeInputImpedance(circuit, 'VIN', {
    gmroLarge: true,
    millerApproximation: true,
  });
  assert.match(input.equation, /s \\, C_\{GD\}.*1 - A_\{v1\}/);
  assert.doesNotMatch(input.equation, /1 - A_\{v1\}.*s \\, C_\{GD\}/);
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
  assert.match(model.assumptions.join('\n'), /Z_\{in\}\(s\)=.*1 - A_\{v1\}/);
  assert.match(model.assumptions.join('\n'), /Z_\{out\}\(s\)=.*1 - \\frac\{1\}\{A_\{v1\}\}/);

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

test('Miller approximation includes both devices in an inverter feedback gain', () => {
  const circuit = cmosInverter();
  circuit.addComponent('resistor', { refdes: 'RF', x: -40, y: 0 });
  circuit.connect('RF.a', 'M1.g');
  circuit.connect('RF.b', 'M1.d');
  const model = deriveSmallSignalModel(circuit, 'VOUT', {
    input: 'VIN',
    gmroLarge: true,
    ignoreBodyEffect: true,
    millerApproximation: true,
  });
  assert.match(model.assumptions.join('\n'), /RF is split.*g_\{m1\} \+ g_\{m2\}/);
  assert.match(model.assumptions.join('\n'), /r_\{o1\}.*r_\{o2\}/);
});

test('Miller approximation recognizes a feedback resistor across two gain stages', () => {
  const circuit = twoStageFeedback();
  const report = deriveSmallSignalModel(circuit, 'VOUT', {
    input: 'VIN',
    acGrounds: ['VB'],
    gmroLarge: true,
    ignoreBodyEffect: true,
    millerApproximation: true,
  });
  const feedback = report.model.elements.filter((element) => element.component === 'RF');
  assert.deepEqual(feedback.map((element) => element.millerRole).sort(), ['input', 'output']);
  assert.match(report.assumptions.join('\n'), /A_\{v,RF\}/);
  assert.match(report.approximations.join('\n'), /RF is split/);
});

test('non-standard MOS refdes keeps its complete identity in symbolic names', () => {
  const circuit = commonSource();
  circuit.renameComponent('M1', 'MN_1');
  const report = analyzeTransferFunction(circuit, 'VOUT', { input: 'VIN' });
  assert.equal(report.ok, true);
  assert.match(report.equation, /g_\{m,MN_1\}/);
  assert.doesNotMatch(report.equation, /g_\{m1\}/);
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

test('CMOS inverter adds NMOS and PMOS transconductance in its gain', () => {
  const report = analyzeTransferFunction(cmosInverter(), 'VOUT', {
    input: 'VIN',
    millerApproximation: false,
  });
  assert.equal(report.ok, true);
  const controlledSources = report.smallSignalModel.elements.filter((element) => element.kind === 'vccs');
  assert.deepEqual(controlledSources.map((element) => element.component), ['M1', 'M2']);
  assert.ok(controlledSources.every((element) => element.polarity === 1));
  assert.ok(controlledSources.every((element) => element.controlPlusNetId === report.input.netId));
  assert.match(report.equation, /g_\{m1\}/);
  assert.match(report.equation, /g_\{m2\}/);
  assert.doesNotMatch(report.equation, /-g_\{m1\}.*\+.*g_\{m2\}/);
  assert.match(report.equation, /-\\left\(g_\{m1\} \+ g_\{m2\}\\right\)/);
  assert.match(report.smallSignalNetlist, /G_M1 V_\{OUT\} 0 V_\{IN\} 0 g_\{m1\}/);
  assert.match(report.smallSignalNetlist, /G_M2 V_\{OUT\} 0 V_\{IN\} 0 g_\{m2\}/);
  assert.ok(report.assumptions.some((text) => /M2 bulk is unused and is assumed tied to VDD/.test(text)));
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
  assert.equal(output.equation, 'Z_{out} = R_{D} \\|\\| \\left(r_{o1} + R_{S} + \\left(r_{o1} \\, R_{S} \\, \\left(g_{m1} + g_{mb1}\\right)\\right)\\right)');
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

test('cancels reciprocal factors in the Norton gain product', () => {
  const circuit = commonDrain();
  circuit.setComponentAnalysis('RS', { resistance: 'infinite' });
  const report = analyzeTransferFunction(circuit, 'VOUT', {
    input: 'VIN',
    gmroLarge: true,
    ignoreBodyEffect: true,
  });
  assert.equal(report.ok, true);
  assert.equal(report.equation, 'A_v \\approx 1');
  assert.doesNotMatch(report.equation, /g_\{m1\}.*\\frac\{1\}\{g_\{m1\}\}/);
});

test('large-gmro approximation collapses a cascoded common-source gain', () => {
  const report = analyzeTransferFunction(cascodedCommonSource(), 'VOUT', {
    input: 'VIN',
    gmroLarge: true,
    cascodeApproximation: true,
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
  assert.equal(output.equation, 'Z_{out} = R_{D} \\|\\| \\left(r_{o1} + r_{o2} + \\left(r_{o1} \\, r_{o2} \\, \\left(g_{m2} + g_{mb2}\\right)\\right)\\right)');
  const gain = analyzeTransferFunction(circuit, 'VOUT', { input: 'VIN' });
  assert.equal(gain.ok, true);
  assert.match(gain.equation, /R_{D} \\|\\|/);
  assert.doesNotMatch(gain.equation, /\\frac\{1\}\{R_{D}\}/);
});

test('global r_o infinity leaves the cascoded branch open while retaining its exact reference', () => {
  const report = analyzeOutputImpedance(cascodedCommonSource(), 'VOUT', {
    input: 'VIN',
    ignoreChannelLengthModulation: true,
  });
  assert.equal(report.equation, 'Z_{out} \\approx R_{D}');
  assert.match(report.exactEquation, /r_\{o1\}/);
  assert.match(report.approximations.join('\\n'), /Cascode branch kept compact/);
});

test('clearing the global r_o infinity option restores finite output resistance', () => {
  const circuit = commonSource();
  const infinite = analyzeTransferFunction(circuit, 'VOUT', {
    input: 'VIN',
    ignoreChannelLengthModulation: true,
  });
  const finite = analyzeTransferFunction(circuit, 'VOUT', {
    input: 'VIN',
    ignoreChannelLengthModulation: false,
  });
  assert.equal(infinite.equation, 'A_v \\approx -g_{m1} \\, R_{D}');
  assert.equal(finite.equation, 'A_v = -g_{m1} \\, \\left(r_{o1} \\|\\| R_{D}\\right)');
  assert.doesNotMatch(finite.approximations.join('\\n'), /r_o.*∞/);
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
    cascodeApproximation: true,
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
  assert.equal(input.equation, 'Z_{in} = \\frac{r_{o1} + R_{D}}{1 + r_{o1} \\, \\left(g_{m1} + g_{mb1}\\right)}');
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
  assert.match(commandHelp(), /--dominant-pole/);

  const commonGateInput = analyzeInputImpedance(commonGate(), 'VIN', {
    acGrounds: ['VBIAS'],
    gmroLarge: true,
    ignoreChannelLengthModulation: true,
  });
  assert.equal(commonGateInput.equation, 'Z_{in} \\approx \\frac{1}{g_{m1} + g_{mb1}}');
  assert.equal(commonGateInput.exactEquation, 'Z_{in} = \\frac{r_{o1} + R_{D}}{1 + r_{o1} \\, \\left(g_{m1} + g_{mb1}\\right)}');
  assert.ok(commonGateInput.approximations.some((text) => /g_m r_o.*1/.test(text)));
});

test('shortens a cascode output resistance when g_m r_o is assumed large', () => {
  const exact = analyzeOutputImpedance(cascodeOutput(), 'VOUT', { acGrounds: ['VBIAS1', 'VBIAS2'] });
  assert.equal(exact.equation, 'Z_{out} = r_{o2} + r_{o1} + g_{m2} \\, r_{o2} \\, r_{o1} + g_{mb2} \\, r_{o2} \\, r_{o1}');
  const approximate = analyzeOutputImpedance(cascodeOutput(), 'VOUT', {
    acGrounds: ['VBIAS1', 'VBIAS2'],
    gmroLarge: true,
    cascodeApproximation: true,
  });
  assert.equal(approximate.equation, 'Z_{out} \\approx g_{m2} \\, r_{o2} \\, r_{o1} + g_{mb2} \\, r_{o2} \\, r_{o1}');
  assert.equal(approximate.exactEquation, exact.equation);
  assert.ok(approximate.approximations.some((text) => /g_m r_o.*1/.test(text)));
});

test('does not apply the cascode dominant-term reduction unless explicitly enabled', () => {
  const report = analyzeOutputImpedance(cascodeOutput(), 'VOUT', {
    acGrounds: ['VBIAS1', 'VBIAS2'],
    gmroLarge: true,
  });
  assert.equal(report.ok, true);
  assert.equal(report.equation, 'Z_{out} = r_{o2} + r_{o1} + g_{m2} \\, r_{o2} \\, r_{o1} + g_{mb2} \\, r_{o2} \\, r_{o1}');
  assert.doesNotMatch(report.approximations.join('\\n'), /Cascode dominant-term approximation/);
});

test('renders complementary cascode output branches in parallel', () => {
  const report = analyzeOutputImpedance(complementaryCascodeOutput(), 'VOUT', {
    gmroLarge: true,
    cascodeApproximation: true,
    acGrounds: ['VBIAS3.p', 'VBIAS4.p'],
  });
  assert.equal(report.ok, true);
  assert.equal(report.equation, 'Z_{out} \\approx \\left(r_{o1} \\, r_{o2} \\, \\left(g_{m2} + g_{mb2}\\right)\\right) \\|\\| \\left(r_{o3} \\, r_{o4} \\, \\left(g_{m4} + g_{mb4}\\right)\\right)');
  assert.match(report.approximations.join('\\n'), /Cascode dominant-term approximation:.*equivalently/);
  assert.match(report.smallSignalNetlist, /G_M1 .* V_\{IN\} 0 g_\{m1\}/);
  assert.doesNotMatch(report.smallSignalNetlist, /V_\{IN\} = 0/);
  assert.match(report.nodeEquations.join('\\n'), /V_\{IN\} = 0/);
});

test('keeps a loaded folded cascode on the nodal output-impedance path', () => {
  const report = analyzeOutputImpedance(loadedCascodeOutput(), 'VOUT', {
    acGrounds: ['B1', 'B2', 'B3', 'B4', 'B5'],
  });
  assert.equal(report.ok, true);
  assert.match(report.equation, /r_\{o2\}/);
  assert.match(report.equation, /r_\{o4\}/);
  assert.match(report.equation, /r_\{o5\}/);
  assert.match(report.assumptions.join('\n'), /folded-cascode branches/);
  assert.match(report.assumptions.join('\n'), /r_\{o3\}.*r_\{o5\}/);
});

test('includes the input-side transistor in a folded cascode branch load', () => {
  const report = analyzeOutputImpedance(foldedCascodeOutputWithInputLoad(), 'VOUT', {
    input: 'VIN',
    acGrounds: ['VDD', 'BNO', 'BCN', 'BCP', 'BPO'],
    gmroLarge: true,
    cascodeApproximation: true,
    ignoreBodyEffect: true,
  });
  assert.equal(report.ok, true);
  assert.equal(report.equation, 'Z_{out} \\approx \\left(g_{m9} \\, r_{o8} \\, r_{o9}\\right) \\|\\| \\left(g_{m10} \\, r_{o10} \\, \\left(r_{o11} \\|\\| r_{o3}\\right)\\right)');
  assert.match(report.smallSignalNetlist, /G_M3 current: g_\{m3\} \(V_\{IN\} - N12\)/);
  assert.match(report.exactEquation, /r_\{o11\} \\|\\| r_\{o3\}/);
  assert.match(report.assumptions.join('\n'), /internal load.*r_\{o11\}.*r_\{o3\}/);
  const retained = analyzeOutputImpedance(foldedCascodeOutputWithInputLoad(), 'VOUT', {
    input: 'VIN',
    acGrounds: ['VDD', 'BNO', 'BCN', 'BCP', 'BPO'],
    gmroLarge: true,
    cascodeApproximation: true,
    ignoreChannelLengthModulation: true,
    ignoreBodyEffect: true,
  });
  assert.equal(retained.equation, report.equation);
});

test('forms complementary cascode voltage gain from effective Gm and Rout', () => {
  const report = analyzeTransferFunction(complementaryCascodeOutput(), 'VOUT', {
    input: 'VIN',
    gmroLarge: true,
    cascodeApproximation: true,
    acGrounds: ['VBIAS3.p', 'VBIAS4.p'],
  });
  assert.equal(report.ok, true);
  assert.equal(report.equation, 'A_v \\approx -g_{m1} \\, \\left(\\left(r_{o1} \\, r_{o2} \\, \\left(g_{m2} + g_{mb2}\\right)\\right) \\|\\| \\left(r_{o3} \\, r_{o4} \\, \\left(g_{m4} + g_{mb4}\\right)\\right)\\right)');
  assert.equal(report.effectiveTransconductance.equation, 'G_{m,eff} \\approx -g_{m1}');
  assert.equal(report.outputImpedance.equation, 'Z_{out} \\approx \\left(r_{o1} \\, r_{o2} \\, \\left(g_{m2} + g_{mb2}\\right)\\right) \\|\\| \\left(r_{o3} \\, r_{o4} \\, \\left(g_{m4} + g_{mb4}\\right)\\right)');
  assert.doesNotMatch(report.smallSignalNetlist, /V_\{IN\} = 0/);
  assert.match(report.smallSignalNetlist, /G_M1 .* V_\{IN\} 0 g_\{m1\}/);
});

test('keeps finite cascode r_o when large-gmro and global ro omission are both selected', () => {
  const report = analyzeOutputImpedance(complementaryCascodeOutput(), 'VOUT', {
    gmroLarge: true,
    ignoreChannelLengthModulation: true,
    cascodeApproximation: true,
    acGrounds: ['VBIAS3.p', 'VBIAS4.p'],
    input: 'VIN',
  });
  assert.equal(report.ok, true);
  assert.equal(report.equation, 'Z_{out} \\approx \\left(r_{o1} \\, r_{o2} \\, \\left(g_{m2} + g_{mb2}\\right)\\right) \\|\\| \\left(r_{o3} \\, r_{o4} \\, \\left(g_{m4} + g_{mb4}\\right)\\right)');
  assert.doesNotMatch(report.equation, /\\infty/);
  assert.match(report.smallSignalNetlist, /R_M1 .* r_\{o1\}/);
  assert.match(report.smallSignalNetlist, /G_M1 .* V_\{IN\} 0 g_\{m1\}/);
  assert.ok(report.assumptions.some((text) => /Finite symbolic r_o is retained for .*cascode branch devices/.test(text)));
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
  assert.equal(report.equation, 'Z_{out}(s) = \\frac{1}{s \\, C_{1}}');
  assert.match(report.smallSignalNetlist, /C_C1 .* \\frac\{1\}\{s \\, C_\{1\}\}/);
});

test('DC-only reduction opens capacitors and shorts inductors before stamping KCL', () => {
  const circuit = new Circuit();
  circuit.addComponent('resistor', { refdes: 'R1', x: 0, y: 0 });
  circuit.addComponent('capacitor', { refdes: 'C1', x: 0, y: 160 });
  circuit.addComponent('inductor', { refdes: 'L1', x: 0, y: -160 });
  circuit.addComponent('ground', { refdes: 'GND1', x: -80, y: 0 });
  circuit.addComponent('port', { refdes: 'P1', x: 80, y: 0 });
  circuit.connect('R1.a', 'GND1.gnd');
  circuit.connect('R1.b', 'P1.p');
  circuit.connect('C1.a', 'P1.p');
  circuit.connect('C1.b', 'GND1.gnd');
  circuit.connect('L1.a', 'P1.p');
  circuit.connect('L1.b', 'GND1.gnd');
  namedNet(circuit, 'P1.p', 'VOUT');

  const model = deriveSmallSignalModel(circuit, 'VOUT', { dcOnly: true });
  assert.equal(model.ok, true);
  assert.deepEqual(model.model.elements, []);
  assert.equal(model.model.nodeAliases.get(circuit.netOfTerminal({ comp: 'P1', term: 'p' }).id), '@AC_GROUND');
  assert.match(model.approximations.join('\n'), /DC operating-point topology/);
  assert.match(model.assumptions.join('\n'), /C1 is open at DC/);
  assert.match(model.assumptions.join('\n'), /L1 is shorted at DC/);

  const report = analyzeOutputImpedance(circuit, 'VOUT', { dcOnly: true });
  assert.equal(report.ok, true);
  assert.equal(report.equation, 'Z_{out} = 0');
  assert.doesNotMatch(report.smallSignalNetlist, /[CL]_C?1/);
});

test('DC-only input impedance exact pass does not recurse', () => {
  const circuit = singleResistor();
  const report = analyzeInputImpedance(circuit, 'VOUT', { dcOnly: true });
  assert.equal(report.ok, true);
  assert.equal(report.equation, 'Z_{in} \\approx R_{1}');
});

test('DC-only transfer exact pass does not recurse', () => {
  const circuit = commonSource();
  const report = analyzeTransferFunction(circuit, 'VOUT', { input: 'VIN', dcOnly: true });
  assert.equal(report.ok, true);
  assert.match(report.equation, /^A_v/);
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
  assert.equal(report.equation, 'Z_{in}(s) = R_{1} \\|\\| \\frac{1}{s \\, C_{1}}');
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

test('treats an explicitly infinite resistor as an open branch', () => {
  const circuit = singleResistor();
  circuit.addComponent('resistor', { refdes: 'R2', x: 0, y: 160 });
  circuit.connect('R2.a', 'GND1.gnd');
  circuit.connect('R2.b', 'P1.p');
  circuit.setComponentAnalysis('R1', { resistance: 'infinite' });
  const report = analyzeOutputImpedance(circuit, 'VOUT');
  assert.equal(report.ok, true);
  assert.equal(report.equation, 'Z_{out} \\approx R_{2}');
  assert.match(report.smallSignalNetlist, /OPEN R1/);
  assert.ok(report.approximations.some((text) => /R1 R \\to \\infty/.test(text)));
  assert.match(report.exactEquation, /R_{1}/);
});
