import test from 'node:test';
import assert from 'node:assert/strict';
import { axisName, bodeSpecs, dataSpec, locusSpec, plotSpec, responseSpec, stepSpec, swingSpec, waveSpec } from '../src/core/plot-spec.js';

test('a response becomes a log-frequency plot with its band, markers, and a start trace', () => {
  const spec = responseSpec({
    kind: 'response', axis: 'normalized', range: { low: -4, high: Math.log10(0.5) }, band: [0.01], markers: [{ f: 0.1, label: 'PM 60°' }],
    traces: [{ label: 'a', color: '#111', points: [{ f: 1e-4, db: -40 }, { f: 0.5, db: 3 }] }, { label: 'b', color: '#222', start: true, points: [{ f: 1e-4, db: -30 }, { f: 0.5, db: 0 }] }],
  });
  assert.equal(spec.x.scale, 'log');
  assert.equal(spec.x.label, 'f/f_{s}');
  assert.deepEqual(spec.x.range, [1e-4, 0.5]);
  assert.deepEqual(spec.series.map((s) => s.role), ['curve', 'start']);
  assert.deepEqual(spec.series[0].points, [[1e-4, -40], [0.5, 3]]);
  assert.deepEqual(spec.vlines, [{ x: 0.01, role: 'band' }, { x: 0.1, role: 'marker', label: 'PM 60°' }]);
  assert.notEqual(responseSpec({ axis: 'normalized', range: { low: -4, high: 0 }, quantity: 'phase', traces: [] }).key, spec.key, 'phase is another view');
});

test('steps, swings, loci, Bode sketches, and waveforms all become specs', () => {
  const step = stepSpec({ unit: 'n', range: { low: 0, high: 10 }, traces: [{ label: 'a', color: '#111', stairs: true, points: [{ t: 0, y: 0 }, { t: 1, y: 1 }] }] });
  assert.equal(step.series[0].stairs, true);
  const swing = swingSpec({ range: { low: -60, high: 3 }, traces: [{ label: 'x', color: '#111', points: [{ a: -60, db: -50 }, { a: -10, db: -1 }, { a: 0, db: 2 }] }] });
  assert.deepEqual(swing.vlines.map((line) => line.role), ['zero', 'marker'], 'no input, and where to stop');
  assert.match(swing.vlines[1].label, /full scale/);
  const locus = locusSpec({ variable: 'z', parameter: 'k', label: 'H', color: '#111', from: 0, to: 2, points: [{ re: 0.5, im: 0.1, t: 0 }, { re: 9, im: 0, t: 1 }], current: [{ re: 0.4, im: 0 }], crossings: [{ k: 1.5, becomes: 'unstable' }] });
  assert.equal(locus.equal, true);
  assert.equal(locus.series.find((s) => s.role === 'curve').points.length, 1, 'a pole far outside the unit circle is left out');
  assert.match(locus.notes[1].text, /unstable from k = 1.5/);
  const bode = bodeSpecs({ range: { low: -2, high: 2 }, points: [{ w: 0.01, db: 20, phase: 0 }, { w: 100, db: -20, phase: -90 }], asymptote: [{ w: 0.01, db: 20 }, { w: 100, db: -20 }], unityGain: { w: 1, phase: -45 } }, { corners: [{ w: 0.1, text: 'ω_{p1}' }] });
  assert.deepEqual(bode.magnitude.vlines.map((v) => v.label), ['ω_{p1}', 'ω_{u}']);
  assert.deepEqual(bode.phase.vlines.map((v) => v.label), ['', '']);
  const wave = waveSpec([{ label: 'V', color: '#111', values: [0, 1, NaN, 2] }], { start: 100 });
  assert.deepEqual(wave.series[0].points, [[100, 0], [101, 1], [102, null], [103, 2]]);
});

test('a trace\'s TeX label reads as axis markup, subscripts and all', () => {
  assert.equal(axisName('\\frac{V_{OUT}}{V_{INP}}'), 'V_{OUT}/V_{INP}');
  assert.equal(axisName('\\frac{VOUT}{VIN}'), 'VOUT/VIN');
  assert.equal(axisName('Z_{out}(V_{OUT})'), 'Z_{out}(V_{OUT})');
  assert.equal(axisName('\\beta_{U1}'), 'β_{U1}');
});

test('a data plot\'s spec keeps each axis\'s scale and name, and its traces as they are', () => {
  const spec = dataSpec({ kind: 'data', x: { label: 'f', scale: 'log' }, y: { label: 'V', scale: 'log' }, traces: [{ label: 'a', color: '#ff0000', points: [[1, 2], [10, 20]] }] });
  assert.deepEqual([spec.x, spec.y], [{ scale: 'log', label: 'f' }, { scale: 'log', label: 'V' }]);
  assert.deepEqual(spec.series[0].points, [[1, 2], [10, 20]]);
  assert.deepEqual(spec.hlines, []);
  assert.notEqual(spec.key, dataSpec({ kind: 'data', x: { label: '', scale: 'log' }, y: { label: '', scale: 'linear' }, traces: [] }).key);
});

test('an analysis plot\'s spec draws the traces added from files over its own; a Bode sketch has none', () => {
  const spec = plotSpec({ kind: 'response', axis: 'relative', range: { low: 0, high: 2 }, traces: [{ label: 'H', color: '#111111', points: [{ f: 1, db: 0 }, { f: 100, db: -40 }] }], extra: [{ label: 'sim', color: '#df4d59', points: [[1, 0], [100, -39]] }] });
  assert.deepEqual(spec.series.map((s) => s.label), ['H', 'sim']);
  assert.deepEqual(spec.series[1].points, [[1, 0], [100, -39]]);
  const locus = plotSpec({ kind: 'locus', variable: 's', label: 'L', parameter: 'k', from: 0, to: 1, color: '#111111', points: [{ re: -1, im: 0, t: 0 }], current: [], extra: [{ label: 'm', color: '#df4d59', points: [[-1, 0], [-1, 1]] }] });
  assert.equal(locus.series.at(-1).parametric, true);
  assert.equal(plotSpec({ points: [] }), null);
});

test("a response trace's asymptote is drawn under it in its color, saved with it, and no marker lands on it", async () => {
  const { normalizePlot } = await import('../src/core/model.js');
  const { cursorCurves } = await import('../src/core/plot-cursors.js');
  const plot = normalizePlot({
    kind: 'response', axis: 'omega', range: { low: -1, high: 2 },
    traces: [
      { label: 'A_v', color: '#3b74e0', points: [{ f: 0.1, db: 20 }, { f: 100, db: -40 }], asymptote: [{ f: 0.1, db: 20 }, { f: 1, db: 20 }, { f: 100, db: -20 }, { f: 'x', db: 0 }] },
      { label: 'Z_out', color: '#e0743b', points: [{ f: 0.1, db: 0 }, { f: 100, db: 0 }], asymptote: [{ f: 1, db: 0 }] },
    ],
  });
  // Kept: its finite points; one point is no line.
  assert.deepEqual(plot.traces[0].asymptote, [{ f: 0.1, db: 20 }, { f: 1, db: 20 }, { f: 100, db: -20 }]);
  assert.equal('asymptote' in plot.traces[1], false);
  const spec = plotSpec(plot);
  assert.deepEqual(spec.series.map((s) => [s.role, s.trace, s.color]), [['asymptote', 0, '#3b74e0'], ['curve', 0, '#3b74e0'], ['curve', 1, '#e0743b']]);
  assert.deepEqual(spec.series[0].points, [[0.1, 20], [1, 20], [100, -20]]);
  assert.deepEqual(cursorCurves(spec).map((c) => c.label), ['A_v', 'Z_out']);
});

test('a Bode sketch shows its magnitude and phase asymptotes, or neither', () => {
  const sketch = {
    range: { low: -1, high: 1 },
    points: [{ w: 0.1, db: 0, phase: 0 }, { w: 10, db: -20, phase: -84 }],
    asymptote: [{ w: 0.1, db: 0 }, { w: 1, db: 0 }, { w: 10, db: -20 }],
    phaseAsymptote: [{ w: 0.1, phase: 0 }, { w: 10, phase: -90 }],
    unityGain: null,
  };
  const on = bodeSpecs(sketch);
  assert.deepEqual(on.magnitude.series.map((s) => s.role), ['asymptote', 'curve']);
  assert.deepEqual(on.phase.series.map((s) => s.role), ['asymptote', 'curve']);
  assert.deepEqual(on.phase.series[0].points, [[0.1, 0], [10, -90]]);
  const off = bodeSpecs(sketch, { asymptotes: false });
  assert.deepEqual([off.magnitude.series.map((s) => s.role), off.phase.series.map((s) => s.role)], [['curve'], ['curve']]);
});
