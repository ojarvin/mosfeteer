import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { analyzeSmallSignalV2 } from '../src/core/analysis/engine.js';
import { formatExpression } from '../src/core/analysis/rational.js';
import { smallSignalGoldenCorpus } from './fixtures/small-signal-golden.js';
import { adaptCombinedReport } from '../src/core/analysis/report-adapter.js';
import { texToMathML } from '../src/core/render.js';

function renameNetAt(circuit, terminal, name) {
  const physicalNet = circuit.netOfTerminal(terminal);
  circuit.renameNet(physicalNet, name);
}

function commonSourceWithFeedback(feedbackKind = 'capacitor') {
  const circuit = new Circuit();
  circuit.addComponent('input', { refdes: 'IN', x: -240, y: 0 });
  circuit.addComponent('output', { refdes: 'OUT', x: 240, y: -80 });
  circuit.addComponent('nmos', { refdes: 'M1', x: 0, y: 0 });
  circuit.addComponent('resistor', { refdes: 'RD', x: 0, y: -160 });
  circuit.addComponent(feedbackKind, { refdes: 'CGD', x: -80, y: -80 });
  circuit.addComponent('ground', { refdes: 'GND', x: 160, y: 160 });
  circuit.addComponent('supply', { refdes: 'VDD', x: 160, y: -240 });
  circuit.connect('IN.p', 'M1.g', 'CGD.a');
  circuit.connect('M1.d', 'RD.a', 'OUT.p', 'CGD.b');
  circuit.connect('M1.s', 'GND.gnd');
  circuit.connect('RD.b', 'VDD.p');
  renameNetAt(circuit, 'IN.p', 'VIN');
  renameNetAt(circuit, 'OUT.p', 'VOUT');
  return circuit;
}

function evaluate(node, values) {
  if (node.kind === 'rational') return evaluate(node.numerator, values) / evaluate(node.denominator, values);
  if (node.kind === 'number') return Number(node.numerator) / Number(node.denominator);
  if (node.kind === 'symbol') return values[node.name];
  if (node.kind === 'power') return evaluate(node.base, values) ** node.exponent;
  if (node.kind === 'multiply') return node.factors.reduce((product, factor) => product * evaluate(factor, values), 1);
  return node.terms.reduce((sum, term) => sum + evaluate(term, values), 0);
}

function resistiveFeedbackInverter({ capacitor = false } = {}) {
  const circuit = smallSignalGoldenCorpus.find((fixture) => fixture.id === 'cmos-inverter').build();
  circuit.addComponent('resistor', { refdes: 'R1', x: 800, y: 800 });
  circuit.connect('R1.a', 'IN.p');
  circuit.connect('R1.b', 'OUT.p');
  if (capacitor) {
    circuit.addComponent('capacitor', { refdes: 'CFB', x: 800, y: 1040 });
    circuit.connect('CFB.a', 'IN.p');
    circuit.connect('CFB.b', 'OUT.p');
  }
  return circuit;
}

function close(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) <= 1e-10 * Math.max(1, Math.abs(expected)), `${message}: ${actual} != ${expected}`);
}

test('retains conducting feedback and matches exact port equations even for a small feedback resistor', () => {
  const circuit = resistiveFeedbackInverter();
  const report = analyzeSmallSignalV2(circuit, { input: 'IN.p', output: 'OUT.p', gmroLarge: false });
  assert.equal(report.ok, true, report.error);
  assert.deepEqual(report.details.pipeline.millerSubstitutions, []);
  assert.equal(report.details.pipeline.retainedFeedbackNetworks.length, 1, 'shared NMOS/PMOS bridge is handled once');
  assert.doesNotMatch(report.assumptions.join('\n'), /Miller approximation/);
  assert.match(report.smallSignalNetlist, /R_R1 V_\{IN\} V_\{OUT\} R_\{1\}/);
  assert.doesNotMatch(report.smallSignalNetlist, /UNSUPPORTED|miller-gate|miller-drain/);
  for (const R1 of [1, 50, 100, 1e3, 1e5, 1e9]) {
    const values = { gm1: 0.004, gm2: 0.006, ro1: 5e4, ro2: 8e4, R1, gmb1: 0, gmb2: 0, s: 0 };
    const G = values.gm1 + values.gm2;
    const Ro = values.ro1 * values.ro2 / (values.ro1 + values.ro2);
    const Rout = R1 * Ro / (R1 + Ro);
    close(evaluate(report.exact.Zout.expression, values), Rout, 'output with zeroed input');
    close(evaluate(report.exact.Av.expression, values), (1 / R1 - G) * Rout, 'loaded gain including feedthrough');
    close(evaluate(report.exact.Zin.expression, values), (R1 + Ro) / (1 + G * Ro), 'loaded input resistance');
  }
});

test('shows proven feedback relations and reduces the factored high-gain sum in the GUI', () => {
  const circuit = resistiveFeedbackInverter();
  const report = analyzeSmallSignalV2(circuit, { input: 'IN.p', output: 'OUT.p' });
  const gui = adaptCombinedReport(report);
  assert.match(gui.dcInputImpedance.equation, /R_\{1\} \+ \\left\(r_\{o1\} \\parallel r_\{o2\}/);
  assert.doesNotMatch(gui.dcInputImpedance.equation, /\+ 1/);
  assert.match(gui.dcInputImpedance.equation, /g_\{m1\} \+ g_\{m2\}/);
  assert.match(gui.dcOutputImpedance.equation, /r_\{o1\} \\parallel r_\{o2\} \\parallel R_\{1\}/);
  assert.doesNotMatch(gui.dcOutputImpedance.equation, /\\left/);
  assert.match(gui.dcGain.equation, /\\frac\{1\}\{R_\{1\}\}/, 'gm R1 is an independent assumption');
  const values = { gm1: 0.004, gm2: 0.006, ro1: 5e4, ro2: 8e4, R1: 50, gmb1: 0, gmb2: 0, s: 0 };
  const G = values.gm1 + values.gm2;
  const Ro = values.ro1 * values.ro2 / (values.ro1 + values.ro2);
  close(evaluate(report.input.expression, values), (values.R1 + Ro) / (G * Ro), 'selected Zin');
  const exactGui = adaptCombinedReport(analyzeSmallSignalV2(circuit, { input: 'IN.p', output: 'OUT.p', gmroLarge: false }));
  assert.match(exactGui.dcInputImpedance.equation, /\\frac.*\}\{1 \+/);
});

test('keeps a parallel RC feedback bridge coupled when it conducts at DC', () => {
  const report = analyzeSmallSignalV2(resistiveFeedbackInverter({ capacitor: true }), { input: 'IN.p', output: 'OUT.p', gmroLarge: false });
  assert.equal(report.ok, true, report.error);
  assert.deepEqual(report.details.pipeline.millerSubstitutions, []);
  assert.match(report.smallSignalNetlist, /R_R1 V_\{IN\} V_\{OUT\}/);
  assert.match(report.smallSignalNetlist, /C_CFB V_\{IN\} V_\{OUT\}/);
  const values = { gm1: 0.004, gm2: 0.006, ro1: 5e4, ro2: 8e4, R1: 50, CFB: 2e-12, gmb1: 0, gmb2: 0 };
  for (const s of [0, 1e5, 1e8]) {
    const Yfb = 1 / values.R1 + s * values.CFB;
    const Av = (Yfb - values.gm1 - values.gm2) / (1 / values.ro1 + 1 / values.ro2 + Yfb);
    close(evaluate(report.exact.Av.expression, { ...values, s }), Av, 'RC loaded gain');
    close(evaluate(report.exact.Zin.expression, { ...values, s }), 1 / (Yfb * (1 - Av)), 'RC Zin');
  }
});

test('netlist identifies the reactive feedback element and both supported Miller shunts', () => {
  const report = analyzeSmallSignalV2(commonSourceWithFeedback(), { input: 'IN.p', output: 'OUT.p', gmroLarge: false });
  assert.equal(report.ok, true, report.error);
  assert.match(report.smallSignalNetlist, /Miller bridge CGD replaced by two shunts/);
  assert.match(report.smallSignalNetlist, /Y_M1\.miller-gate V_\{IN\} 0/);
  assert.match(report.smallSignalNetlist, /Y_M1\.miller-drain V_\{OUT\} 0/);
  assert.doesNotMatch(report.smallSignalNetlist, /UNSUPPORTED/);
  const values = { gm1: 0.002, ro1: 5e4, RD: 5e3, CGD: 2e-12, s: 1e6, gmb1: 0 };
  const gain = -values.gm1 * values.ro1 * values.RD / (values.ro1 + values.RD);
  const shunts = report.details.pipeline.selected.filter((primitive) => primitive.kind === 'admittance');
  close(evaluate(shunts.find((primitive) => primitive.id.endsWith('miller-gate')).value, values), values.s * values.CGD * (1 - gain), 'Miller input admittance');
  close(evaluate(shunts.find((primitive) => primitive.id.endsWith('miller-drain')).value, values), values.s * values.CGD * (1 - 1 / gain), 'Miller output admittance');
});

function transferAt(report, values, s) {
  const expression = report.exact.Av.expression;
  return evaluate(expression.numerator, { ...values, s }) / evaluate(expression.denominator, { ...values, s });
}

test('detects and lists a Miller substitution for a gate-drain feedback capacitor', () => {
  const report = analyzeSmallSignalV2(commonSourceWithFeedback(), { input: 'IN.p', output: 'OUT.p' });
  assert.equal(report.ok, true, report.error);
  assert.deepEqual(
    report.details.pipeline.millerSubstitutions.map(({ device }) => device),
    ['M1'],
  );
  assert.match(report.assumptions.join('\n'), /Miller approximation \(M1\)/);
});

test('preserves the finite parallel load and Miller correction without assuming gm RD is large', () => {
  const report = analyzeSmallSignalV2(commonSourceWithFeedback(), { input: 'IN.p', output: 'OUT.p' });
  assert.equal(report.ok, true, report.error);
  assert.match(report.transfer.ac.equation, /-g_\{m1\}.*r_\{o1\} \\parallel R_\{D\}/);
  assert.match(report.transfer.ac.equation, /g_\{m1\} \\, R_\{D\} \+ 1/);
  const values = { gm1: 0.001, ro1: 1e6, RD: 100, CGD: 2e-12, s: 1e8 };
  const selected = report.transfer.expression;
  const actual = evaluate(selected.numerator, values) / evaluate(selected.denominator, values);
  const admittance = 1 / values.ro1 + 1 / values.RD + values.s * values.CGD * (1 + 1 / (values.gm1 * values.RD));
  assert.ok(Math.abs(actual + values.gm1 / admittance) < 1e-12);
});

test('loaded Miller stage GUI equations have no stacked fractions and its pole has one complete numerator', () => {
  const circuit = commonSourceWithFeedback();
  circuit.addComponent('capacitor', { refdes: 'CLOAD', x: 400, y: 0 });
  circuit.connect('CLOAD.a', 'OUT.p');
  circuit.connect('CLOAD.b', 'GND.gnd');
  const gui = adaptCombinedReport(analyzeSmallSignalV2(circuit, { input: 'IN.p', output: 'OUT.p' }));
  assert.equal(gui.ok, true, gui.error);
  for (const { result } of gui.equationEntries) {
    let depth = 0;
    for (const token of texToMathML(result.equation).matchAll(/<mfrac>|<\/mfrac>/g)) {
      depth += token[0] === '<mfrac>' ? 1 : -1;
      assert.ok(depth <= 1, `stacked fraction in ${result.equation}`);
    }
    assert.equal(depth, 0);
  }
  const pole = gui.equationEntries.find(({ result }) => result.equation.startsWith('p_{0}')).result.equation;
  assert.match(pole, /^p_\{0\} = -\\frac\{g_\{m1\} \\, \\left\(R_\{D\} \+ r_\{o1\}/);
  assert.match(gui.reports.transfer.equation, /\\parallel/);
});

test('matches the DC gain of the un-transformed exact circuit exactly (the bridge is open at s=0 either way)', () => {
  const withMiller = analyzeSmallSignalV2(commonSourceWithFeedback(), { input: 'IN.p', output: 'OUT.p' });
  const withoutMiller = analyzeSmallSignalV2(commonSourceWithFeedback(), { input: 'IN.p', output: 'OUT.p', millerApproximation: false });
  assert.equal(withMiller.ok, true, withMiller.error);
  assert.equal(withoutMiller.ok, true, withoutMiller.error);
  const values = { gm1: 0.02, ro1: 50000, RD: 5000, CGD: 2e-12, gmb1: 0 };
  assert.equal(transferAt(withMiller, values, 0), transferAt(withoutMiller, values, 0));
});

test('tracks the un-transformed exact circuit closely below the feedback pole and diverges above it', () => {
  const withMiller = analyzeSmallSignalV2(commonSourceWithFeedback(), { input: 'IN.p', output: 'OUT.p' });
  const withoutMiller = analyzeSmallSignalV2(commonSourceWithFeedback(), { input: 'IN.p', output: 'OUT.p', millerApproximation: false });
  const values = { gm1: 0.02, ro1: 50000, RD: 5000, CGD: 2e-12, gmb1: 0 };
  const low = 2 * Math.PI * 1e3;
  const near = withMiller, exact = withoutMiller;
  const lowRatio = transferAt(near, values, low) / transferAt(exact, values, low);
  assert.ok(Math.abs(lowRatio - 1) < 1e-3, `expected close tracking at low frequency, ratio=${lowRatio}`);
  const high = 2 * Math.PI * 1e9;
  const highRatio = transferAt(near, values, high) / transferAt(exact, values, high);
  assert.ok(Math.abs(highRatio - 1) > 0.5, `expected the approximation to diverge well above the feedback pole, ratio=${highRatio}`);
});

test('leaves the exact model untouched when no gate-drain bridge is present', () => {
  const circuit = new Circuit();
  circuit.addComponent('input', { refdes: 'IN', x: -240, y: 0 });
  circuit.addComponent('output', { refdes: 'OUT', x: 240, y: 0 });
  circuit.addComponent('nmos', { refdes: 'M1', x: 0, y: 0 });
  circuit.addComponent('resistor', { refdes: 'RD', x: 0, y: -160 });
  circuit.addComponent('ground', { refdes: 'GND', x: 160, y: 160 });
  circuit.connect('IN.p', 'M1.g');
  circuit.connect('M1.d', 'RD.a', 'OUT.p');
  circuit.connect('M1.s', 'RD.b', 'GND.gnd');
  const report = analyzeSmallSignalV2(circuit, { input: 'IN.p', output: 'OUT.p' });
  assert.equal(report.ok, true, report.error);
  assert.deepEqual(report.details.pipeline.millerSubstitutions, []);
});

test('collapses a series R+C feedback network (not just a bare capacitor) to one Miller bridge', () => {
  const circuit = new Circuit();
  circuit.addComponent('input', { refdes: 'IN', x: -240, y: 0 });
  circuit.addComponent('output', { refdes: 'OUT', x: 240, y: -80 });
  circuit.addComponent('nmos', { refdes: 'M1', x: 0, y: 0 });
  circuit.addComponent('resistor', { refdes: 'RD', x: 0, y: -160 });
  circuit.addComponent('resistor', { refdes: 'RFB', x: -400, y: -80 });
  circuit.addComponent('capacitor', { refdes: 'CFB', x: -400, y: -240 });
  circuit.addComponent('ground', { refdes: 'GND', x: 160, y: 160 });
  circuit.addComponent('supply', { refdes: 'VDD', x: 160, y: -240 });
  circuit.connect('IN.p', 'M1.g');
  circuit.connect('M1.d', 'RD.a', 'OUT.p');
  circuit.connect('M1.s', 'GND.gnd');
  circuit.connect('RD.b', 'VDD.p');
  circuit.connect('IN.p', 'RFB.a');
  circuit.connect('OUT.p', 'CFB.b');
  circuit.connect('RFB.b', 'CFB.a');
  renameNetAt(circuit, 'IN.p', 'VIN');
  renameNetAt(circuit, 'OUT.p', 'VOUT');
  const report = analyzeSmallSignalV2(circuit, { input: 'IN.p', output: 'OUT.p' });
  assert.equal(report.ok, true, report.error);
  assert.deepEqual(
    report.details.pipeline.millerSubstitutions.map(({ device }) => device),
    ['M1'],
  );
});

test('declines the bridge when its internal node is also used by an unrelated device', () => {
  const circuit = new Circuit();
  circuit.addComponent('input', { refdes: 'IN', x: -240, y: 0 });
  circuit.addComponent('output', { refdes: 'OUT', x: 240, y: -80 });
  circuit.addComponent('nmos', { refdes: 'M1', x: 0, y: 0 });
  circuit.addComponent('resistor', { refdes: 'RD', x: 0, y: -160 });
  circuit.addComponent('resistor', { refdes: 'RFB', x: -80, y: -40 });
  circuit.addComponent('capacitor', { refdes: 'CFB', x: -80, y: -120 });
  circuit.addComponent('ground', { refdes: 'GND', x: 160, y: 160 });
  circuit.addComponent('supply', { refdes: 'VDD', x: 160, y: -240 });
  // M2's own gate taps the bridge's internal node, so it is not private to
  // the M1 feedback path — Miller substitution must not remove that node.
  circuit.addComponent('nmos', { refdes: 'M2', x: -240, y: -120 });
  circuit.addComponent('resistor', { refdes: 'RD2', x: -240, y: -280 });
  circuit.connect('IN.p', 'M1.g', 'RFB.a');
  circuit.connect('M1.d', 'RD.a', 'OUT.p', 'CFB.b');
  circuit.connect('RFB.b', 'CFB.a', 'M2.g');
  circuit.connect('M1.s', 'M2.s', 'GND.gnd');
  circuit.connect('RD.b', 'RD2.b', 'VDD.p');
  circuit.connect('M2.d', 'RD2.a');
  renameNetAt(circuit, 'IN.p', 'VIN');
  renameNetAt(circuit, 'OUT.p', 'VOUT');
  const report = analyzeSmallSignalV2(circuit, { input: 'IN.p', output: 'OUT.p' });
  assert.equal(report.ok, true, report.error);
  assert.deepEqual(report.details.pipeline.millerSubstitutions, []);
});

test('still finds the Miller bridge when the gate also carries an unrelated bias branch to ground', () => {
  const circuit = commonSourceWithFeedback();
  circuit.addComponent('resistor', { refdes: 'RBIAS', x: -160, y: 80 });
  circuit.addComponent('ground', { refdes: 'GND2', x: -160, y: 160 });
  circuit.connect('RBIAS.a', 'M1.g');
  circuit.connect('RBIAS.b', 'GND2.gnd');
  const report = analyzeSmallSignalV2(circuit, { input: 'IN.p', output: 'OUT.p' });
  assert.equal(report.ok, true, report.error);
  // The bias branch itself is fine (it terminates at ground, so it's simply
  // excluded from the candidate bridge, not a privacy violation) — this
  // mainly documents that Miller substitution keeps working alongside it.
  assert.deepEqual(
    report.details.pipeline.millerSubstitutions.map(({ device }) => device),
    ['M1'],
  );
});
