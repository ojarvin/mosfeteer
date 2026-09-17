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
  assert.strictEqual(report.details.queries, report.details.pipeline.queries);
});

test('derives common-source gain from the shared exact model', () => {
  const report = analyzeSmallSignalV2(commonSource());
  assert.equal(report.ok, true, report.error);
  assert.match(expressionText(report.exact.Av), /gm1/);
  assert.match(expressionText(report.exact.Av), /ro1/);
  assert.match(report.netlist.text, /G_M1 .* V_\{IN\}/);
});

test('g_m r_o >> 1 alone never drops a finite r_o next to an unrelated resistor', () => {
  // g_m r_o >> 1 only licenses dropping a bare additive constant next to a
  // gm*ro product; it says nothing about r_o vs. an unrelated resistor like
  // R_D, so the default (r_o -> infinity left off) must keep R_D || r_o1
  // intact rather than silently collapsing it to R_D alone.
  const report = analyzeSmallSignalV2(commonSource());
  assert.equal(report.ok, true, report.error);
  assert.deepEqual(report.assumptions, []);
  assert.match(expressionText(report.approximate.Zout.selected), /ro1/);
  assert.match(expressionText(report.approximate.Zout.selected), /RD/);

  const withRoInfinity = analyzeSmallSignalV2(commonSource(), { ignoreChannelLengthModulation: true });
  assert.equal(withRoInfinity.ok, true, withRoInfinity.error);
  assert.deepEqual(withRoInfinity.assumptions, ['r_o -> infinity (M1)']);
  assert.doesNotMatch(expressionText(withRoInfinity.approximate.Zout.selected), /ro1/);
});

test('honors a resistor marked "treat as R = infinity", dropping it from Zout and the gain like an ideal current-source load', () => {
  const circuit = commonSource();
  circuit.setComponentAnalysis('RD', { resistance: 'infinite' });
  const report = analyzeSmallSignalV2(circuit);
  assert.equal(report.ok, true, report.error);
  assert.equal(report.output.dc.equation, 'Z_{out}(0) = r_{o1}');
  assert.equal(report.transfer.dc.equation, 'A_v(0) = -g_{m1} \\, r_{o1}');
});

test('renders the exact common-source output impedance as R_D || r_o1, matching the general network pre-reduction', () => {
  const report = analyzeSmallSignalV2(commonSource());
  assert.equal(report.ok, true, report.error);
  assert.equal(report.output.dc.equation, 'Z_{out}(0) = r_{o1} \\parallel R_{D}');
});

test('renders every branch at a common-source-with-load-cap output node in one parallel group', () => {
  const circuit = new Circuit();
  ports(circuit);
  circuit.addComponent('nmos', { refdes: 'M1', x: 0, y: 0 });
  circuit.addComponent('resistor', { refdes: 'RD', x: 0, y: -160 });
  circuit.addComponent('capacitor', { refdes: 'CL', x: 240, y: -160 });
  circuit.addComponent('ground', { refdes: 'GND', x: 160, y: 160 });
  circuit.addComponent('ground', { refdes: 'GND2', x: 320, y: -80 });
  circuit.addComponent('supply', { refdes: 'VDD', x: 160, y: -320 });
  net(circuit, 'VIN', 'IN.p', 'M1.g');
  net(circuit, 'VOUT', 'M1.d', 'RD.a', 'CL.a', 'OUT.p');
  net(circuit, 'VSS', 'M1.s', 'GND.gnd');
  net(circuit, 'VDD', 'RD.b', 'VDD.p');
  net(circuit, 'VSS2', 'CL.b', 'GND2.gnd');
  const report = analyzeSmallSignalV2(circuit);
  assert.equal(report.ok, true, report.error);
  assert.match(report.output.ac.exactEquation, /r_\{o1\} \\parallel R_\{D\} \\parallel \\frac\{1\}\{s \\, C_\{L\}\}/);
  // The exact row alone isn't enough — the default equation (what actually
  // gets annotated onto the schematic) comes from one leading-term
  // reduction of the whole expression and does not automatically inherit
  // this factored structure, so it needs its own equivalence.
  assert.match(report.output.ac.equation, /r_\{o1\} \\parallel R_\{D\} \\parallel \\frac\{1\}\{s \\, C_\{L\}\}/);
  // At s=0 the load cap is an open circuit and must drop out of the group
  // rather than the whole thing failing to combine.
  assert.equal(report.output.dc.equation, 'Z_{out}(0) = r_{o1} \\parallel R_{D}');
  assert.deepEqual(report.equations.slice(0, 5), [
    report.input.dc.equation,
    report.output.ac.equation,
    report.output.dc.equation,
    report.transfer.ac.equation,
    report.transfer.dc.equation,
  ]);
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

test('r_o infinity from the GUI option names leaves r_o out of the model', () => {
  const report = analyzeSmallSignalV2(inverter(), { neglectChannelLengthModulation: true });
  assert.equal(report.ok, true, report.error);
  // Both r_o removed float the inverter output, so r_o is kept with a note.
  assert.match(report.log, /r_o was kept/);

  const cs = analyzeSmallSignalV2(commonSource(), { neglectChannelLengthModulation: true });
  assert.equal(cs.ok, true, cs.error);
  assert.equal(cs.details.pipeline.selected.some(({ id }) => id === 'M1.ro'), false);
  assert.deepEqual(cs.assumptions.filter((value) => value.startsWith('r_o')), ['r_o -> infinity (M1)']);
  assert.doesNotMatch(expressionText(cs.transfer.response), /ro1/);
  assert.doesNotMatch(cs.log, /r_o was kept/);
});

test('a per-device GUI override keeps r_o when the global r_o infinity is selected', () => {
  const report = analyzeSmallSignalV2(commonSource(), {
    neglectChannelLengthModulation: true,
    devices: { M1: { neglectChannelLengthModulation: false } },
  });
  assert.equal(report.ok, true, report.error);
  assert.equal(report.details.pipeline.selected.some(({ id }) => id === 'M1.ro'), true);
  assert.match(expressionText(report.exact.Zout), /ro1/);
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

function renameNetAt(circuit, terminal, name) {
  const physicalNet = circuit.netOfTerminal(terminal);
  circuit.renameNet(physicalNet, name);
}

function cascodeWithCascodeLoad() {
  const circuit = new Circuit();
  ports(circuit);
  circuit.addComponent('nmos', { refdes: 'M1', x: 0, y: 0 });
  circuit.addComponent('nmos', { refdes: 'M2', x: 0, y: -160 });
  circuit.addComponent('pmos', { refdes: 'M3', x: 0, y: -320 });
  circuit.addComponent('pmos', { refdes: 'M4', x: 0, y: -480 });
  circuit.addComponent('ground', { refdes: 'GND', x: 160, y: 160 });
  circuit.addComponent('supply', { refdes: 'VDD', x: 160, y: -640 });
  circuit.addComponent('port', { refdes: 'BIASN', x: -160, y: -160 });
  circuit.addComponent('port', { refdes: 'BIASP', x: -160, y: -320 });
  circuit.connect('IN.p', 'M1.g');
  circuit.connect('M1.s', 'GND.gnd');
  circuit.connect('M1.d', 'M2.s');
  circuit.connect('M2.g', 'BIASN.p');
  circuit.connect('M2.d', 'M3.d', 'OUT.p');
  circuit.connect('M3.g', 'M4.g', 'BIASP.p');
  circuit.connect('M3.s', 'M4.d');
  circuit.connect('M4.s', 'VDD.p');
  renameNetAt(circuit, 'IN.p', 'VIN');
  renameNetAt(circuit, 'OUT.p', 'VOUT');
  renameNetAt(circuit, 'BIASN.p', 'VBIASN');
  renameNetAt(circuit, 'BIASP.p', 'VBIASP');
  return circuit;
}

test('decomposes a cascoded common-source stage with a cascoded current-mirror load into a proven parallel Zout', () => {
  const report = analyzeSmallSignalV2(cascodeWithCascodeLoad(), { acGrounds: ['VBIASN', 'VBIASP'] });
  assert.equal(report.ok, true, report.error);
  assert.ok(report.output.equivalence, 'Zout should carry a proven-parallel decomposition');
  assert.equal(report.output.equivalence.operands.length, 2);

  const values = { gm1: 2, gm2: 3, gm3: 1.7, ro1: 10, ro2: 5, ro3: 6.67, ro4: 20, gmb2: 0, gmb3: 0 };
  function evaluate(node) {
    if (node.kind === 'number') return Number(node.numerator) / Number(node.denominator);
    if (node.kind === 'symbol') return values[node.name];
    if (node.kind === 'power') return evaluate(node.base) ** node.exponent;
    if (node.kind === 'multiply') return node.factors.reduce((product, factor) => product * evaluate(factor), 1);
    return node.terms.reduce((sum, term) => sum + evaluate(term), 0);
  }
  const zout = report.exact.Zout.expression;
  const numeric = evaluate(zout.numerator) / evaluate(zout.denominator);
  const { ro1, ro2, ro3, ro4 } = values;
  const nmosCascode = ro1 + ro2 + values.gm2 * ro1 * ro2;
  const pmosCascode = ro3 + ro4 + values.gm3 * ro3 * ro4;
  const expected = 1 / (1 / nmosCascode + 1 / pmosCascode);
  assert.ok(Math.abs(numeric - expected) < 1e-9 * expected, `${numeric} !== ${expected}`);
});
