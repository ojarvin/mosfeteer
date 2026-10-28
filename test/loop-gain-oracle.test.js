/**
 * The circuit loop gain against an independent numeric MNA solve
 * (helpers/numeric-mna-oracle.js): each circuit is described once, built
 * both as a drawing and as the oracle's small-signal netlist (a MOS as
 * g_m v_gs from drain to source beside r_o; current sources open; rails
 * and inputs at AC ground), and broken at the same terminal -- lifted onto
 * a test source of 1 V -- so T = -v(return). The analysis's T(jω), its
 * crossover and phase margin, and the closed loop must agree with it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { numericLoopGain, numericSmallSignal } from '../src/core/analysis/engine.js';
import { bodeSketch } from '../src/core/analysis/bode.js';
import { nodeVoltage, solveNumericMna } from './helpers/numeric-mna-oracle.js';

const AC_GROUND = new Set(['VSS', 'VDD', 'VB', 'VBN', 'VBP']);

/** `parts`: [type, refdes, { terminal: net }]. */
function drawing(parts) {
  const circuit = new Circuit();
  const nets = new Map();
  parts.forEach(([type, refdes, terminals], i) => {
    circuit.addComponent(type, { refdes, x: (i % 8) * 400, y: Math.floor(i / 8) * 400 });
    for (const [term, name] of Object.entries(terminals)) {
      if (!nets.has(name)) nets.set(name, []);
      nets.get(name).push(`${refdes}.${term}`);
    }
  });
  for (const [name, refs] of nets) circuit._createNet(name).terminals = refs.map((ref) => circuit.resolveTerm(ref));
  return circuit;
}

/** The oracle's netlist at `values`, `lift` ('M2.g') moved onto a 1 V test
 *  source (null: the loop closed, `drive` the input's 1 V instead). */
function oracleNetlist(parts, values, { lift = null, input = null } = {}) {
  const node = (name) => (AC_GROUND.has(name) || name === input && lift ? '0' : name);
  const elements = [];
  for (const [type, refdes, t] of parts) {
    const n = refdes.replace(/^\D+/, '');
    const at = (term) => (lift === `${refdes}.${term}` ? 'TEST' : node(t[term]));
    if (type === 'nmos' || type === 'pmos') {
      elements.push({ type: 'vccs', positive: at('d'), negative: at('s'), controlPositive: at('g'), controlNegative: at('s'), transconductance: values[`gm${n}`] });
      elements.push({ type: 'resistor', positive: at('d'), negative: at('s'), resistance: values[`ro${n}`] });
    } else if (type === 'resistor') elements.push({ type: 'resistor', positive: at('a'), negative: at('b'), resistance: values[refdes] });
    else if (type === 'capacitor') elements.push({ type: 'capacitor', positive: at('a'), negative: at('b'), capacitance: values[refdes] });
  }
  if (lift) elements.push({ type: 'voltage-source', id: 'VT', positive: 'TEST', negative: '0', value: 1 });
  else elements.push({ type: 'voltage-source', id: 'VS', positive: input, negative: '0', value: 1 });
  return elements;
}

const oracleT = (parts, values, lift, ret, input, omega) => {
  const v = nodeVoltage(solveNumericMna(oracleNetlist(parts, values, { lift, input }), omega), ret);
  return { re: -v.re, im: -v.im };
};
const near = (a, b, tolerance = 1e-7) => Math.hypot(a.re - b.re, a.im - b.im) <= tolerance * Math.max(1e-12, Math.hypot(b.re, b.im));
const OMEGAS = [1e-6, 1e-3, 1e-2, 0.1, 1, 10, 100];

/** The crossover and phase margin of T(jω) by bisection on |T| = 1. */
function oracleMargin(T) {
  const mag = (w) => Math.hypot(T(w).re, T(w).im);
  let [lo, hi] = [1e-9, 1e9];
  for (let i = 0; i < 200; i++) { const mid = Math.sqrt(lo * hi); if (mag(mid) > 1) lo = mid; else hi = mid; }
  const w = Math.sqrt(lo * hi);
  let phase = (Math.atan2(T(w).im, T(w).re) * 180) / Math.PI;
  if (phase > 0) phase -= 360;
  return { w, margin: 180 + phase };
}

/** The analysis's T at `values` against the oracle's, over frequency. */
function checkBreak(parts, values, { input, output, at, lift, ret }) {
  const model = numericLoopGain(drawing(parts), { input, output, ignoreBodyEffect: true, loopGain: { at } });
  assert.equal(model.ok, true, `${at}: ${model.error}`);
  const result = model.at(values);
  assert.equal(result.ok, true, result.error);
  const loop = result.quantities.loop;
  for (const omega of OMEGAS) {
    const expected = oracleT(parts, values, lift, ret, input, omega);
    assert.ok(near(loop.response(omega), expected), `${at} at ω ${omega}: ${JSON.stringify(loop.response(omega))} vs ${JSON.stringify(expected)}`);
  }
  return loop;
}

test('a shunt-feedback common-source stage: T = g_m R_S/(R_F + R_S) through R_D || r_o || (R_F + R_S)', () => {
  const parts = [['input', 'VIN', { p: 'VIN' }], ['output', 'VOUT', { p: 'VOUT' }], ['nmos', 'M1', { g: 'G', d: 'VOUT', s: 'VSS' }],
    ['resistor', 'RS', { a: 'VIN', b: 'G' }], ['resistor', 'RF', { a: 'G', b: 'VOUT' }], ['resistor', 'RD', { a: 'VOUT', b: 'VDD' }],
    ['capacitor', 'CL', { a: 'VOUT', b: 'VSS' }], ['ground', 'GND', { gnd: 'VSS' }], ['supply', 'VDD', { p: 'VDD' }]];
  const values = { gm1: 2, ro1: 50, RS: 3, RF: 20, RD: 10, CL: 0.5 };
  const loop = checkBreak(parts, values, { input: 'VIN', output: 'VOUT', at: 'M1.g', lift: 'M1.g', ret: 'G' });
  // The hand result at DC.
  const parallel = 1 / (1 / values.RD + 1 / values.ro1 + 1 / (values.RF + values.RS));
  assert.ok(Math.abs(loop.response(1e-12).re - (values.gm1 * values.RS) / (values.RF + values.RS) * parallel) < 1e-9);
});

/** A 5T OTA (NMOS pair, PMOS mirror) with C_L, closed through `feedback`. */
const fiveT = (feedback) => [['input', 'VIN', { p: 'VIN' }], ['output', 'VOUT', { p: 'VOUT' }],
  ['nmos', 'M1', { g: 'VIN', d: 'X', s: 'TAIL' }], ['nmos', 'M2', { g: 'N', d: 'VOUT', s: 'TAIL' }],
  ['pmos', 'M3', { g: 'X', d: 'X', s: 'VDD' }], ['pmos', 'M4', { g: 'X', d: 'VOUT', s: 'VDD' }],
  ['nmos', 'M5', { g: 'VB', d: 'TAIL', s: 'VSS' }], ['capacitor', 'CL', { a: 'VOUT', b: 'VSS' }],
  ['ground', 'GND', { gnd: 'VSS' }], ['supply', 'VDD', { p: 'VDD' }], ['supply', 'VB', { p: 'VB' }], ...feedback];

test('a 5T OTA closed through a resistive divider: the same T at the gate and at the net, as the oracle', () => {
  const parts = fiveT([['resistor', 'RF', { a: 'VOUT', b: 'N' }], ['resistor', 'RG', { a: 'N', b: 'VSS' }]]);
  const values = { gm1: 1, gm2: 1, gm3: 1.2, gm4: 1.2, gm5: 0.5, ro1: 80, ro2: 80, ro3: 60, ro4: 60, ro5: 200, RF: 30, RG: 10, CL: 4 };
  checkBreak(parts, values, { input: 'VIN', output: 'VOUT', at: 'M2.g', lift: 'M2.g', ret: 'N' });
  checkBreak(parts, values, { input: 'VIN', output: 'VOUT', at: 'N', lift: 'M2.g', ret: 'N' });
});

test('a folded-cascode OTA in unity feedback: T at M2.g and at V_OUT, as the oracle', () => {
  const parts = [['input', 'VIN', { p: 'VIN' }], ['output', 'VOUT', { p: 'VOUT' }],
    ['nmos', 'M1', { g: 'VIN', d: 'F1', s: 'TAIL' }], ['nmos', 'M2', { g: 'VOUT', d: 'F2', s: 'TAIL' }],
    ['nmos', 'M11', { g: 'VB', d: 'TAIL', s: 'VSS' }],
    ['pmos', 'M3', { g: 'VBP', d: 'F1', s: 'VDD' }], ['pmos', 'M4', { g: 'VBP', d: 'F2', s: 'VDD' }],
    ['pmos', 'M5', { g: 'VB', d: 'X', s: 'F1' }], ['pmos', 'M6', { g: 'VB', d: 'VOUT', s: 'F2' }],
    ['nmos', 'M7', { g: 'X', d: 'X', s: 'VSS' }], ['nmos', 'M8', { g: 'X', d: 'VOUT', s: 'VSS' }],
    ['capacitor', 'CL', { a: 'VOUT', b: 'VSS' }],
    ['ground', 'GND', { gnd: 'VSS' }], ['supply', 'VDD', { p: 'VDD' }], ['supply', 'VB', { p: 'VB' }], ['supply', 'VBP', { p: 'VBP' }]];
  const values = { gm1: 1, gm2: 1, gm11: 0.5, gm3: 0.8, gm4: 0.8, gm5: 1.5, gm6: 1.5, gm7: 1.1, gm8: 1.1, ro1: 60, ro2: 60, ro11: 300, ro3: 40, ro4: 40, ro5: 90, ro6: 90, ro7: 70, ro8: 70, CL: 2 };
  checkBreak(parts, values, { input: 'VIN', output: 'VOUT', at: 'M2.g', lift: 'M2.g', ret: 'VOUT' });
  checkBreak(parts, values, { input: 'VIN', output: 'VOUT', at: 'VOUT', lift: 'M2.g', ret: 'VOUT' });
});

test('a two-stage Miller OTA as a buffer: its global loop around the local one, the crossover and phase margin, and the closed loop, as the oracle', () => {
  // NMOS pair, PMOS mirror, a PMOS common-source second stage, R_M C_M
  // compensation, C_L: the global loop through M1's gate around the local
  // one through C_M.
  const parts = [['input', 'VIN', { p: 'VIN' }], ['output', 'VOUT', { p: 'VOUT' }],
    ['nmos', 'M1', { g: 'VOUT', d: 'X', s: 'TAIL' }], ['nmos', 'M2', { g: 'VIN', d: 'Y', s: 'TAIL' }],
    ['pmos', 'M3', { g: 'X', d: 'X', s: 'VDD' }], ['pmos', 'M4', { g: 'X', d: 'Y', s: 'VDD' }],
    ['nmos', 'M5', { g: 'VB', d: 'TAIL', s: 'VSS' }],
    ['pmos', 'M6', { g: 'Y', d: 'VOUT', s: 'VDD' }], ['nmos', 'M7', { g: 'VB', d: 'VOUT', s: 'VSS' }],
    ['resistor', 'RM', { a: 'Y', b: 'Z' }], ['capacitor', 'CM', { a: 'Z', b: 'VOUT' }], ['capacitor', 'CL', { a: 'VOUT', b: 'VSS' }],
    ['ground', 'GND', { gnd: 'VSS' }], ['supply', 'VDD', { p: 'VDD' }], ['supply', 'VB', { p: 'VB' }]];
  const values = { gm1: 1, gm2: 1, gm3: 1, gm4: 1, gm5: 0.5, gm6: 4, gm7: 2, ro1: 100, ro2: 100, ro3: 100, ro4: 100, ro5: 400, ro6: 50, ro7: 50, RM: 0.5, CM: 1, CL: 3 };
  const loop = checkBreak(parts, values, { input: 'VIN', output: 'VOUT', at: 'M1.g', lift: 'M1.g', ret: 'VOUT' });
  // The crossover and phase margin the window shows (bodeSketch), as the oracle's.
  const sketch = bodeSketch(loop.numerator, loop.denominator, { roots: { zeros: loop.zeros, poles: loop.poles }, response: loop.response });
  const expected = oracleMargin((w) => oracleT(parts, values, 'M1.g', 'VOUT', 'VIN', w));
  let phase = sketch.unityGain.phase % 360;
  if (phase > 0) phase -= 360;
  assert.ok(Math.abs(sketch.unityGain.w / expected.w - 1) < 1e-3, `ω_c ${sketch.unityGain.w} vs ${expected.w}`);
  assert.ok(Math.abs(180 + phase - expected.margin) < 0.1, `PM ${180 + phase} vs ${expected.margin}`);
  assert.ok(expected.margin > 0 && expected.margin < 90, `a compensated buffer's margin: ${expected.margin}`);
  // The closed loop, from the same drawing, as the oracle's with the loop closed.
  const closed = numericSmallSignal(drawing(parts), { input: 'VIN', output: 'VOUT', ignoreBodyEffect: true });
  assert.equal(closed.ok, true, closed.error);
  const gain = closed.at(values).quantities.transfer;
  for (const omega of OMEGAS) {
    const expectedGain = nodeVoltage(solveNumericMna(oracleNetlist(parts, values, { input: 'VIN' }), omega), 'VOUT');
    assert.ok(near(gain.response(omega), expectedGain), `A_v at ω ${omega}`);
  }
});
