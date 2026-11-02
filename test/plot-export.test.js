import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit, normalizePlot } from '../src/core/model.js';
import { runCommand } from '../src/core/commands.js';
import { plainName, plotCsv, plotSeries } from '../src/core/plot-export.js';
import { bodeSketch } from '../src/core/analysis/bode.js';

const response = () => normalizePlot({
  kind: 'response', axis: 'relative', range: { low: 0, high: 2 },
  traces: [
    { label: '\\frac{V_{OUT}}{V_{IN}}', points: [{ f: 1, db: 0 }, { f: 10, db: -3.01 }, { f: 100, db: -20 }] },
    { label: 'H_{2}', points: [{ f: 1, db: -1 }, { f: 10, db: -2 }, { f: 100, db: -3 }] },
  ],
});

test('a heading reads a TeX or markup name plainly', () => {
  assert.equal(plainName('\\frac{V_{OUT}}{V_{IN}}'), 'V_OUT/V_IN');
  assert.equal(plainName('$\\text{gain}^{2}$'), 'gain^2');
  assert.equal(plainName(''), '');
});

test('curves on the same x share one column; others each bring their own', () => {
  assert.equal(plotCsv(response()), 'ω (rad/s),V_OUT/V_IN (dB),H_2 (dB)\n1,0,-1\n10,-3.01,-2\n100,-20,-3\n');
  assert.equal(plotCsv(response(), { traces: [1] }), 'ω (rad/s),H_2 (dB)\n1,-1\n10,-2\n100,-3\n');
  const data = normalizePlot({ kind: 'data', x: { label: 't' }, y: {}, traces: [{ label: 'a', points: [[0, 1], [1, 2], [2, 3]] }, { label: 'b, c', points: [[0, 5], [3, 6]] }] });
  assert.equal(plotCsv(data), 't [a],a,"t [b, c]","b, c"\n0,1,0,5\n1,2,3,6\n2,3,,\n');
});

test('decimal commas go with a semicolon or tab, never a comma', () => {
  assert.equal(plotCsv(response(), { traces: [0], separator: ';', decimal: ',' }), 'ω (rad/s);V_OUT/V_IN (dB)\n1;0\n10;-3,01\n100;-20\n');
  assert.throws(() => plotCsv(response(), { decimal: ',' }), /decimal commas need a semicolon or tab/);
  assert.throws(() => plotCsv(response(), { traces: [5] }), /no trace 6/);
});

test('every kind of plot gives its numbers: steps, swings, a root locus, a Bode sketch', () => {
  const step = normalizePlot({ kind: 'step', unit: 't', range: { low: 0, high: 1 }, traces: [{ label: 'y', points: [{ t: 0, y: 0 }, { t: 1, y: 1 }] }] });
  assert.deepEqual(plotSeries(step)[0].columns, ['t (s)', 'y']);
  const swing = normalizePlot({ kind: 'swing', range: { low: -60, high: 0 }, traces: [{ label: 'v_1', points: [{ a: -60, db: -50 }, { a: 0, db: null }] }] });
  assert.equal(plotCsv(swing), 'input (dBFS),v_1 (dBFS)\n-60,-50\n0,\n');
  const locus = normalizePlot({ kind: 'locus', label: 'H', parameter: 'k', points: [{ re: -1, im: 0, t: 0 }, { re: -1, im: 1, t: 1 }] });
  assert.deepEqual(plotSeries(locus)[0].columns, ['Re', 'Im', 'k sweep (0 to 1)']);
  const bode = normalizePlot({ ...bodeSketch([100], [1, 100]), quantity: 'A_{v}' });
  const [curve, asymptote] = plotSeries(bode);
  assert.deepEqual(curve.columns, ['ω (rad/s)', '|A_v| (dB)', '∠A_v (°)']);
  assert.equal(asymptote.name, 'Asymptote');
});

test('plotcsv gives a plot\'s numbers as CSV text, and says what is wrong', () => {
  const circuit = new Circuit();
  const box = circuit.addAnnotation('box', { x: 0, y: 0, end: { x: 720, y: 440 }, plot: response() });
  const out = runCommand(circuit, `annotation plotcsv ${box.id} --traces 2 --decimal comma`);
  assert.equal(out.mutated, false);
  assert.equal(out.json.csv, 'ω (rad/s);H_2 (dB)\n1;-1\n10;-2\n100;-3\n');
  assert.deepEqual(out.json.traces, ['V_OUT/V_IN', 'H_2']);
  assert.throws(() => runCommand(circuit, `annotation plotcsv ${box.id} --sep pipe`), /--sep is comma, semicolon, or tab/);
  assert.throws(() => runCommand(circuit, `annotation plotcsv ${box.id} --traces x`), /--traces lists trace numbers/);
  const plain = circuit.addAnnotation('box', { x: 0, y: 800, end: { x: 400, y: 1000 } });
  assert.throws(() => runCommand(circuit, `annotation plotcsv ${plain.id}`), /is not a plot/);
});

test('a plot\'s traces added from files export after its own, in its units', () => {
  const plot = normalizePlot({ ...response(), extra: [{ label: 'sim', points: [[1, -0.5], [100, -19]] }] });
  const series = plotSeries(plot);
  assert.deepEqual(series.map((s) => s.name), ['V_OUT/V_IN', 'H_2', 'sim']);
  assert.deepEqual(series[2].columns, ['ω (rad/s)', 'sim (dB)']);
  assert.equal(plotCsv(plot, { traces: [2] }), 'ω (rad/s),sim (dB)\n1,-0.5\n100,-19\n');
});
