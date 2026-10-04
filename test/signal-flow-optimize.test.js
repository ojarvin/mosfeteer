import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { runCommand } from '../src/core/commands.js';
import { createCmaes, seededRandom, symmetricEigen } from '../src/core/analysis/cmaes.js';
import { normalizeOptimizeSetup } from '../src/core/analysis/optimize-setup.js';
import { fitnessOf, isFeasible, optimizationParameters, pointValues, prepareObjective, runOptimization, specIntervals, swingTestFrequencies, swingTestFrequency } from '../src/core/analysis/optimize.js';
import { prepareSimulation } from '../src/core/analysis/simulate.js';

// A short swing test, for the tests of the search itself.
const QUICK = { swingRuns: 1, swingPhases: 1, swingSamples: 2048, verifySamples: 4096 };

function diagram(lines, negatives = []) {
  const circuit = new Circuit();
  for (const line of lines) runCommand(circuit, line);
  for (const [refdes, term] of negatives) circuit.setSignalInputNegative(refdes, term, true);
  return circuit;
}

// A second-order single-bit modulator, z^-1/(1 - z^-1) integrators fed back
// through k_1 and k_2 (the textbook loop is k_1 = 1, k_2 = 2).
function modulator() {
  const integrator = '"tf([0 1], [1 -1])"';
  return diagram(['add input U --at -1600 0', 'add signal_sum S1 --at -1200 0', `add tf_z H1 --at -800 0 --value ${integrator}`, 'add signal_sum S3 --at -400 0', `add tf_z H2 --at 0 0 --value ${integrator}`,
    'add quantizer QZ1 --at 800 0', 'add output V --at 1200 0', 'add gain K1 --at -800 400 --rot 180 --value k_1', 'add gain K2 --at 0 400 --rot 180 --value k_2',
    'connect U.p S1.w', 'connect S1.e H1.in', 'connect H1.out S3.w', 'connect S3.e H2.in', 'connect QZ1.out V.p', 'connect K1.out S1.s', 'connect K2.out S3.s',
    'connect H2.out QZ1.in', 'connect V.p K1.in', 'connect V.p K2.in'], [['S1', 's'], ['S3', 's']]);
}

test('CMA-ES finds the minimum of a curved valley, the same run for the same seed', () => {
  const rosenbrock = (x) => x.slice(0, -1).reduce((sum, v, i) => sum + 100 * (x[i + 1] - v * v) ** 2 + (1 - v) ** 2, 0);
  const run = () => {
    const cma = createCmaes({ mean: [-1, 1.5, 0], sigma: 0.5, random: seededRandom(7) });
    for (let g = 0; g < 2000 && !cma.stopReason(); g++) {
      const points = cma.ask();
      cma.tell(points, points.map(rosenbrock));
    }
    return cma.mean;
  };
  const found = run();
  assert.ok(rosenbrock(found) < 1e-8, `${found}`);
  assert.deepEqual(run(), found);
  const { values, vectors } = symmetricEigen([[2, 1, 0], [1, 2, 0], [0, 0, 5]]);
  assert.deepEqual(values.map((v) => Math.round(v * 1e9) / 1e9).sort(), [1, 3, 5]);
  // Each column is an eigenvector: A v = lambda v.
  const k = values.findIndex((v) => Math.abs(v - 3) < 1e-9);
  assert.ok(Math.abs(vectors[0][k] - vectors[1][k]) < 1e-9 && Math.abs(vectors[2][k]) < 1e-9);
});

test('the setup normalizes, and only free coefficients move: linked follow, timing stays', () => {
  assert.deepEqual(normalizeOptimizeSetup(null), { coefficients: {}, specs: [], swing: { on: false, amplitude: -6, input: '', frequency: '', limits: {}, measure: 'sigma3' }, evaluations: 3000, rounding: { denominator: 32, powersOfTwo: false, shared: true } });
  const setup = normalizeOptimizeSetup({ coefficients: { a: { fixed: true }, b: { min: '0.1', max: 'x' } }, specs: [{ action: 'below', measure: 'peak', input: 'QZ1', band: 'all', value: '3.5' }, { action: 'bogus', band: 'custom', f1: 0.1, f2: 0.2 }], swing: { on: true, amplitude: '-2', limits: { 'net:N1': '-6', 'net:N2': 'none' } }, evaluations: 20 });
  assert.deepEqual(setup.coefficients, { a: { fixed: true }, b: { min: 0.1 } });
  assert.deepEqual(setup.specs, [{ action: 'below', measure: 'peak', input: 'QZ1', band: 'all', value: 3.5 }, { action: 'minimize', measure: 'average', input: '', band: 'custom', f1: 0.1, f2: 0.2 }]);
  assert.deepEqual(setup.swing, { on: true, amplitude: -2, input: '', frequency: '', limits: { 'net:N1': -6 }, measure: 'sigma3' });
  assert.equal(setup.evaluations, 3000);
  // Saved with the document.
  const circuit = modulator();
  circuit.analysisValues.flow = { output: 'V', sources: {}, swingInput: '', swingFrequency: '', optimize: setup };
  assert.deepEqual(Circuit.fromJSON(JSON.parse(JSON.stringify(circuit.toJSON()))).analysisValues.flow.optimize, setup);

  // A CT loop's timing (the sampler's T, the DAC's delay T_d) is fixed unless set free.
  const ct = diagram(['add input U --at -1200 0', 'add signal_sum S1 --at -800 0', 'add tf_s H1 --at -400 0 --value "1/s"', 'add sampler SMP1 --at 0 0', 'add quantizer QZ1 --at 400 0', 'add output V --at 800 0',
    'add tf_s D1 --at 0 400 --rot 180 --value "exp(-s*T_d)*(1 - exp(-s*T))/s"', 'add gain K1 --at -400 400 --rot 180 --value k_1',
    'connect U.p S1.w', 'connect S1.e H1.in', 'connect H1.out SMP1.in', 'connect SMP1.out QZ1.in', 'connect QZ1.out V.p', 'connect V.p D1.in', 'connect D1.out K1.in', 'connect K1.out S1.s'], [['S1', 's']]);
  const params = optimizationParameters(ct, { values: { k_1: 0.5, T: 1, T_d: 0.2 }, setup: {} });
  assert.deepEqual(params.free.map((p) => p.name), ['k_1']);
  assert.deepEqual(params.fixed, ['T', 'T_d']);
  assert.deepEqual(optimizationParameters(ct, { values: {}, setup: { coefficients: { T_d: { fixed: false }, k_1: { fixed: true } } } }).free.map((p) => p.name), ['T_d']);
  assert.deepEqual(optimizationParameters(modulator(), { links: { k_2: '2*k_1' } }).linked, ['k_2']);
});

test('a point in the search becomes numbers: log scale keeping the sign, ranges clamped, links resolved', () => {
  const params = optimizationParameters(modulator(), { values: { k_1: -2, k_2: 0 }, setup: { coefficients: { k_1: { min: -3 } } } });
  const [k1, k2] = params.free;
  assert.equal(k1.log, true);
  assert.equal(k2.log, false, 'a zero start moves linearly');
  const moved = pointValues(params, [Math.log(1.2), 0.5], { values: { k_1: -2, k_2: 0 } });
  assert.ok(Math.abs(moved.own.k_1 + 2.4) < 1e-12);
  assert.equal(moved.penalty, 0);
  // Past its bound it is clamped, and the overshoot is a penalty.
  const clamped = pointValues(params, [Math.log(2), 0], { values: { k_1: -2, k_2: 0 } });
  assert.equal(clamped.own.k_1, -3);
  assert.ok(clamped.penalty > 0);
  assert.ok(fitnessOf({ violation: 0, goal: -80 }, clamped.penalty) > fitnessOf({ violation: 1, goal: 0 }));
  const linked = optimizationParameters(modulator(), { values: { k_1: 1 }, links: { k_2: '2*k_1' } });
  assert.equal(pointValues(linked, [Math.log(1.5)], { values: { k_1: 1 }, links: { k_2: '2*k_1' } }).values.k_2, 3);
});

test('bands: the signal band, outside it, everything, f1 to f2; the swing tests in band', () => {
  const lowpass = { f0: 0, bw: 1 / 64 };
  const bandpass = { f0: 0.25, bw: 0.02 };
  assert.deepEqual(specIntervals({ band: 'signal' }, lowpass), [[0, 1 / 64]]);
  assert.deepEqual(specIntervals({ band: 'outside' }, lowpass), [[1 / 64, 0.5]]);
  assert.deepEqual(specIntervals({ band: 'outside' }, bandpass), [[1e-4, 0.24], [0.26, 0.5]]);
  assert.deepEqual(specIntervals({ band: 'custom', f1: 0.1, f2: 0.2 }, null), [[0.1, 0.2]]);
  assert.equal(specIntervals({ band: 'signal' }, null), null);
  assert.equal(swingTestFrequency({ frequency: '' }, bandpass), 0.25);
  assert.equal(swingTestFrequency({ frequency: '1/128' }, bandpass), 1 / 128);
});

test('the objective: an unstable loop misses by its poles; limits miss by their dB; the swing test runs the loop', () => {
  const circuit = modulator();
  const problem = { output: 'V', sources: { U: 'input', QZ1: 'input' }, band: { f0: 0, bw: 1 / 64 }, values: { k_1: 1, k_2: 2 },
    setup: { specs: [{ action: 'minimize', measure: 'average', input: 'QZ1', band: 'signal' }, { action: 'below', measure: 'peak', input: 'QZ1', band: 'all', value: 3.5 }], swing: { on: true, amplitude: -6, input: 'U' } } };
  const objective = prepareObjective(circuit, problem);
  assert.equal(objective.ok, true, objective.error);
  // The textbook loop: NTF (1 - z^-1)^2, its peak 4 (12 dB) at f/fs = 1/2.
  const textbook = objective.evaluate({ k_1: 1, k_2: 2 });
  assert.ok(Math.abs(textbook.specs[1] - 20 * Math.log10(4)) < 0.01, `${textbook.specs[1]}`);
  assert.ok(Math.abs(textbook.violation - (20 * Math.log10(4) - 3.5)) < 0.01);
  assert.equal(textbook.swing.overloaded, false);
  assert.equal(textbook.goal, textbook.specs[0]);
  // k_2 = 3.5 puts a pole outside the unit circle.
  const unstable = objective.evaluate({ k_1: 1, k_2: 3.5 });
  assert.ok(unstable.unstable > 1 && unstable.violation >= 100);
  assert.equal(prepareObjective(circuit, { ...problem, band: null }).ok, false, 'the signal band must be set');
  assert.equal(prepareObjective(circuit, { ...problem, setup: {} }).ok, false, 'something to optimize for');
});

test('the optimizer meets the limits and improves the goal, and says when the limits cannot all be met', () => {
  const circuit = modulator();
  const values = { k_1: 1, k_2: 2 };
  const sim = prepareSimulation(circuit, { values, input: 'U', output: 'name:V' });
  const [first, second] = sim.signals.filter((s) => s.role === 'state' || s.role === 'quantizer-input').map((s) => s.key); // H1's, H2's outputs
  // The textbook loop swings H1 to 8.5 dBFS and H2 to 12 at -6 dBFS in.
  const setup = {
    specs: [{ action: 'minimize', measure: 'average', input: 'QZ1', band: 'signal' }],
    swing: { on: true, amplitude: -6, input: 'U', limits: { [first]: 6, [second]: 12 } },
  };
  // A short swing test: this tests the search, not the statistics.
  const problem = { output: 'V', sources: { U: 'input', QZ1: 'input' }, band: { f0: 0, bw: 1 / 64 }, values, setup, ...QUICK };
  const start = prepareObjective(circuit, problem).evaluate(values);
  assert.ok(start.violation > 0, 'the start misses H1\'s limit');
  const result = runOptimization(circuit, problem, { evaluations: 400, seed: 3 });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.feasible, true);
  assert.equal(result.best.score.swing.overloaded, false);
  // The best is verified at length, its 3-sigma levels under the limits.
  assert.equal(result.best.score.verified, true);
  assert.equal(result.best.score.swing.held, result.best.score.swing.runs);
  assert.ok(result.best.score.swing.levels[first] <= 6 + 0.01 && result.best.score.swing.levels[second] <= 12 + 0.01);
  // Meeting H1's limit (with the search's half-dB guard) costs a few dB of
  // the textbook loop's shaping, no more.
  assert.ok(result.best.score.specs[0] < start.specs[0] + 5, `${start.specs[0]} -> ${result.best.score.specs[0]}`);
  // With two coefficients an NTF peak under Lee's 3.5 dB needs small
  // feedback, which lets the first integrator swing wide: a 3 dB limit on
  // it cannot be met as well. The best compromise comes back, marked as missing.
  const lee = { action: 'below', measure: 'peak', input: 'QZ1', band: 'all', value: 3.5 };
  const tight = runOptimization(circuit, { ...problem, setup: { ...setup, specs: [...setup.specs, lee], swing: { ...setup.swing, limits: { [first]: 3 } } } }, { evaluations: 300, seed: 3 });
  assert.equal(tight.ok, true);
  assert.equal(tight.feasible, false);
  assert.ok(tight.best.score.violation > 0);
  // With no goal, the first candidate meeting every limit ends the search.
  const quick = runOptimization(circuit, { ...problem, setup: { ...setup, specs: [] } }, { evaluations: 400, seed: 3 });
  assert.equal(quick.feasible, true);
  assert.ok(quick.evaluations < 400);
  // Nothing free: said so.
  assert.equal(runOptimization(circuit, { ...problem, setup: { ...setup, coefficients: { k_1: { fixed: true }, k_2: { fixed: true } } } }).ok, false);
});

test('a plain filter: a passband kept within a dB, the stopband pushed down', () => {
  const circuit = diagram(['add input U --at -800 0', 'add tf_z H1 --at -400 0 --value "tf([b_0], [1 -a_1])"', 'add tf_z H2 --at 0 0 --value "tf([b_1], [1 -a_2])"', 'add output Y --at 400 0',
    'connect U.p H1.in', 'connect H1.out H2.in', 'connect H2.out Y.p']);
  const problem = { output: 'Y', sources: { U: 'input' }, band: { f0: 0, bw: 0.02 }, values: { b_0: 0.5, a_1: 0.5, b_1: 0.5, a_2: 0.5 },
    setup: { specs: [{ action: 'above', measure: 'lowest', input: 'U', band: 'signal', value: -1 }, { action: 'below', measure: 'peak', input: 'U', band: 'signal', value: 1 }, { action: 'minimize', measure: 'peak', input: 'U', band: 'custom', f1: 0.2, f2: 0.5 }] } };
  const start = prepareObjective(circuit, problem).evaluate(problem.values);
  const result = runOptimization(circuit, problem, { evaluations: 600, seed: 1 });
  assert.equal(result.feasible, true);
  assert.ok(result.best.score.specs[0] >= -1 - 1e-9 && result.best.score.specs[1] <= 1 + 1e-9);
  assert.ok(result.best.score.specs[2] < start.specs[2] - 10, `${start.specs[2]} -> ${result.best.score.specs[2]}`);
});

import { ditherSettings } from '../src/core/analysis/simulate.js';
import { outputSpectrum } from '../src/core/analysis/spectrum.js';

test('dither at the quantizer: rectangular or triangular, its amplitude in dBFS, the same sequence every run', () => {
  assert.equal(ditherSettings(null, 4), null);
  assert.equal(ditherSettings({ shape: 'none', amplitude: -12 }, 4), null);
  const rect = ditherSettings({ shape: 'rect', amplitude: '-12.0412' }, 4);
  assert.ok(Math.abs(rect.amplitude - 1) < 1e-4 && Math.abs(rect.variance - 1 / 3) < 1e-4);
  assert.ok(Math.abs(ditherSettings({ shape: 'tri', amplitude: 0 }, 1).variance - 1 / 6) < 1e-12);
  // A small input to the single-bit loop: dithered, the quantizer's output
  // still takes only its levels, and two runs agree sample for sample.
  const circuit = modulator();
  const dithered = prepareSimulation(circuit, { values: { k_1: 1, k_2: 2 }, input: 'U', output: 'name:V', samples: 1024, dither: { shape: 'tri', amplitude: -6 } });
  const plain = prepareSimulation(circuit, { values: { k_1: 1, k_2: 2 }, input: 'U', output: 'name:V', samples: 1024 });
  const a = dithered.run(-40, { record: true }).samples;
  assert.deepEqual([...new Set(a)].sort(), [-1, 1]);
  assert.deepEqual(dithered.run(-40, { record: true }).samples, a);
  assert.notDeepEqual(plain.run(-40, { record: true }).samples, a);
  // The optimizer's swing test takes it too.
  const problem = { output: 'V', sources: { U: 'input' }, band: { f0: 0, bw: 1 / 64 }, values: { k_1: 1, k_2: 2 }, setup: { swing: { on: true, amplitude: -6, input: 'U' } } };
  const peaksOf = (dither) => prepareObjective(circuit, { ...problem, dither }).evaluate({ k_1: 1, k_2: 2 }).swing.peaks;
  assert.notDeepEqual(peaksOf({ shape: 'rect', amplitude: -3 }), peaksOf(null));
});

test('the spectrum averages half-overlapping segments (Welch): a steadier floor at the same level', () => {
  const random = seededRandom(5);
  // White noise of variance 1/3: uniform over (-1, 1).
  const noise = Array.from({ length: 4 * 1024 }, () => 2 * random() - 1);
  const one = outputSpectrum(noise.slice(0, 1024));
  const averaged = outputSpectrum(noise, { segment: 1024 });
  assert.equal(one.averages, 1);
  assert.equal(averaged.averages, 7);
  assert.equal(averaged.n, 1024);
  const stats = (spectrum) => {
    const db = spectrum.points.slice(10, -10).map((p) => p.db);
    const mean = db.reduce((s, v) => s + v, 0) / db.length;
    return { mean, spread: Math.sqrt(db.reduce((s, v) => s + (v - mean) ** 2, 0) / db.length) };
  };
  // Both read white error of variance 1/3 near 0 dB (a log average sits
  // a couple of dB under), the averaged one with about half the scatter.
  assert.ok(Math.abs(stats(averaged).mean) < 2, `${stats(averaged).mean}`);
  assert.ok(stats(averaged).spread < 0.6 * stats(one).spread, `${stats(averaged).spread} vs ${stats(one).spread}`);
});

test('the simulations\' dither and a plot\'s source are saved with the document', () => {
  const circuit = modulator();
  circuit.analysisValues.flow = { output: 'V', sources: {}, swingInput: '', swingFrequency: '', dither: { shape: 'tri', amplitude: '-20' } };
  circuit.addAnnotation('box', { x: 0, y: 400, end: { x: 400, y: 800 }, plot: { kind: 'response', axis: 'normalized', range: { low: -4, high: -0.3 }, traces: [{ label: 'T', color: '#3b74e0', points: [{ f: 0.001, db: 10 }, { f: 0.1, db: -10 }] }], role: 'loop', source: 'net:N7' } });
  const back = Circuit.fromJSON(JSON.parse(JSON.stringify(circuit.toJSON())));
  assert.deepEqual(back.analysisValues.flow.dither, { shape: 'tri', amplitude: '-20' });
  assert.equal([...back.labels.values()].find((label) => label.plot)?.plot.source, 'net:N7');
});

import { coefficientGroups, fractionGrid, fractionText, runRounding } from '../src/core/analysis/rounding.js';

// The second-order loop with a gain c_1 between the integrators: H2 reads c_1 and k_2.
function scaledModulator() {
  const integrator = '"tf([0 1], [1 -1])"';
  return diagram(['add input U --at -2000 0', 'add gain K0 --at -1600 0 --value b_1', 'add signal_sum S1 --at -1200 0', `add tf_z H1 --at -800 0 --value ${integrator}`, 'add gain K3 --at -400 -200 --value c_1', 'add signal_sum S3 --at 0 0', `add tf_z H2 --at 400 0 --value ${integrator}`,
    'add quantizer QZ1 --at 1200 0', 'add output V --at 1600 0', 'add gain K1 --at -800 400 --rot 180 --value k_1', 'add gain K2 --at 400 400 --rot 180 --value k_2',
    'connect U.p K0.in', 'connect K0.out S1.w', 'connect S1.e H1.in', 'connect H1.out K3.in', 'connect K3.out S3.w', 'connect S3.e H2.in', 'connect QZ1.out V.p', 'connect K1.out S1.s', 'connect K2.out S3.s',
    'connect H2.out QZ1.in', 'connect V.p K1.in', 'connect V.p K2.in'], [['S1', 's'], ['S3', 's']]);
}

test('fractions: the grid m/n up to a denominator, powers of two, a value written as one', () => {
  assert.deepEqual(fractionGrid(0, 1, 3).map((f) => `${f.m}/${f.n}`), ['0/1', '1/3', '1/2', '2/3', '1/1']);
  assert.deepEqual(fractionGrid(0.2, 0.8, 4, { powersOfTwo: true }).map((f) => `${f.m}/${f.n}`), ['0/1', '1/4', '1/2', '3/4']);
  assert.equal(fractionText(1 / 3), '1/3');
  assert.equal(fractionText(-6 / 32), '-3/16');
  assert.equal(fractionText(2), null);
  assert.equal(fractionText(Math.PI), null);
});

test('the gains into one block share its denominator: through sums to the part they feed', () => {
  const groups = coefficientGroups(scaledModulator(), ['b_1', 'c_1', 'k_1', 'k_2']);
  const byInto = Object.fromEntries(groups.map((g) => [g.into, g.names.sort()]));
  assert.deepEqual(byInto, { H1: ['b_1', 'k_1'], H2: ['c_1', 'k_2'] });
});

test('rounding: every free coefficient a fraction over its block\'s n, none rounded away, the specs kept', () => {
  const circuit = scaledModulator();
  const values = { b_1: 0.43, k_1: 0.43, c_1: 0.71, k_2: 1.37 };
  const setup = { specs: [{ action: 'minimize', measure: 'average', input: 'QZ1', band: 'signal' }], swing: { on: true, amplitude: -6, input: 'U' } };
  const problem = { output: 'V', sources: { U: 'input', QZ1: 'input' }, band: { f0: 0, bw: 1 / 64 }, values, setup, ...QUICK };
  const objective = prepareObjective(circuit, problem);
  const parameters = optimizationParameters(circuit, { values, setup });
  const groups = coefficientGroups(circuit, parameters.free.map((p) => p.name));
  const result = runRounding(objective, parameters, { values, denominator: 8, groups, seed: 2 });
  assert.equal(isFeasible(result), true);
  for (const group of result.groups) {
    assert.ok(group.n >= 1 && group.n <= 8);
    for (const name of group.names) {
      const f = result.fractions[name];
      assert.equal(f.n, group.n, `${name} over its block's n`);
      assert.ok(f.m !== 0, `${name} is not rounded away`);
      assert.equal(result.own[name], f.m / f.n);
    }
  }
  // Powers of two only; a block's own larger n.
  const binary = runRounding(objective, parameters, { values, denominator: 8, groups, powersOfTwo: true, seed: 2 });
  for (const group of binary.groups) assert.ok([1, 2, 4, 8].includes(group.n));
  const finer = runRounding(objective, parameters, { values, denominator: 2, denominators: { c_1: 64, k_2: 64 }, groups, seed: 2 });
  assert.ok(finer.groups.find((g) => g.into === 'H1').n <= 2);
  // One coefficient alone: a fraction of its own.
  const alone = runRounding(objective, parameters, { values, denominator: 16, seed: 2 });
  assert.equal(alone.groups.length, 4);
});

test('a coefficient written as a fraction is saved as one, while it is still its number', () => {
  const circuit = modulator();
  circuit.analysisValues.coefficients = { k_1: 3 / 16, k_2: 0.5 };
  circuit.analysisValues.fractions = { k_1: '3/16', k_2: '1/3' };
  const back = Circuit.fromJSON(JSON.parse(JSON.stringify(circuit.toJSON())));
  assert.deepEqual(back.analysisValues.fractions, { k_1: '3/16' });
  const setup = normalizeOptimizeSetup({ coefficients: { k_1: { denominator: 64 } }, rounding: { denominator: 16, powersOfTwo: true, shared: false } });
  assert.deepEqual(setup.coefficients, { k_1: { denominator: 64 } });
  assert.deepEqual(setup.rounding, { denominator: 16, powersOfTwo: true, shared: false });
});

test('the swing test takes the worst of runs at two in-band frequencies, and keeps a half-dB guard under each limit', () => {
  assert.deepEqual(swingTestFrequencies(0.25, { f0: 0.25, bw: 0.02 }), [0.25, 0.245]);
  assert.deepEqual(swingTestFrequencies(1 / 128, { f0: 0, bw: 1 / 64 }), [1 / 128, 1 / 256]);
  assert.equal(swingTestFrequencies(0.1, null, 3).length, 3);
  const circuit = modulator();
  const sim = prepareSimulation(circuit, { values: { k_1: 1, k_2: 2 }, input: 'U', output: 'name:V' });
  const first = sim.signals.find((s) => s.role === 'state').key;
  const problem = { output: 'V', sources: { U: 'input' }, band: { f0: 0, bw: 1 / 64 }, values: { k_1: 1, k_2: 2 }, setup: { swing: { on: true, amplitude: -6, input: 'U', measure: 'peak' } } };
  const peak = prepareObjective(circuit, problem).evaluate({ k_1: 1, k_2: 2 }).swing.peaks[first];
  // Each run's peaks: the two-run test reads at least the one-run peak.
  const one = prepareObjective(circuit, { ...problem, swingRuns: 1 }).evaluate({ k_1: 1, k_2: 2 }).swing.peaks[first];
  assert.ok(peak >= one - 1e-9);
  // A limit 0.3 dB over the peak is inside the guard: missed by the search.
  const limited = (guard) => prepareObjective(circuit, { ...problem, swingGuard: guard, setup: { swing: { ...problem.setup.swing, limits: { [first]: peak + 0.3 } } } }).evaluate({ k_1: 1, k_2: 2 }).violation;
  assert.ok(limited(0.5) > 0);
  assert.equal(limited(0), 0);
});

test('a limit compares the 3-sigma level, the 4-sigma level, or the highest peak; the long test verifies', () => {
  const circuit = modulator();
  const sim = prepareSimulation(circuit, { values: { k_1: 1, k_2: 2 }, input: 'U', output: 'name:V' });
  const first = sim.signals.find((s) => s.role === 'state').key;
  const problem = (measure) => ({ output: 'V', sources: { U: 'input' }, band: { f0: 0, bw: 1 / 64 }, values: { k_1: 1, k_2: 2 }, setup: { swing: { on: true, amplitude: -6, input: 'U', measure, limits: { [first]: 20 } } } });
  const level = (measure) => prepareObjective(circuit, problem(measure)).evaluate({ k_1: 1, k_2: 2 }).swing.levels[first];
  // Rarer is higher: 3 sigma under 4 sigma under the highest peak.
  assert.ok(level('sigma3') < level('sigma4') && level('sigma4') <= level('peak') + 1e-9, `${level('sigma3')} ${level('sigma4')} ${level('peak')}`);
  assert.equal(level('peak'), prepareObjective(circuit, problem('peak')).evaluate({ k_1: 1, k_2: 2 }).swing.peaks[first]);
  // The long test: eight runs at the amplitude and two above it, all held.
  const verified = prepareObjective(circuit, problem('sigma3')).verify({ k_1: 1, k_2: 2 });
  assert.equal(verified.verified, true);
  assert.deepEqual([verified.swing.runs, verified.swing.held, verified.swing.marginRuns, verified.swing.marginHeld], [8, 8, 2, 2]);
  // An unstable loop: the long test says how many runs held.
  const unstable = prepareObjective(circuit, { ...problem('sigma3'), setup: { swing: { ...problem('sigma3').setup.swing, amplitude: 6 } } }).verify({ k_1: 1, k_2: 2 });
  assert.equal(unstable.swing.overloaded, true);
  assert.ok(unstable.swing.held < unstable.swing.runs);
});

import { poleMeasures } from '../src/core/analysis/optimize.js';

test('pole specs: the highest Q of a pole pair, the same in z and s, and the largest radius', () => {
  // A z pair at radius 0.954, f/fs 0.0396: s = ln z, Q = |s| / (2 |Re s|).
  const theta = 2 * Math.PI * 0.0396;
  const pair = [{ re: 0.954 * Math.cos(theta), im: 0.954 * Math.sin(theta) }, { re: 0.954 * Math.cos(theta), im: -0.954 * Math.sin(theta) }];
  const { q, radius } = poleMeasures([...pair, { re: 0.9, im: 0 }], true);
  assert.ok(Math.abs(q - Math.hypot(Math.log(0.954), theta) / (2 * -Math.log(0.954))) < 1e-12);
  assert.ok(Math.abs(radius - 0.954) < 1e-12);
  // The same radius rings less at a lower frequency.
  const low = 2 * Math.PI * 0.005;
  assert.ok(poleMeasures([{ re: 0.954 * Math.cos(low), im: 0.954 * Math.sin(low) }], true).q < q);
  // Real poles only: 0.5. An s pair -1 +- j: Q = sqrt(2)/2.
  assert.equal(poleMeasures([{ re: 0.5, im: 0 }], true).q, 0.5);
  assert.ok(Math.abs(poleMeasures([{ re: -1, im: 1 }, { re: -1, im: -1 }], false).q - Math.SQRT1_2) < 1e-12);
  assert.equal(poleMeasures([{ re: -1, im: 1 }], false).radius, null);
});

test('a limit on the poles\' Q is kept by the optimizer, and the result reports it', () => {
  const circuit = modulator();
  const setup = { specs: [{ action: 'minimize', measure: 'average', input: 'QZ1', band: 'signal' }, { action: 'below', measure: 'q', input: 'QZ1', value: 0.8 }] };
  const problem = { output: 'V', sources: { U: 'input', QZ1: 'input' }, band: { f0: 0, bw: 1 / 64 }, values: { k_1: 1, k_2: 2 }, setup };
  const objective = prepareObjective(circuit, problem);
  assert.equal(objective.ok, true, objective.error);
  // The textbook loop's poles are at the origin (NTF (1 - z^-1)^2): Q 0.5.
  assert.equal(objective.evaluate({ k_1: 1, k_2: 2 }).specs[1], 0.5);
  const free = runOptimization(circuit, { ...problem, setup: { specs: [setup.specs[0]] } }, { evaluations: 300, seed: 2 });
  const held = runOptimization(circuit, problem, { evaluations: 300, seed: 2 });
  assert.equal(held.feasible, true);
  assert.ok(held.best.score.specs[1] <= 0.8 + 1e-3, `Q ${held.best.score.specs[1]}`);
  // Unlimited, the search rings harder; the limit costs some in-band shaping.
  const freeQ = prepareObjective(circuit, problem).evaluate(free.best.values).specs[1];
  assert.ok(freeQ > 0.8, `unlimited Q ${freeQ}`);
  assert.ok(held.best.score.specs[0] >= free.best.score.specs[0] - 1e-9);
  // A pole radius is for z results; normalized with the setup.
  assert.deepEqual(normalizeOptimizeSetup({ specs: [{ action: 'below', measure: 'radius', input: 'QZ1', value: '0.9' }] }).specs[0], { action: 'below', measure: 'radius', input: 'QZ1', band: 'signal', value: 0.9 });
});

test('dither in quantizer steps (levels 2 apart); an older dBFS amplitude reads as the steps it is', () => {
  // +-1/2 step is +-1 level: rectangular variance 1/3, the quantizer's own.
  const half = ditherSettings({ shape: 'rect', steps: '0.5' }, 4);
  assert.deepEqual([half.amplitude, half.steps], [1, 0.5]);
  assert.ok(Math.abs(half.variance - 1 / 3) < 1e-12);
  assert.ok(Math.abs(ditherSettings({ shape: 'tri', steps: 1 }, 1).variance - 4 / 6) < 1e-12);
  // -12.04 dBFS of full scale 4 is 1 level: half a step.
  assert.ok(Math.abs(ditherSettings({ shape: 'tri', amplitude: '-12.0412' }, 4).steps - 0.5) < 1e-4);
  assert.equal(ditherSettings({ shape: 'rect', steps: '0' }, 4), null);
  const circuit = modulator();
  circuit.analysisValues.flow = { output: 'V', sources: {}, swingInput: '', swingFrequency: '', dither: { shape: 'rect', steps: '0.5' } };
  assert.deepEqual(Circuit.fromJSON(JSON.parse(JSON.stringify(circuit.toJSON()))).analysisValues.flow.dither, { shape: 'rect', steps: '0.5' });
});

import { ditherFraction } from '../src/core/analysis/rounding.js';

test('the dither as a rounded gain into the quantizer\'s block: the smallest m/n giving at least the dither set', () => {
  // +-1/2 step of a 5-level quantizer (full scale 4) is a gain of 1/4.
  assert.deepEqual(ditherFraction(0.5, 4, 28), { m: 7, n: 28, gain: 0.25, steps: 0.5 });
  // Not exact: rounded up, so the dither is at least what was set.
  const up = ditherFraction(0.5, 4, 10);
  assert.deepEqual([up.m, up.n], [3, 10]);
  assert.ok(up.steps >= 0.5 && Math.abs(up.steps - 0.6) < 1e-12);
  // Never below one unit; nothing without dither.
  assert.equal(ditherFraction(0.01, 4, 4).m, 1);
  assert.equal(ditherFraction(0, 4, 16), null);
});
