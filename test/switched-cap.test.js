import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { runCommand } from '../src/core/commands.js';
import { removeTimingDiagram } from '../src/core/timing-diagram.js';
import { analyzeSwitchedCap, switchedCapPhases } from '../src/core/analysis/switched-cap.js';
import { integer, rationalAt, substituteRational } from '../src/core/analysis/rational.js';

/**
 * The stray-insensitive SC integrator: in φ1 S1 samples V_IN onto CS while
 * S3 grounds CS's other plate; in φ2 S2 grounds CS's input plate and S4
 * dumps its charge into U1's virtual ground, where CF integrates it.
 * `inverting`: CS's right plate goes to the virtual ground in φ1 and to
 * ground in φ2 instead -- the inverting integrator.
 */
function integrator({ inverting = false, extra = [], timing = true } = {}) {
  const circuit = new Circuit();
  const p1 = '"$\\varphi_1$"';
  const p2 = '"$\\varphi_2$"';
  const lines = [
    'add input VIN --at -1400 0', 'add output VOUT --at 600 0',
    `add switch_open S1 --at -1200 0 --value ${p1}`,
    'add capacitor CS --at -800 0',
    `add switch_open S2 --at -1000 400 --value ${p2}`,
    `add switch_open S3 --at -600 400 --value ${inverting ? p2 : p1}`,
    `add switch_open S4 --at -400 0 --value ${inverting ? p1 : p2}`,
    'add opamp U1 --at 0 0', 'add capacitor CF --at 0 -400',
    'add ground G1 --at -1000 800', 'add ground G2 --at -600 800', 'add ground G3 --at -400 400',
    'connect VIN.p S1.a', 'connect S1.b CS.a', 'connect CS.a S2.a', 'connect S2.b G1.gnd',
    'connect CS.b S3.a', 'connect S3.b G2.gnd', 'connect CS.b S4.a', 'connect S4.b U1.im',
    'connect U1.ip G3.gnd', 'connect CF.a U1.im', 'connect CF.b U1.o', 'connect U1.o VOUT.p',
    ...extra,
  ];
  for (const line of lines) runCommand(circuit, line);
  if (timing) runCommand(circuit, 'timing 1=10 2=01');
  return circuit;
}

test('the clock\'s states come from the timing diagram, each with the switches closed in it', () => {
  const phases = switchedCapPhases(integrator());
  assert.equal(phases.ok, true, phases.error);
  assert.equal(phases.source, 'timing');
  assert.deepEqual(phases.states.map((state) => [...state.closed].sort()), [['S1', 'S3'], ['S2', 'S4']]);
});

test('the stray-insensitive integrator: (CS/CF) z^-1 / (1 - z^-1) read at the end of φ1, without the delay at φ2', () => {
  const circuit = integrator();
  const atPhi1 = analyzeSwitchedCap(circuit, { readout: 0 });
  assert.equal(atPhi1.ok, true, atPhi1.error);
  assert.equal(atPhi1.variable, 'z');
  assert.equal(atPhi1.tex, '\\frac{\\frac{C_{S}}{C_{F}} z^{-1}}{1 - z^{-1}}');
  // By default it is read at the end of the last state (φ2): no delay.
  const atPhi2 = analyzeSwitchedCap(circuit);
  assert.equal(atPhi2.readout, 1);
  assert.equal(atPhi2.tex, '\\frac{\\frac{C_{S}}{C_{F}}}{1 - z^{-1}}');
  // In numbers: at z = -1 (half the sample rate), CS = 2, CF = 1:
  // 2 z^-1 / (1 - z^-1) = -2 / 2 = -1.
  const numbered = substituteRational(atPhi1.value, new Map([['CS', integer(2)], ['CF', integer(1)]]));
  const at = rationalAt(numbered, integer(-1));
  assert.equal(at.numerator, -1n);
  assert.equal(at.denominator, 1n);
});

test('the inverting integrator: -(CS/CF) / (1 - z^-1) read at the end of φ1', () => {
  const result = analyzeSwitchedCap(integrator({ inverting: true }), { readout: 0 });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.tex, '\\frac{-\\frac{C_{S}}{C_{F}}}{1 - z^{-1}}');
});

test('without a timing diagram, the beats give the phases', () => {
  const circuit = integrator();
  runCommand(circuit, 'beat phases --replace');
  removeTimingDiagram(circuit);
  const result = analyzeSwitchedCap(circuit, { readout: 0 });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.source, 'beats');
  assert.equal(result.tex, '\\frac{\\frac{C_{S}}{C_{F}} z^{-1}}{1 - z^{-1}}');
});

test('what it cannot analyse it refuses, saying why', () => {
  // No clock at all.
  const unclocked = analyzeSwitchedCap(integrator({ timing: false }));
  assert.equal(unclocked.code, 'no-phases');
  // A resistor is no part of an SC circuit.
  const resistor = analyzeSwitchedCap(integrator({ extra: ['add resistor R1 --at 400 800'] }));
  assert.equal(resistor.code, 'unsupported-part');
  assert.match(resistor.error, /R1/);
  // An op-amp with no feedback has no definite output.
  const open = integrator({ extra: ['rm CF'] });
  const openResult = analyzeSwitchedCap(open);
  assert.equal(openResult.ok, false);
  assert.match(openResult.error, /no definite solution|feedback/);
  // A state that names no output to read.
  assert.equal(analyzeSwitchedCap(integrator(), { readout: 'φ9' }).code, 'readout');
});

/** The integrator twice, about a fully differential op-amp: V_INP's half
 *  into U1's im (out at op), V_INM's into ip (out at om). */
function differentialIntegrator() {
  const circuit = new Circuit();
  const p1 = '"$\\varphi_1$"';
  const p2 = '"$\\varphi_2$"';
  const half = (s, y, input, into, out) => [
    `add input ${input} --at -1400 ${y}`,
    `add switch_open S1${s} --at -1200 ${y} --value ${p1}`, `add capacitor CS${s} --at -800 ${y}`,
    `add switch_open S2${s} --at -1000 ${y + 400} --value ${p2}`, `add switch_open S3${s} --at -600 ${y + 400} --value ${p1}`,
    `add switch_open S4${s} --at -400 ${y} --value ${p2}`, `add capacitor CF${s} --at 0 ${y - 400}`,
    `add ground G1${s} --at -1000 ${y + 800}`, `add ground G2${s} --at -600 ${y + 800}`,
    `connect ${input}.p S1${s}.a`, `connect S1${s}.b CS${s}.a`, `connect CS${s}.a S2${s}.a`, `connect S2${s}.b G1${s}.gnd`,
    `connect CS${s}.b S3${s}.a`, `connect S3${s}.b G2${s}.gnd`, `connect CS${s}.b S4${s}.a`, `connect S4${s}.b U1.${into}`,
    `connect CF${s}.a U1.${into}`, `connect CF${s}.b U1.${out}`,
  ];
  for (const line of [
    'add opamp_diff U1 --at 0 1200', 'add output VOUTP --at 600 1240', 'add output VOUTM --at 600 1160',
    ...half('P', 0, 'VINP', 'im', 'op'), ...half('M', 2400, 'VINM', 'ip', 'om'),
    'connect U1.op VOUTP.p', 'connect U1.om VOUTM.p',
  ]) runCommand(circuit, line);
  runCommand(circuit, 'timing 1=10 2=01');
  return circuit;
}

test('matched halves, their capacitors valued C_S and C_F: each output half the integrator, first order', () => {
  const circuit = differentialIntegrator();
  for (const half of ['P', 'M']) {
    runCommand(circuit, `value CS${half} C_S`);
    runCommand(circuit, `value CF${half} C_F`);
  }
  const plus = analyzeSwitchedCap(circuit, { input: 'VINP', output: 'VOUTP', readout: 0 });
  assert.equal(plus.ok, true, plus.error);
  assert.equal(plus.tex, '\\frac{\\frac{C_{S}}{2 \\, C_{F}} z^{-1}}{1 - z^{-1}}');
  const minus = analyzeSwitchedCap(circuit, { input: 'VINP', output: 'VOUTM', readout: 0 });
  assert.equal(minus.tex, '\\frac{-\\frac{C_{S}}{2 \\, C_{F}} z^{-1}}{1 - z^{-1}}');
});

test('a fully differential op-amp: its outputs symmetric about ground, each half the differential result', () => {
  const circuit = differentialIntegrator();
  const plus = analyzeSwitchedCap(circuit, { input: 'VINP', output: 'VOUTP', readout: 0 });
  assert.equal(plus.ok, true, plus.error);
  const minus = analyzeSwitchedCap(circuit, { input: 'VINP', output: 'VOUTM', readout: 0 });
  assert.equal(minus.ok, true, minus.error);
  // Both halves' capacitors equal (CS, CF): each output half of
  // (CS/CF) z^-1 / (1 - z^-1), the two opposite.
  const at = (result) => {
    const numbered = substituteRational(result.value, new Map([['CSP', integer(2)], ['CSM', integer(2)], ['CFP', integer(1)], ['CFM', integer(1)]]));
    const value = rationalAt(numbered, integer(-1));
    return Number(value.numerator) / Number(value.denominator);
  };
  assert.equal(at(plus), -0.5);
  assert.equal(at(minus), 0.5);
});

test('the switched-capacitor settings are saved with the design, and only sound ones', () => {
  const circuit = integrator();
  circuit.analysisValues.sc = { input: 'V_{IN}', output: 'V_{OUT}', readout: '$\\varphi_1$', values: { CS: 2, CF: 1, bad: -1, 'not a name': 3 } };
  const back = Circuit.fromJSON(circuit.toJSON()).analysisValues.sc;
  assert.deepEqual(back, { input: 'V_{IN}', output: 'V_{OUT}', readout: '$\\varphi_1$', values: { CS: 2, CF: 1 } });
  // Nothing set, nothing saved.
  assert.equal('analysisValues' in integrator().toJSON(), false);
});
