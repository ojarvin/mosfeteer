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
  assert.deepEqual(normalizeOptimizeSetup(null), { coefficients: {}, specs: [], swing: { on: false, amplitude: -6, input: '', frequency: '', limits: {}, targets: {}, measure: 'sigma3' }, evaluations: 3000, prune: true, constraints: '', rounding: { on: false, denominator: 32, fixed: false, powersOfTwo: false, shared: true } });
  const setup = normalizeOptimizeSetup({ coefficients: { a: { fixed: true }, b: { min: '0.1', max: 'x' } }, specs: [{ action: 'below', measure: 'peak', input: 'QZ1', band: 'all', value: '3.5' }, { action: 'bogus', band: 'custom', f1: 0.1, f2: 0.2 }], swing: { on: true, amplitude: '-2', limits: { 'net:N1': '-6', 'net:N2': 'none' } }, evaluations: 20 });
  assert.deepEqual(setup.coefficients, { a: { fixed: true }, b: { min: 0.1 } });
  assert.deepEqual(setup.specs, [{ action: 'below', measure: 'peak', input: 'QZ1', band: 'all', value: 3.5 }, { action: 'minimize', measure: 'average', input: '', band: 'custom', f1: 0.1, f2: 0.2 }]);
  assert.deepEqual(setup.swing, { on: true, amplitude: -2, input: '', frequency: '', limits: { 'net:N1': -6 }, targets: {}, measure: 'sigma3' });
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

import { outputSpectrum } from '../src/core/analysis/spectrum.js';

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

test('a plot\'s source is saved with the document; the old dither setting is not read', () => {
  const circuit = modulator();
  circuit.analysisValues.flow = { output: 'V', sources: {}, swingInput: '', swingFrequency: '', dither: { shape: 'tri', amplitude: '-20' } };
  circuit.addAnnotation('box', { x: 0, y: 400, end: { x: 400, y: 800 }, plot: { kind: 'response', axis: 'normalized', range: { low: -4, high: -0.3 }, traces: [{ label: 'T', color: '#3b74e0', points: [{ f: 0.001, db: 10 }, { f: 0.1, db: -10 }] }], role: 'loop', source: 'net:N7' } });
  const back = Circuit.fromJSON(JSON.parse(JSON.stringify(circuit.toJSON())));
  assert.equal(back.analysisValues.flow.dither, undefined);
  assert.equal([...back.labels.values()].find((label) => label.plot)?.plot.source, 'net:N7');
});

import { coefficientGroups, fractionGrid, fractionSnapper, fractionText, polishSearch } from '../src/core/analysis/rounding.js';

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

test('fractions: a block\'s gains snap over its one n -- the most accurate up to the largest, or one set exactly', () => {
  const circuit = scaledModulator();
  const parameters = optimizationParameters(circuit, { values: { b_1: 0.43, k_1: 0.43, c_1: 0.71, k_2: 1.37 } });
  const groups = coefficientGroups(circuit, parameters.free.map((p) => p.name));
  const own = { b_1: 0.43, k_1: 0.43, c_1: 0.71, k_2: 1.37 };
  const snapped = fractionSnapper(parameters, { denominator: 8, groups })(own);
  for (const group of snapped.groups) {
    assert.ok(group.n >= 1 && group.n <= 8);
    for (const name of group.names) {
      assert.equal(snapped.fractions[name].n, group.n, `${name} over its block's n`);
      assert.equal(snapped.own[name], snapped.fractions[name].m / group.n);
    }
  }
  // Exactly n for one block (a member's own), or for every block.
  const exact = fractionSnapper(parameters, { denominator: 8, exact: { k_2: 12 }, groups })(own);
  assert.equal(exact.groups.find((g) => g.into === 'H2').n, 12);
  assert.ok(exact.groups.find((g) => g.into === 'H1').n <= 8);
  assert.deepEqual(fractionSnapper(parameters, { denominator: 10, fixed: true, groups })(own).groups.map((g) => g.n), [10, 10]);
  for (const g of fractionSnapper(parameters, { denominator: 8, powersOfTwo: true, groups })(own).groups) assert.ok([1, 2, 4, 8].includes(g.n));
  // Never to zero: a tiny gain keeps one unit.
  assert.equal(fractionSnapper(parameters, { denominator: 4, fixed: true })({ ...own, c_1: 0.01 }).fractions.c_1.m, 1);
});

test('a search kept to fractions weighs only fractions, and finds one that meets the specs; polishing moves a unit at a time', () => {
  const circuit = scaledModulator();
  const values = { b_1: 0.43, k_1: 0.43, c_1: 0.71, k_2: 1.37 };
  const setup = { specs: [{ action: 'minimize', measure: 'average', input: 'QZ1', band: 'signal' }], swing: { on: true, amplitude: -6, input: 'U' }, evaluations: 300 };
  const problem = { output: 'V', sources: { U: 'input', QZ1: 'input' }, band: { f0: 0, bw: 1 / 64 }, values, setup, ...QUICK };
  const parameters = optimizationParameters(circuit, { values, setup });
  const groups = coefficientGroups(circuit, parameters.free.map((p) => p.name));
  const snap = fractionSnapper(parameters, { denominator: 8, groups });
  const result = runOptimization(circuit, problem, { seed: 3, snap });
  assert.equal(result.feasible, true);
  // The best is on fractions already: snapping it again changes nothing.
  const again = snap(result.best.own);
  for (const p of parameters.free) assert.equal(again.own[p.name], result.best.own[p.name], `${p.name} = ${result.best.own[p.name]}`);
  const objective = prepareObjective(circuit, problem);
  const snapped = snap(result.best.own);
  const search = polishSearch(parameters, { own: result.best.own, snapped });
  let step = search.next();
  while (!step.done) step = search.next(step.value.batch.map((request) => scoreRequest(objective, request)));
  const polished = step.value;
  assert.ok(polished.fitness <= fitnessOf(polished.start) + 1e-9);
  for (const [name, f] of Object.entries(polished.fractions)) assert.equal(polished.own[name], f.m / f.n);
});

test('a coefficient written as a fraction is saved as one, while it is still its number', () => {
  const circuit = modulator();
  circuit.analysisValues.coefficients = { k_1: 3 / 16, k_2: 0.5 };
  circuit.analysisValues.fractions = { k_1: '3/16', k_2: '1/3' };
  const back = Circuit.fromJSON(JSON.parse(JSON.stringify(circuit.toJSON())));
  assert.deepEqual(back.analysisValues.fractions, { k_1: '3/16' });
  const setup = normalizeOptimizeSetup({ coefficients: { k_1: { denominator: 64 }, k_2: { denominator: 8, denominatorFixed: true } }, rounding: { on: true, denominator: 16, powersOfTwo: true, shared: false } });
  assert.deepEqual(setup.coefficients, { k_1: { denominator: 64 }, k_2: { denominator: 8, denominatorFixed: true } });
  assert.deepEqual(setup.rounding, { on: true, denominator: 16, fixed: false, powersOfTwo: true, shared: false });
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

import { isSensitive, pruneCandidates, pruneSearch, runRefine, sensitivitySearch } from '../src/core/analysis/refine.js';
import { scoreRequest } from '../src/core/analysis/optimize.js';

// The second-order loop with a feedforward k_3 from the input into the
// second integrator, beside k_2: it shapes the STF only, never the NTF.
function feedforwardModulator() {
  const circuit = modulator();
  for (const line of ['add gain K3 --at -400 -400 --rot 90 --value k_3', 'connect U.p K3.in', 'connect K3.out S3.n']) runCommand(circuit, line);
  return circuit;
}

test('sensitivity: each coefficient nudged 1%, the specs\' worst change in dB per 1%', () => {
  const circuit = feedforwardModulator();
  const own = { k_1: 1, k_2: 2, k_3: 0.002 };
  const problem = { output: 'V', sources: { U: 'input', QZ1: 'input' }, band: { f0: 0, bw: 1 / 64 }, values: own,
    setup: { specs: [{ action: 'minimize', measure: 'average', input: 'QZ1', band: 'signal' }, { action: 'below', measure: 'peak', input: 'QZ1', band: 'all', value: 12.05 }] } };
  const objective = prepareObjective(circuit, problem);
  const parameters = optimizationParameters(circuit, { values: own, setup: problem.setup });
  const found = runRefine(objective, sensitivitySearch(parameters, objective.specs, { own }), scoreRequest);
  const of = (name) => found.find((entry) => entry.name === name);
  // The NTF hangs on the feedback; the feedforward does not touch it.
  assert.ok(of('k_1').perPercent > 0.01, `${of('k_1').perPercent}`);
  assert.equal(of('k_3').perPercent, 0);
  // Its peak sits just under the 12.05 dB limit (12.04): a nudge misses it, noted.
  assert.ok(found.some((entry) => entry.breaks));
  // Fragile is a large change or lost stability, not a limit met exactly.
  assert.equal(isSensitive(of('k_3')), false);
  assert.equal(isSensitive({ perPercent: 0.1, breaks: true, unstable: false }), false);
  assert.equal(isSensitive({ perPercent: 1.5, breaks: false, unstable: false }), true);
  assert.equal(isSensitive({ perPercent: 0, breaks: false, unstable: true }), true);
});

test('pruning: a coefficient small beside its block-mates is set to zero when the specs allow', () => {
  const circuit = feedforwardModulator();
  const own = { k_1: 1, k_2: 2, k_3: 0.002 };
  const groups = coefficientGroups(circuit, ['k_1', 'k_2', 'k_3']).map((group) => group.names);
  // k_3 goes into H2 with k_2: a thousandth of it.
  assert.deepEqual(pruneCandidates(['k_1', 'k_2', 'k_3'], own, groups), ['k_3']);
  assert.deepEqual(pruneCandidates(['k_1', 'k_2', 'k_3'], { ...own, k_3: 0.5 }, groups), []);
  const problem = { output: 'V', sources: { U: 'input', QZ1: 'input' }, band: { f0: 0, bw: 1 / 64 }, values: own,
    setup: { specs: [{ action: 'minimize', measure: 'average', input: 'QZ1', band: 'signal' }] } };
  const objective = prepareObjective(circuit, problem);
  const start = objective.verify(own);
  const pruned = runRefine(objective, pruneSearch(['k_3'], { own, start }), scoreRequest);
  assert.deepEqual(pruned.zeroed, ['k_3']);
  assert.equal(pruned.own.k_3, 0);
  // A coefficient a limit needs stays: the STF's in-band level kept above 6 dB needs k_3.
  const needs = { ...problem, setup: { specs: [{ action: 'above', measure: 'lowest', input: 'U', band: 'signal', value: 6 }] } };
  const big = { k_1: 1, k_2: 2, k_3: 3 };
  const kept = runRefine(prepareObjective(circuit, needs), pruneSearch(['k_3'], { own: big, start: prepareObjective(circuit, needs).verify(big) }), scoreRequest);
  assert.deepEqual(kept.zeroed, []);
});

import { frequencyNumber, normalizeBand } from '../src/core/analysis/optimize-setup.js';

test('a frequency typed as a fraction keeps its text: the band and a spec\'s f1, f2', () => {
  assert.equal(frequencyNumber('1/256'), 1 / 256);
  assert.equal(frequencyNumber(' 0.004 '), 0.004);
  assert.ok(Number.isNaN(frequencyNumber('a/b')));
  // The band: numbers to compute with, the fractions to show again.
  assert.deepEqual(normalizeBand({ f0: 1 / 64, bw: 1 / 256, text: { f0: '1/64', bw: '1 / 256' } }), { f0: 1 / 64, bw: 1 / 256, text: { f0: '1/64', bw: '1/256' } });
  assert.deepEqual(normalizeBand({ f0: 0, bw: 0.01, text: { bw: '0.01' } }), { f0: 0, bw: 0.01 }, 'a plain number keeps no text');
  assert.deepEqual(normalizeBand({ f0: 0, bw: 0.02, text: { bw: '1/256' } }), { f0: 0, bw: 0.02 }, 'a stale text is dropped');
  const circuit = new Circuit();
  circuit.analysisValues.band = normalizeBand({ f0: 0, bw: 1 / 128, text: { bw: '1/128' } });
  assert.deepEqual(Circuit.fromJSON(JSON.parse(JSON.stringify(circuit.toJSON()))).analysisValues.band, { f0: 0, bw: 1 / 128, text: { bw: '1/128' } });
  // A spec's custom band, typed as fractions (was NaN, so lost).
  const [spec] = normalizeOptimizeSetup({ specs: [{ action: 'minimize', measure: 'peak', input: 'U', band: 'custom', f1: '1/256', f2: '0.25' }] }).specs;
  assert.deepEqual(spec, { action: 'minimize', measure: 'peak', input: 'U', band: 'custom', f1: 1 / 256, f1Text: '1/256', f2: 0.25 });
  assert.deepEqual(specIntervals(spec, null), [[1 / 256, 0.25]]);
  // Saved and normalized again, it stays.
  assert.deepEqual(normalizeOptimizeSetup({ specs: [spec] }).specs[0], spec);
});

import { constraintMiss, parseConstraints } from '../src/core/analysis/optimize.js';

test('coefficient constraints: typed as relations, kept by the search like a limit', () => {
  const parsed = parseConstraints('c_1 >= c_2; c_2 >= 2*c_3\n a < b');
  assert.deepEqual(parsed.map((c) => [c.text, c.relation]), [['c_1 >= c_2', '>='], ['c_2 >= 2*c_3', '>='], ['a < b', '<']]);
  assert.throws(() => parseConstraints('c_1 = c_2'), /form a >= b/);
  assert.throws(() => parseConstraints('c_1 >= s'), /c_1 >= s/);
  // How far short, relative to the sides: 0 when kept, a hair at equality for a strict one.
  const [kept] = parseConstraints('c_1 >= c_2');
  assert.equal(constraintMiss(kept, { c_1: 2, c_2: 1 }), 0);
  assert.equal(constraintMiss(kept, { c_1: 1, c_2: 2 }), 0.5);
  assert.ok(constraintMiss(parseConstraints('a < b')[0], { a: 1, b: 1 }) > 0);
  // The textbook loop has k_2 = 2 k_1 (stable only for k_1 < k_2); asked
  // for k_2 >= 3 k_1, the search finds a loop that keeps it.
  const circuit = modulator();
  const problem = { output: 'V', sources: { U: 'input', QZ1: 'input' }, band: { f0: 0, bw: 1 / 64 }, values: { k_1: 1, k_2: 2 },
    setup: { specs: [{ action: 'minimize', measure: 'average', input: 'QZ1', band: 'signal' }], constraints: 'k_2 >= 3*k_1' } };
  const objective = prepareObjective(circuit, problem);
  assert.equal(objective.evaluate({ k_1: 1, k_2: 2 }).broken, 1);
  const result = runOptimization(circuit, problem, { evaluations: 300, seed: 2 });
  assert.equal(result.feasible, true);
  assert.ok(result.best.values.k_2 >= 3 * result.best.values.k_1 * (1 - 1e-9), JSON.stringify(result.best.values));
  assert.equal(prepareObjective(circuit, { ...problem, setup: { ...problem.setup, constraints: 'k_2 => k_1' } }).ok, false);
});

test('a run traces nets for the oscilloscope: sampled once a sample, continuous between samples too', () => {
  const sim = prepareSimulation(modulator(), { values: { k_1: 1, k_2: 2 }, sources: {}, input: 'U', output: 'name:V', samples: 256 });
  assert.ok(sim.ok, sim.error);
  const v = sim.signals.findIndex((s) => s.key === 'name:V');
  const { waves } = sim.run(-6, { waves: [v] });
  assert.equal(waves.length, 1);
  assert.equal(waves[0].t.length, 256);
  assert.deepEqual(waves[0].t.slice(0, 3), [0, 1, 2]);
  assert.ok(waves[0].v.every((x) => x === 1 || x === -1), 'a single-bit output');
  const ct = diagram(['add input U --at -1200 0', 'add signal_sum S1 --at -800 0', 'add tf_s H1 --at -400 0 --value "1/s"', 'add sampler SMP1 --at 0 0', 'add quantizer QZ1 --at 400 0', 'add output V --at 800 0',
    'add tf_s D1 --at 0 400 --rot 180 --value "(1 - exp(-s*T))/s"', 'add gain K1 --at -400 400 --rot 180 --value k_1',
    'connect U.p S1.w', 'connect S1.e H1.in', 'connect H1.out SMP1.in', 'connect SMP1.out QZ1.in', 'connect QZ1.out V.p', 'connect V.p D1.in', 'connect D1.out K1.in', 'connect K1.out S1.s'], [['S1', 's']]);
  const csim = prepareSimulation(ct, { values: { k_1: 1, T: 1 }, sources: {}, input: 'U', output: 'name:V', samples: 128, subSteps: 4 });
  assert.ok(csim.ok, csim.error);
  const h = csim.signals.findIndex((s) => s.domain === 's' && s.role === 'state');
  const [wave] = csim.run(-6, { waves: [h] }).waves;
  assert.ok(wave.t.length >= 4 * 128, String(wave.t.length));
  assert.ok(wave.t.some((t) => !Number.isInteger(t)), 'points between samples');
  assert.ok(wave.t.every((t, i) => !i || t >= wave.t[i - 1]), 'in time order');
});

test('a dither source: a source in the transfer functions, random numbers in the simulation', async () => {
  const { signalFlowGraph } = await import('../src/core/analysis/signal-flow.js');
  const { parseDither } = await import('../src/core/transfer-function.js');
  assert.deepEqual(parseDither('tri ±1/2'), { shape: 'tri', amplitude: 0.5 });
  assert.deepEqual(parseDither('uniform 2'), { shape: 'rect', amplitude: 2 });
  assert.deepEqual(parseDither('rect ±1 FS'), { shape: 'rect', amplitude: 1 });
  assert.throws(() => parseDither('rect'), /amplitude/);
  // Dither into the quantizer's sum, through a gain d_1.
  const integrator = '"tf([0 1], [1 -1])"';
  const circuit = diagram(['add input U --at -1600 0', 'add signal_sum S1 --at -1200 0', `add tf_z H1 --at -800 0 --value ${integrator}`, 'add signal_sum S3 --at -400 0', `add tf_z H2 --at 0 0 --value ${integrator}`,
    'add signal_sum S4 --at 400 0', 'add quantizer QZ1 --at 800 0', 'add output V --at 1200 0', 'add gain K1 --at -800 400 --rot 180 --value k_1', 'add gain K2 --at 0 400 --rot 180 --value k_2',
    'add dither DTH1 --at 0 -480 --value "rect 1"', 'add gain KD --at 400 -320 --rot 90 --value d_1',
    'connect U.p S1.w', 'connect S1.e H1.in', 'connect H1.out S3.w', 'connect S3.e H2.in', 'connect H2.out S4.w', 'connect S4.e QZ1.in', 'connect QZ1.out V.p', 'connect K1.out S1.s', 'connect K2.out S3.s',
    'connect V.p K1.in', 'connect V.p K2.in', 'connect DTH1.out KD.in', 'connect KD.out S4.n'], [['S1', 's'], ['S3', 's']]);
  const { sources } = signalFlowGraph(circuit);
  const dither = sources.find((s) => s.dither);
  assert.equal(dither.id, 'DTH1');
  assert.equal(dither.name, 'DTH_{1}');
  // The sine cannot drive it; the runs differ with and without it, the same each time.
  assert.equal(prepareSimulation(circuit, { values: { k_1: 1, k_2: 2, d_1: 0.5 }, sources: {}, input: 'DTH1', output: 'name:V' }).ok, false);
  const run = (d) => prepareSimulation(circuit, { values: { k_1: 1, k_2: 2, d_1: d }, sources: {}, input: 'U', output: 'name:V', samples: 1024 }).run(-6, { record: true }).samples;
  const quiet = run(0);
  const dithered = run(0.5);
  assert.notDeepEqual(Array.from(quiet), Array.from(dithered));
  assert.deepEqual(Array.from(dithered), Array.from(run(0.5)));
});

test('a swing limit aimed at is a goal too: each dB a net stays under it is lost', () => {
  const circuit = modulator();
  const sim = prepareSimulation(circuit, { values: { k_1: 1, k_2: 2 }, input: 'U', output: 'name:V' });
  const state = sim.signals.find((s) => s.role === 'state').key;
  const base = { output: 'V', sources: { U: 'input' }, band: { f0: 0, bw: 1 / 64 }, values: { k_1: 1, k_2: 2 }, ...QUICK, swingGuard: 0 };
  const limit = (targets) => prepareObjective(circuit, { ...base, setup: { swing: { on: true, amplitude: -6, input: 'U', limits: { [state]: 20 }, targets } } });
  const plain = limit({});
  const aimed = limit({ [state]: true });
  assert.equal(plain.goals, 0);
  assert.equal(aimed.goals, 1);
  const level = plain.evaluate({ k_1: 1, k_2: 2 });
  const goal = aimed.evaluate({ k_1: 1, k_2: 2 });
  assert.equal(level.violation, 0);
  assert.equal(level.goal, 0);
  assert.ok(Math.abs(goal.goal - (20 - goal.swing.levels[state])) < 1e-9, `${goal.goal} vs ${goal.swing.levels[state]}`);
});

test('the dither\'s gains are named, though no transfer function holds them', async () => {
  const { ditherSymbols } = await import('../src/core/analysis/signal-flow.js');
  const circuit = diagram(['add dither DTH1 --at 0 0', 'add gain KD --at 240 0 --value d_1', 'add gain KE --at 480 0 --value 2*e_1', 'add signal_sum S4 --at 720 0',
    'connect DTH1.out KD.in', 'connect KD.out KE.in', 'connect KE.out S4.w']);
  assert.deepEqual(ditherSymbols(circuit), ['d_1', 'e_1']);
  assert.deepEqual(ditherSymbols(modulator()), []);
});

test('a dither source\'s amplitude is in full scale: rect 1 is +-FS of the largest quantizer', () => {
  // The dither straight into a 5-level quantizer's output path: V is the
  // dither itself, through a gain of 1 into an output (no loop).
  const circuit = diagram(['add dither DTH1 --at 0 0 --value "rect 1"', 'add gain KD --at 240 0 --value 1', 'add quantizer QZ1 --at 640 400 --value 5', 'add input U --at 240 400', 'add output V --at 640 0', 'add output W --at 1000 400',
    'connect DTH1.out KD.in', 'connect KD.out V.p', 'connect U.p QZ1.in', 'connect QZ1.out W.p']);
  const sim = prepareSimulation(circuit, { values: {}, sources: {}, input: 'U', output: 'name:V', samples: 4096 });
  assert.ok(sim.ok, sim.error);
  assert.equal(sim.fullScale, 4);
  const v = Array.from(sim.run(-60, { record: true }).samples);
  const peak = Math.max(...v.map(Math.abs));
  assert.ok(peak > 3.9 && peak <= 4, `peak ${peak}`);
});

test('binary and ternary dither: two and three levels', async () => {
  const { parseDither } = await import('../src/core/transfer-function.js');
  assert.deepEqual(parseDither('binary 1'), { shape: 'bin', amplitude: 1 });
  assert.deepEqual(parseDither('tern 0.5'), { shape: 'tern', amplitude: 0.5 });
  const levelsOf = (value) => {
    const circuit = diagram([`add dither DTH1 --at 0 0 --value "${value}"`, 'add gain KD --at 240 0 --value 1', 'add input U --at 240 400', 'add quantizer QZ1 --at 640 400 --value 3', 'add output V --at 640 0', 'add output W --at 1000 400',
      'connect DTH1.out KD.in', 'connect KD.out V.p', 'connect U.p QZ1.in', 'connect QZ1.out W.p']);
    const sim = prepareSimulation(circuit, { values: {}, sources: {}, input: 'U', output: 'name:V', samples: 1024 });
    return [...new Set(sim.run(-60, { record: true }).samples)].sort((a, b) => a - b);
  };
  // Full scale 2 (three levels): bin 1 is +-2, tern 1 is -2, 0, 2.
  assert.deepEqual(levelsOf('bin 1'), [-2, 2]);
  assert.deepEqual(levelsOf('tern 1'), [-2, 0, 2]);
});
