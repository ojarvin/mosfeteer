import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { runCommand } from '../src/core/commands.js';
import { getSymbol } from '../src/core/components/index.js';
import { parseRate } from '../src/core/transfer-function.js';
import { analyzeSignalFlow, responsePlot } from '../src/core/analysis/signal-flow.js';
import { prepareSimulation } from '../src/core/analysis/simulate.js';
import { simulatedSpectrum } from '../src/core/analysis/spectrum-run.js';
import { dbfsOffset, dbfsSpectrum, inBand } from '../src/core/analysis/spectrum.js';
import { svgString, texToMathML } from '../src/core/render.js';

function diagram(lines, negatives = []) {
  const circuit = new Circuit();
  for (const line of lines) runCommand(circuit, line);
  for (const [refdes, term] of negatives) circuit.setSignalInputNegative(refdes, term, true);
  return circuit;
}

const integrator = 'tf([0 1], [1 -1])';

/** A first-order single-bit modulator, V its output, then a two-tap
 *  average, a downsampler by 2, and another average at the slow rate. */
const MODULATOR = [
  'add input U --at -720 0', 'add signal_sum SUM1 --at -400 0', `add tf_z H1 --at 0 0 --value "${integrator}"`,
  'add quantizer Q1 --at 400 0', 'add output V --at 760 0',
  'connect U.p SUM1.w', 'connect SUM1.e H1.in', 'connect H1.out Q1.in', 'connect Q1.out V.p', 'connect V.p SUM1.s',
];
const DECIMATED = [
  ...MODULATOR,
  'add tf_z F1 --at 1160 0 --value "tf([1 1], [2])"', 'add downsample D1 --at 1560 0 --value 2',
  'add tf_z F2 --at 1960 0 --value "tf([1 1], [2])"', 'add output Y --at 2360 0',
  'connect V.p F1.in', 'connect F1.out D1.in', 'connect D1.out F2.in', 'connect F2.out Y.p',
];

test('a rate changer is a box with its factor inside, a whole number of at least 2', () => {
  for (const type of ['downsample', 'upsample']) {
    const symbol = getSymbol(type);
    assert.deepEqual(symbol.terminals.map((t) => [t.name, t.x, t.y, t.signalRole]), [['in', -80, 0, 'input'], ['out', 80, 0, 'output']]);
    assert.deepEqual(symbol.bbox, { x: -80, y: -80, w: 160, h: 160 });
  }
  const circuit = diagram(['add downsample D1 --at 0 0', 'add upsample I1 --at 400 0 --value 4']);
  circuit.setValue('D1', 'M = 8');
  const labels = [...circuit.labels.values()].filter((label) => label.owner).map((label) => [label.owner, label.text, label.offset.x, label.offset.y]);
  assert.deepEqual(labels, [['D1', '$\\downarrow 8$', 0, 0], ['I1', '$\\uparrow 4$', 0, 0]]);
  // Drawn as the arrow, not its name.
  assert.match(texToMathML('$\\downarrow 8$'), /↓/);
  assert.doesNotMatch(texToMathML('$\\uparrow 4$'), /uparrow/);
  // A wire into it carries an arrowhead, as one into a block does.
  const wired = diagram(['add input U --at 0 0', 'add downsample D1 --at 400 0', 'connect U.p D1.in']);
  assert.equal((svgString(wired).match(/<polygon/g) || []).length, 1);
  assert.equal(parseRate('↓16'), 16);
  assert.throws(() => circuit.setValue('D1', '1'), /at least 2/);
  assert.throws(() => parseRate('k'), /whole number/);
});

test('a decimation chain is solved at the fastest rate: an H(z) after a downsampler by M is H(z^M)', () => {
  const report = analyzeSignalFlow(diagram(DECIMATED, [['SUM1', 's']]), { output: 'Y', sources: { U: 'input', Q1: 'input' } });
  assert.equal(report.ok, true, report.error);
  assert.deepEqual(report.output, { key: 'name:Y', name: 'Y', decimation: 2 });
  const byInput = Object.fromEntries(report.entries.map((entry) => [entry.input, entry.equation]));
  // z^-1 (1 + z^-1)/2 (1 + z^-2)/2, and the NTF (1 - z^-1) through the same.
  assert.equal(byInput.U, '\\frac{Y}{U} = \\frac{1}{4} z^{-1} + \\frac{1}{4} z^{-2} + \\frac{1}{4} z^{-3} + \\frac{1}{4} z^{-4}');
  assert.equal(byInput.Q1, '\\frac{Y}{E_{Q1}} = \\frac{1}{4} - \\frac{1}{4} z^{-4}');
  // The loop's own output is at the fastest rate.
  const fast = analyzeSignalFlow(diagram(DECIMATED, [['SUM1', 's']]), { output: 'V', sources: { U: 'input' } });
  assert.deepEqual(fast.output, { key: 'name:V', name: 'V' });
  // Before an upsampler by L, an H(z) is H(z^L): its input runs L times slower.
  const up = analyzeSignalFlow(diagram([
    'add input U --at 0 0', 'add tf_z F1 --at 400 0 --value "tf([1 1], [1])"', 'add upsample I1 --at 800 0 --value 2', 'add output Y --at 1200 0',
    'connect U.p F1.in', 'connect F1.out I1.in', 'connect I1.out Y.p',
  ]), { output: 'Y', sources: { U: 'input' } });
  assert.equal(up.ok, true, up.error);
  assert.equal(up.entries[0].equation, '\\frac{Y}{U} = 1 + z^{-2}');
  assert.equal(up.output.decimation, undefined);
});

test('rates are refused where the noble identities do not hold: in a loop, an upsampler after a downsampler, a junction of two rates', () => {
  const inLoop = diagram([
    ...MODULATOR.filter((line) => line !== 'connect V.p SUM1.s'),
    'add downsample D2 --at 0 400 --value 2', 'connect V.p D2.in', 'connect D2.out SUM1.s',
  ], [['SUM1', 's']]);
  const loop = analyzeSignalFlow(inLoop, { output: 'V', sources: { U: 'input' } });
  assert.equal(loop.code, 'rate-change-in-loop');
  assert.match(loop.error, /D2 changes the rate inside a feedback loop/);
  const after = analyzeSignalFlow(diagram([
    'add input U --at 0 0', 'add downsample D1 --at 400 0 --value 2', 'add upsample I1 --at 800 0 --value 2', 'add output Y --at 1200 0',
    'connect U.p D1.in', 'connect D1.out I1.in', 'connect I1.out Y.p',
  ]), { output: 'Y', sources: { U: 'input' } });
  assert.equal(after.code, 'upsample-after-downsample');
  const joined = analyzeSignalFlow(diagram([
    'add input U --at 0 0', 'add downsample D1 --at 400 -400 --value 2', 'add signal_sum S1 --at 800 0', 'add output Y --at 1200 0',
    'connect U.p D1.in', 'connect D1.out S1.n', 'connect U.p S1.w', 'connect S1.e Y.p',
  ]), { output: 'Y', sources: { U: 'input' } });
  assert.equal(joined.code, 'mixed-rates');
  assert.match(joined.error, /S1 joins signals of two rates/);
  // A rate changer on a continuous signal, with no sampler.
  const continuous = analyzeSignalFlow(diagram([
    'add input U --at 0 0', 'add tf_s H1 --at 400 0 --value "tf([1], [1 1])"', 'add downsample D1 --at 800 0 --value 2', 'add output Y --at 1200 0',
    'connect U.p H1.in', 'connect H1.out D1.in', 'connect D1.out Y.p',
  ]), { output: 'Y', sources: { U: 'input' } });
  assert.equal(continuous.code, 'mixed-domains');
  // With a sampler, a DAC reads the sampler's rate only.
  const dac = analyzeSignalFlow(diagram([
    'add input U --at -400 0', 'add sampler SMP1 --at 0 0', 'add downsample D1 --at 400 0 --value 2', 'add tf_dac DAC1 --at 800 0', 'add sampler SMP2 --at 1200 0', 'add output Y --at 1600 0',
    'connect U.p SMP1.in', 'connect SMP1.out D1.in', 'connect D1.out DAC1.in', 'connect DAC1.out SMP2.in', 'connect SMP2.out Y.p',
  ]), { output: 'Y', sources: { U: 'input' } });
  assert.equal(dac.code, 'dac-rate');
});

test('the simulation runs each rate at its own samples: a downsampled output, and an upsampler\'s zeros', () => {
  const circuit = diagram(DECIMATED, [['SUM1', 's']]);
  const common = { sources: { U: 'input' }, input: 'U', frequency: 1 / 64, warmup: 0 };
  const fast = prepareSimulation(circuit, { ...common, output: 'name:V', samples: 256 });
  // The window counts the output's samples: 128 of Y take 256 ticks.
  const slow = prepareSimulation(circuit, { ...common, output: 'name:Y', samples: 128 });
  assert.equal(slow.ok, true, slow.error);
  assert.equal(slow.decimation, 2);
  assert.equal(slow.signals.find((s) => s.key === 'name:Y').ticks, 2);
  const v = fast.run(-6, { record: true }).samples;
  const y = slow.run(-6, { record: true }).samples;
  const f1 = Array.from(v, (x, n) => (x + (n ? v[n - 1] : 0)) / 2);
  const kept = f1.filter((_, n) => n % 2 === 0);
  assert.deepEqual(Array.from(y), kept.map((x, k) => (x + (k ? kept[k - 1] : 0)) / 2));
  // The time view traces a slower net once a sample of its own.
  const index = slow.signals.findIndex((s) => s.key === 'name:Y');
  const wave = slow.run(-6, { waves: [index] }).waves[0];
  assert.deepEqual(wave.t.slice(0, 4), [0, 2, 4, 6]);
  const up = prepareSimulation(diagram(['add input U --at 0 0', 'add upsample I1 --at 400 0 --value 4', 'add output Y --at 800 0', 'connect U.p I1.in', 'connect I1.out Y.p']),
    { sources: { U: 'input' }, input: 'U', output: 'name:Y', frequency: 1 / 64, samples: 64, warmup: 0 });
  const zeros = Array.from(up.run(0, { record: true }).samples.slice(0, 9)).map((x) => Number(x.toFixed(4)));
  assert.deepEqual(zeros, [0, 0, 0, 0, 0.3827, 0, 0, 0, 0.7071]);
});

test('a decimated spectrum is in f/fs of the ticks, and the NTF folded at the output\'s rate predicts its noise', () => {
  const M = 8;
  // sinc^3 of length M as one FIR.
  let taps = [1];
  for (let i = 0; i < 3; i++) {
    const next = new Array(taps.length + M - 1).fill(0);
    taps.forEach((t, a) => { for (let b = 0; b < M; b++) next[a + b] += t; });
    taps = next;
  }
  const circuit = diagram([
    'add input U --at -1200 0', 'add signal_sum SUM1 --at -880 0', `add tf_z H1 --at -560 0 --value "${integrator}"`,
    'add signal_sum SUM2 --at -160 0', `add tf_z H2 --at 160 0 --value "${integrator}"`, 'add quantizer Q1 --at 560 0',
    'add output V --at 880 0', 'add gain G --at -160 400 --value 2',
    'connect U.p SUM1.w', 'connect SUM1.e H1.in', 'connect H1.out SUM2.w', 'connect SUM2.e H2.in', 'connect H2.out Q1.in',
    'connect Q1.out V.p', 'connect V.p SUM1.s', 'connect V.p G.in', 'connect G.out SUM2.s',
    `add tf_z F1 --at 2400 -1200 --value "tf([${taps.join(' ')}], [${M ** 3}])"`, `add downsample D1 --at 9600 -1200 --value ${M}`, 'add output Y --at 10000 -1200',
    'connect F1.out D1.in', 'connect Q1.out F1.in', 'connect D1.out Y.p',
  ], [['SUM1', 's'], ['SUM2', 's']]);
  const segment = 4096;
  const result = simulatedSpectrum({ circuit: circuit.toJSON(), options: { sources: { U: 'input' }, input: 'U', output: 'name:Y', frequency: 3 / segment, samples: 8 * segment, segment }, amplitude: -12, segment });
  assert.equal(result.raw.decimation, M);
  const measured = dbfsSpectrum(result.raw, result.fullScale);
  // Its bins end at the output's Nyquist, 1/(2M) of the ticks.
  assert.equal(measured.at(-1).f, 0.5 / M);
  // The tone found where it was put, in the ticks' f/fs.
  assert.ok(inBand(result.raw, result.frequency, [1 / 256], { fullScale: result.fullScale }).sndr > 40);
  const [fit] = result.quantizers;
  const linear = analyzeSignalFlow(circuit, { output: 'Y', sources: { U: 'input', Q1: 'input' }, quantizerGains: { Q1: fit.gain } });
  const ntf = linear.entries.find((entry) => entry.input === 'Q1');
  const offset = dbfsOffset(result.raw, result.fullScale, { noise: true }) + 10 * Math.log10(fit.errorVariance * 3);
  const plot = responsePlot([{ label: 'N', color: '#000000', value: ntf.value, variable: 'z', noise: true, decimation: M }], 'z', { dbfs: { offset: () => offset } });
  assert.deepEqual(plot.markers, [{ f: 0.5 / M, label: 'fₛ/16' }]);
  const curve = plot.traces[0].points;
  assert.ok(curve.every((p) => p.f <= 0.5 / M));
  const near = (points, f) => points.reduce((best, p) => (Math.abs(Math.log(p.f / f)) < Math.abs(Math.log(best.f / f)) ? p : best));
  for (const f of [0.005, 0.02, 0.05, 0.06]) {
    const bins = measured.filter((p) => p.f > f / 1.15 && p.f < f * 1.15);
    const mean = 10 * Math.log10(bins.reduce((sum, p) => sum + 10 ** (p.db / 10), 0) / bins.length);
    assert.ok(Math.abs(mean - near(curve, f).db) < 2, `${f}: measured ${mean.toFixed(1)}, folded ${near(curve, f).db.toFixed(1)}`);
  }
  // With a band, the first band folding onto it is marked: 1/M -+ bw.
  const banded = responsePlot([{ label: 'N', color: '#000000', value: ntf.value, variable: 'z', decimation: M }], 'z', { band: { bw: 1 / 64 } });
  assert.deepEqual(banded.markers.map((m) => [Number(m.f.toFixed(6)), m.label]), [[0.0625, 'fₛ/16'], [0.109375, ''], [0.140625, '']]);
});
