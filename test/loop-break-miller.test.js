import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSmallSignalV2, numericLoopGain } from '../src/core/analysis/engine.js';
import { numericCoefficients, polynomialRoots } from '../src/core/analysis/bode.js';
import { millerOta } from './helpers/miller-ota.js';

// Apart from loop-break.test.js: each Miller OTA loop takes seconds to
// solve, and a file of its own runs beside the others.
test('a loop too large for its symbols is solved at the same numbers wherever it breaks: the design\'s loads stay loads', () => {
  const circuit = millerOta();
  // A budget too small for the symbols: T solved at the sketch's values.
  const loop = (loopGain) => analyzeSmallSignalV2(circuit, { input: 'VINP', output: 'VOUT', loopGain, ignoreBodyEffect: true, loopGainOperations: 2000 }).loop;
  const [element, gate] = [loop({ element: 'M5' }), loop({ at: 'M5.g' })];
  for (const result of [element, gate]) {
    assert.equal(result.ok, true, result.error);
    assert.equal(result.numeric, true);
  }
  // In numbers, as decimals: the denominator's constant term 1, four
  // significant digits, each before its power of s.
  for (const result of [element, gate]) assert.match(result.equations[0], /^T\(s\) = \\frac\{[\d.]+ \\, s\}\{[\d.]+ \\, s\^\{2\} \+ [\d.]+ \\, s \+ 1\}$/);
  // C_L and C_M sit on the output: loads, ten units, also when the break
  // is solved to its return net (VO1).
  assert.deepEqual(gate.values, element.values);
  assert.equal(gate.values.CL, 10);
  assert.ok(gate.outputComponents.includes('CL'));
  // M5's gate draws no current: one T, its common factors canceled, so
  // the same poles (in the left half-plane) from either break.
  const coefficients = (list) => numericCoefficients(list, element.values);
  const roots = (result) => polynomialRoots(coefficients(result.exact.denominatorCoefficients)).map((root) => root.re).sort((a, b) => a - b);
  assert.equal(roots(gate).length, roots(element).length);
  roots(gate).forEach((root, i) => assert.ok(Math.abs(root - roots(element)[i]) <= 1e-9 * Math.abs(root), `${root} vs ${roots(element)[i]}`));
  assert.ok(roots(element).every((root) => root < 0));
  // The sliders' model for the break reads the same loads.
  const model = numericLoopGain(circuit, { input: 'VINP', output: 'VOUT', ignoreBodyEffect: true, loopGain: { at: 'M5.g' } });
  assert.equal(model.ok, true, model.error);
  assert.ok(model.outputComponents.has('CL') && !model.outputComponents.has('RM'));
});
