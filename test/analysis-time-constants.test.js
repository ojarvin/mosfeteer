import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { buildExactAnalysisPipeline } from '../src/core/analysis/pipeline.js';
import { createRationalOps } from '../src/core/analysis/algebra-ops.js';
import { poleTimeConstants } from '../src/core/analysis/time-constants.js';
import { analyzeSmallSignalV2, numericSmallSignal } from '../src/core/analysis/engine.js';
import { adaptCombinedReport } from '../src/core/analysis/report-adapter.js';

function build(parts, nets) {
  const circuit = new Circuit();
  parts.forEach(([type, refdes], i) => circuit.addComponent(type, { refdes, x: i * 400, y: 0 }));
  for (const [name, ...refs] of nets) circuit._createNet(name).terminals = refs.map((ref) => circuit.resolveTerm(ref));
  return circuit;
}

/** A common-source stage driven through R_S, with C_gs, C_gd and C_L drawn. */
function commonSource(extra = [], extraNets = []) {
  return build(
    [['input', 'VIN'], ['output', 'VOUT'], ['nmos', 'M1'], ['resistor', 'RD'], ['resistor', 'RS'], ['capacitor', 'CGS'], ['capacitor', 'CGD'], ['capacitor', 'CL'], ['ground', 'GND'], ['supply', 'VDD'], ...extra],
    [['VIN', 'VIN.p', 'RS.a'], ['G', 'RS.b', 'M1.g', 'CGS.a', 'CGD.a'], ['VOUT', 'M1.d', 'RD.a', 'CGD.b', 'CL.a', 'VOUT.p'], ['VSS', 'M1.s', 'GND.gnd', 'CGS.b', 'CL.b'], ['VDD', 'RD.b', 'VDD.p'], ...extraNets],
  );
}

/** The time constants at whole-number values (unlisted symbols 1), exact. */
function atValues(circuit, values) {
  const ops = createRationalOps({ variable: 's' });
  const number = (n) => Array.from({ length: n }).reduce((sum) => ops.add(sum, ops.one), ops.zero);
  const s = ops.s();
  const pipeline = buildExactAnalysisPipeline(circuit, {
    input: 'VIN', output: 'VOUT', ops, s, ignoreBodyEffect: true, millerApproximation: false, networkReduction: false, solve: false,
    valueOf: (value) => (value?.kind ? value : number(values[value] ?? 1)),
  });
  const result = poleTimeConstants(pipeline, ops, s);
  const equals = (value, numerator, denominator = 1) => ops.isZero(ops.sub(ops.mul(value, number(denominator)), number(numerator)));
  return { result, equals };
}

test('b1 is each capacitor\'s C R, the others open; b2 the pairs, one shorted: the textbook common-source stage', () => {
  // R_O = R_D || r_o = 2.1; C_gd sees R_S + R_O + g_m R_S R_O.
  const { result, equals } = atValues(commonSource(), { gm1: 2, ro1: 7, RD: 3, RS: 5, CGS: 11, CGD: 13, CL: 17 });
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(result.capacitors.map((cap) => cap.component), ['CGS', 'CGD', 'CL']);
  assert.ok(equals(result.capacitors[1].resistance, 281, 10));
  // 11*5 + 13*28.1 + 17*2.1 = 456.
  assert.ok(equals(result.b1, 456));
  // R_S R_O (C_gs C_gd + C_gs C_L + C_gd C_L) = 10.5 * 551.
  assert.ok(equals(result.b2, 11571, 2));
});

test('time constants refuse what they cannot sum: s elsewhere, a capacitor with no DC path', () => {
  // An inductor carries s of its own.
  const inductive = build(
    [['input', 'VIN'], ['output', 'VOUT'], ['nmos', 'M1'], ['resistor', 'RD'], ['inductor', 'L1'], ['capacitor', 'CL'], ['ground', 'GND'], ['supply', 'VDD']],
    [['VIN', 'VIN.p', 'M1.g'], ['VOUT', 'M1.d', 'RD.a', 'CL.a', 'VOUT.p'], ['X', 'RD.b', 'L1.a'], ['VSS', 'M1.s', 'GND.gnd', 'CL.b'], ['VDD', 'L1.b', 'VDD.p']],
  );
  assert.match(atValues(inductive, {}).result.error || '', /carries s of its own/);
  // A coupling capacitor into the gate: nothing but it holds the gate at DC.
  const coupled = build(
    [['input', 'VIN'], ['output', 'VOUT'], ['nmos', 'M1'], ['resistor', 'RD'], ['capacitor', 'CC'], ['ground', 'GND'], ['supply', 'VDD']],
    [['VIN', 'VIN.p', 'CC.a'], ['G', 'CC.b', 'M1.g'], ['VOUT', 'M1.d', 'RD.a', 'VOUT.p'], ['VSS', 'M1.s', 'GND.gnd'], ['VDD', 'RD.b', 'VDD.p']],
  );
  assert.match(atValues(coupled, {}).result.error || '', /sees no resistance/);
});

test('the analysis lists the time constants on request, under their own heading', () => {
  const analyze = (options) => adaptCombinedReport(analyzeSmallSignalV2(commonSource(), { input: 'VIN', output: 'VOUT', ignoreBodyEffect: true, ...options }));
  assert.equal(analyze({}).equationEntries.some((entry) => entry.group === 'timeConstants'), false, 'off until asked for');
  const rows = analyze({ timeConstants: true }).equationEntries.filter((entry) => entry.group === 'timeConstants').map((entry) => entry.result.equation);
  assert.ok(rows.includes('\\tau_{C_{GS}} = C_{GS} \\, R_{S}'));
  assert.ok(rows.includes('b_{1} = \\tau_{C_{GS}} + \\tau_{C_{GD}} + \\tau_{C_{L}}'));
  assert.ok(rows.includes('p_{0} \\approx -\\frac{1}{b_{1}}'));
  assert.ok(rows.some((row) => row.startsWith('b_{2} = ')));
});

test('a capacitor straight across the source has a zero time constant and drops out, pairs and all', () => {
  // The gate driven straight from the input: C_gs sees no resistance.
  const driven = build(
    [['input', 'VIN'], ['output', 'VOUT'], ['nmos', 'M1'], ['resistor', 'RD'], ['capacitor', 'CGS'], ['capacitor', 'CGD'], ['capacitor', 'CL'], ['ground', 'GND'], ['supply', 'VDD']],
    [['VIN', 'VIN.p', 'M1.g', 'CGS.a', 'CGD.a'], ['VOUT', 'M1.d', 'RD.a', 'CGD.b', 'CL.a', 'VOUT.p'], ['VSS', 'M1.s', 'GND.gnd', 'CGS.b', 'CL.b'], ['VDD', 'RD.b', 'VDD.p']],
  );
  const { result, equals } = atValues(driven, { ro1: 7, RD: 3, CGD: 13, CL: 17 });
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(result.dropped.map((cap) => cap.component), ['CGS']);
  // C_gd and C_L both see R_O = 2.1, and shorting one puts the other across the source.
  assert.ok(equals(result.b1, 63));
  assert.ok(equals(result.b2, 0));
});

/** A common-source amplifier: C1 coupling the input onto R_G at the gate,
 *  C_S bypassing R_S, C2 coupling the drain into R_L. */
function coupledAmplifier() {
  return build(
    [['input', 'VIN'], ['output', 'VOUT'], ['nmos', 'M1'], ['capacitor', 'C1'], ['resistor', 'RG'], ['resistor', 'RS'], ['capacitor', 'CS'], ['resistor', 'RD'], ['capacitor', 'C2'], ['resistor', 'RL'], ['ground', 'GND'], ['supply', 'VDD']],
    [['VIN', 'VIN.p', 'C1.a'], ['G', 'C1.b', 'RG.a', 'M1.g'], ['S', 'M1.s', 'RS.a', 'CS.a'], ['D', 'M1.d', 'RD.a', 'C2.a'], ['VOUT', 'C2.b', 'RL.a', 'VOUT.p'],
      ['VSS', 'RG.b', 'RS.b', 'CS.b', 'RL.b', 'GND.gnd'], ['VDD', 'RD.b', 'VDD.p']],
  );
}

test('short-circuit time constants: each capacitor with the others shorted, their inverses summing to the poles\' sum exactly', () => {
  const values = { gm1: 2, gmb1: 0, ro1: 50, RG: 7, RS: 3, RD: 10, RL: 20, C1: 1, CS: 1, C2: 1 };
  const { result, equals } = atValues(coupledAmplifier(), values);
  assert.equal(result.ok, true, result.error);
  const r = Object.fromEntries(result.shorted.map(({ cap, resistance }) => [cap.component, resistance]));
  // C1 sees R_G; C2 sees R_L + R_D || r_o = 20 + 50/6; C_S sees
  // R_S || (r_o + R_D || R_L)/(1 + g_m r_o) = 3 || (170/3)/101 = 510/1079.
  assert.ok(equals(r.C1, 7));
  assert.ok(equals(r.C2, 170, 6));
  assert.ok(equals(r.CS, 510, 1079), 'the bypass capacitor');
  // The identity, exactly: sum 1/(C_i R_i^s) is b_{n-1}/b_n, the sum of the
  // poles' magnitudes -- here every pole of A_v.
  const sum = 1 / 7 + 6 / 170 + 1079 / 510;
  const model = numericSmallSignal(coupledAmplifier(), { input: 'VIN', output: 'VOUT', ignoreBodyEffect: true });
  const poles = model.at(values).quantities.transfer.poles;
  assert.equal(poles.length, 3);
  const poleSum = poles.reduce((total, pole) => total + Math.hypot(pole.re, pole.im), 0);
  assert.ok(Math.abs(poleSum / sum - 1) < 1e-9, `${poleSum} vs ${sum}`);
});
