import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { analyzeSmallSignalV2, numericSmallSignal } from '../src/core/analysis/engine.js';
import { adaptCombinedReport } from '../src/core/analysis/report-adapter.js';
import { eigenvalues, pencilRoots } from '../src/core/analysis/eigen.js';
import { numericCoefficients, responseAt, sketchParameters, sketchValues } from '../src/core/analysis/bode.js';
import { smallSignalGoldenCorpus } from './fixtures/small-signal-golden.js';

const near = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
const db = (h) => 20 * Math.log10(Math.hypot(h.re, h.im));

function net(circuit, name, ...refs) {
  const result = circuit._createNet(name);
  result.terminals = refs.map((ref) => circuit.resolveTerm(ref));
  return result;
}

/** Every parameter at its sketch value, varied a little so nothing cancels by symmetry. */
function valuesFor(model) {
  const parameters = sketchParameters(new Set(Object.keys(model.provenance)), model.provenance, { outputComponents: model.outputComponents });
  return Object.fromEntries(Object.entries(sketchValues(parameters, {})).map(([name, value], i) => [name, value * (1 + 0.37 * Math.sin(i + 1))]));
}

test('eigenvalues and the roots of det(A0 + s A1)', () => {
  // The companion matrix of (s + 1)(s + 2)(s + 3).
  const roots = eigenvalues([[0, 1, 0], [0, 0, 1], [-6, -11, -6]]).map((root) => root.re).sort((a, b) => a - b);
  roots.forEach((root, i) => near(root, [-3, -2, -1][i]));
  const rotation = eigenvalues([[0, -1], [1, 0]]);
  assert.deepEqual(rotation.map((root) => Math.abs(root.im)), [1, 1]);
  // Two-node RC ladder, each node a unit capacitor: the poles are -eig(G).
  const ladder = pencilRoots([[2, -1], [-1, 1]], [[1, 0], [0, 1]]).map((root) => root.re).sort((a, b) => a - b);
  near(ladder[0], -(3 + Math.sqrt(5)) / 2);
  near(ladder[1], -(3 - Math.sqrt(5)) / 2);
  // One capacitor only (A1 singular): det = 2(1 + s) - 1, the one finite root -1/2.
  const single = pencilRoots([[2, -1], [-1, 1]], [[0, 0], [0, 1]]);
  assert.equal(single.length, 1);
  near(single[0].re, -0.5);
});

const SLOW_WITH_CAPACITANCES = new Set(['explicit-bulk-moving-source', 'source-degeneration']);

test('the numeric model agrees with the exact solve over the whole corpus', () => {
  let checked = 0;
  for (const settings of [{}, { parasitics: true, ignoreBodyEffect: false, millerApproximation: false }]) {
    for (const entry of smallSignalGoldenCorpus) {
      // Two circuits take seconds to solve symbolically with every capacitance.
      if (settings.parasitics && SLOW_WITH_CAPACITANCES.has(entry.id)) continue;
      const circuit = entry.build();
      const options = { ...entry.ports, ...settings };
      const raw = analyzeSmallSignalV2(circuit, options);
      if (!raw.ok) continue;
      const report = adaptCombinedReport(raw);
      const model = numericSmallSignal(circuit, options);
      assert.equal(model.ok, true, `${entry.id}: ${model.error}`);
      const values = valuesFor(model);
      const numeric = model.at(values);
      assert.equal(numeric.ok, true, `${entry.id}: ${numeric.error}`);
      for (const key of ['transfer', 'input', 'output']) {
        const exact = report.reports?.[key]?.exact;
        if (!exact?.numeratorCoefficients) continue;
        const num = numericCoefficients(exact.numeratorCoefficients, values);
        const den = numericCoefficients(exact.denominatorCoefficients, values);
        const quantity = numeric.quantities[key];
        if (num.every((value) => value === 0)) {
          assert.equal(quantity?.zero, true, `${entry.id} ${key} is zero`);
          continue;
        }
        for (let e = -4; e <= 4; e += 0.5) {
          const w = 10 ** e;
          const expected = db(responseAt(num, den, w));
          near(db(quantity.response(w)), expected, 1e-6);
          // The roots and their gain give the same curve.
          near(db(responseAt(quantity.numerator, quantity.denominator, w)), expected, 1e-4);
        }
        checked += 1;
      }
    }
  }
  assert.ok(checked >= 85, `checked ${checked}`);
});

function inverting(model, capacitor) {
  const circuit = new Circuit();
  const parts = [['input', 'VIN'], ['output', 'VOUT'], ['resistor', 'R1'], ['resistor', 'R2'], ['opamp', 'U1'], ['ground', 'GND'], ...(capacitor ? [['capacitor', 'C1']] : [])];
  parts.forEach(([type, refdes], i) => circuit.addComponent(type, { refdes, x: i * 400, y: 0 }));
  net(circuit, 'VIN', 'VIN.p', 'R1.a');
  net(circuit, 'X', 'R1.b', 'R2.a', 'U1.im', ...(capacitor ? ['C1.a'] : []));
  net(circuit, 'VOUT', 'R2.b', 'U1.o', 'VOUT.p', ...(capacitor ? ['C1.b'] : []));
  net(circuit, 'VSS', 'U1.ip', 'GND.gnd');
  if (model) circuit.setComponentAnalysis('U1', { model });
  return circuit;
}

test('opamps solve in numbers: ideal (folded out), finite gain, and one pole', () => {
  const at = (circuit, values) => {
    const model = numericSmallSignal(circuit, { input: 'VIN', output: 'VOUT' });
    assert.equal(model.ok, true, model.error);
    const result = model.at(values);
    assert.equal(result.ok, true, result.error);
    return result.quantities.transfer;
  };
  // Ideal with C1 across R2: -R2/R1 / (1 + s R2 C1), one pole at -1/(R2 C1).
  const ideal = at(inverting(null, true), { R1: 1, R2: 3, C1: 2 });
  assert.equal(ideal.poles.length, 1);
  near(ideal.poles[0].re, -1 / 6);
  near(db(ideal.response(1e-6)), 20 * Math.log10(3), 1e-6);
  // Finite gain: -R2/R1 A / (A + 1 + R2/R1).
  const finite = at(inverting('finite-gain'), { R1: 1, R2: 3, A1: 100 });
  near(db(finite.response(1)), 20 * Math.log10(300 / 104), 1e-9);
  // One pole, omega_t / s: the closed loop's pole at omega_t R1 / (R1 + R2).
  const pole = at(inverting('gbw'), { R1: 1, R2: 3, '\\omega_{t1}': 10 });
  assert.equal(pole.poles.length, 1);
  near(pole.poles[0].re, -2.5);
});

/** A two-stage Miller OTA as a unity-gain buffer, device capacitances on:
 *  far past the symbolic solve's budget. */
function millerBuffer() {
  const circuit = new Circuit();
  const add = (type, refdes, x, y) => circuit.addComponent(type, { refdes, x, y });
  add('input', 'VINP', -800, 0); add('supply', 'VDD', 0, -800); add('ground', 'GND', 0, 800);
  add('nmos', 'M1', -400, 0); add('nmos', 'M2', 400, 0); add('pmos', 'M3', -400, -400); add('pmos', 'M4', 400, -400);
  add('nmos', 'M5', 0, 400); add('pmos', 'M6', 1200, -400); add('nmos', 'M7', 1200, 400);
  add('capacitor', 'CC', 800, -200); add('capacitor', 'CL', 1600, 400); add('output', 'VOUT', 1600, 0);
  net(circuit, 'V_{DD}', 'VDD.p', 'M3.s', 'M4.s', 'M6.s');
  net(circuit, 'V_{SS}', 'GND.gnd', 'M5.s', 'M7.s', 'CL.b');
  net(circuit, 'VINP', 'VINP.p', 'M1.g');
  net(circuit, 'X', 'M1.d', 'M3.d', 'M3.g', 'M4.g');
  net(circuit, 'Y', 'M2.d', 'M4.d', 'M6.g', 'CC.a');
  net(circuit, 'OUT', 'M6.d', 'M7.d', 'CC.b', 'CL.a', 'VOUT.p', 'M2.g');
  net(circuit, 'TAIL', 'M1.s', 'M2.s', 'M5.d');
  net(circuit, 'VB', 'M5.g', 'M7.g');
  return circuit;
}

test('a two-stage amplifier with its capacitances plots in numbers, supply rejection included', () => {
  const circuit = millerBuffer();
  const model = numericSmallSignal(circuit, { input: 'VDD', output: 'OUT', acGrounds: ['VB'], parasitics: true });
  assert.equal(model.ok, true, model.error);
  // Sliders for what the ports reach: M5 and M7's gate capacitances sit
  // between two AC grounds and get none, though they still need values.
  assert.equal(model.reached.has('Cgs1'), true);
  assert.equal(model.reached.has('Cgs5'), false);
  assert.ok('Cgs5' in model.provenance);
  const result = model.at(valuesFor(model));
  assert.equal(result.ok, true, result.error);
  const supply = result.quantities.transfer;
  // Two stages, C_C, C_L, and every device's C_gs and C_gd: several poles.
  assert.ok(supply.poles.length >= 4, `${supply.poles.length} poles`);
  // The curve rebuilt from the roots is the solved one.
  for (const w of [1e-4, 1e-2, 1, 10]) near(db(responseAt(supply.numerator, supply.denominator, w)), db(supply.response(w)), 1e-4);
  // The symbolic solve of the same request runs out of budget: the plot does not depend on it.
  assert.equal(analyzeSmallSignalV2(circuit, { input: 'VDD', output: 'OUT', acGrounds: ['VB'], parasitics: true }).ok, false);
});
