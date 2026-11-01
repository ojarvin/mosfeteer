import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSmallSignalV2 } from '../src/core/analysis/engine.js';
import { expressionSymbols, numericCoefficients } from '../src/core/analysis/bode.js';
import { millerOta } from './helpers/miller-ota.js';

// Apart from loop-break.test.js: each Miller OTA loop takes seconds to
// solve, and a file of its own runs beside the others.
test('a loop open at an input port breaks there though the port is held at AC ground for the gain', () => {
  const circuit = millerOta();
  const loop = (acGrounds, extra = {}) => analyzeSmallSignalV2(circuit, { input: 'VINP', output: 'VOUT', acGrounds, loopGain: { at: 'VOUT to VINN' }, ignoreBodyEffect: true, ...extra });
  // VINN is quiet for VINP -> VOUT; for the loop it is the open input.
  const open = loop(['VINN']).loop;
  assert.equal(open.ok, true, open.error);
  const values = Object.fromEntries([...open.exact.numeratorCoefficients, ...open.exact.denominatorCoefficients].flatMap(({ coefficient }) => [...expressionSymbols(coefficient)]).map((name) => [name, /^r/.test(name) ? 100 : 1]));
  const dc = (list) => numericCoefficients(list, values)[0];
  assert.ok(dc(open.exact.numeratorCoefficients) / dc(open.exact.denominatorCoefficients) > 1, 'negative feedback through the inverting input: T(0) > 0');
  // Port quantities past their budget leave the loop gain to its own.
  const tight = loop(['VINN'], { maxOperations: 200 });
  assert.equal(tight.ok, false);
  assert.equal(tight.loop?.ok, true, tight.loop?.error);
});
