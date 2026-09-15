import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { analyzeSmallSignalV2 } from '../src/core/analysis/engine.js';
import { formatExpression } from '../src/core/analysis/rational.js';

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
  if (node.kind === 'number') return Number(node.numerator) / Number(node.denominator);
  if (node.kind === 'symbol') return values[node.name];
  if (node.kind === 'power') return evaluate(node.base, values) ** node.exponent;
  if (node.kind === 'multiply') return node.factors.reduce((product, factor) => product * evaluate(factor, values), 1);
  return node.terms.reduce((sum, term) => sum + evaluate(term, values), 0);
}

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

test('renders the single-pole Miller-approximated transfer function using R_D || r_o1 as the load, not R_D alone', () => {
  const report = analyzeSmallSignalV2(commonSourceWithFeedback(), { input: 'IN.p', output: 'OUT.p' });
  assert.equal(report.ok, true, report.error);
  // -gm1*RD*ro1 / (s*CGD*RD*ro1 + RD + ro1) factors to -gm1 / (s*CGD + 1/(RD||ro1));
  // r_o1 must survive here (g_m r_o >> 1 only licenses dropping a bare "+1"
  // beside a gm*ro product, never dropping a finite r_o next to an unrelated
  // resistor like R_D — that would silently assume r_o -> infinity).
  assert.match(
    report.transfer.ac.equation,
    /A_v\(s\) = -\\frac\{g_\{m1\} \\, R_\{D\} \\, r_\{o1\}\}\{s \\, C_\{GD\} \\, R_\{D\} \\, r_\{o1\} \+ R_\{D\} \+ r_\{o1\}\}/,
  );
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
