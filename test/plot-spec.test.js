import test from 'node:test';
import assert from 'node:assert/strict';
import { bodeSpecs, locusSpec, responseSpec, stepSpec, swingSpec, waveSpec } from '../src/core/plot-spec.js';

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
  assert.equal(swing.vlines[0].role, 'marker');
  assert.match(swing.vlines[0].label, /full scale/);
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
