import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { runCommand } from '../src/core/commands.js';
import { analyzeSmallSignal } from '../src/core/analysis/index.js';
import {
  DEFAULT_INTRINSIC_GAIN, bodeSketch, evaluateExpression, expressionSymbols, numericCoefficients,
  polynomialRoots, sketchParameters, sketchValues,
} from '../src/core/analysis/bode.js';

const close = (actual, expected, tolerance = 1e-9) => assert.ok(
  Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} ≉ ${expected}`);

function commonSource() {
  const circuit = new Circuit();
  for (const line of ['add nmos M1 --at 0 0', 'add resistor RD --at 0 -240 --rot 90', 'add supply --at 0 -360', 'add ground --at 0 160',
    'add input VIN --at -240 0', 'add output VOUT --at 240 -80', 'add capacitor CL --at 160 40 --rot 90', 'add ground --at 160 160',
    'connect VIN.p M1.g', 'connect M1.s GROUND1.gnd', 'connect M1.d RD.b', 'connect RD.a SUPPLY1.p', 'connect M1.d VOUT.p',
    'connect CL.a M1.d', 'connect CL.b GROUND2.gnd']) runCommand(circuit, line);
  return circuit;
}

test('roots are found alike however many decades apart', () => {
  // (s + 1e-3)(s + 1)(s + 1e3) and a complex pair s^2 + s + 1.
  const roots = polynomialRoots([1, 1001.001, 1001.001, 1]).map((r) => -r.re).sort((a, b) => a - b);
  for (const [root, expected] of roots.map((r, i) => [r, [1e-3, 1, 1e3][i]])) close(root, expected, 1e-8);
  const pair = polynomialRoots([1, 1, 1]);
  assert.equal(pair.length, 2);
  for (const root of pair) { close(root.re, -0.5); close(Math.abs(root.im), Math.sqrt(3) / 2); }
  // Roots at the origin split off exactly.
  assert.deepEqual(polynomialRoots([0, 0, 2]).map((r) => [r.re, r.im]), [[0, 0], [0, 0]]);
});

test('expressions evaluate with every symbol given a value', () => {
  const expression = { kind: 'rational', numerator: { kind: 'symbol', name: 'a' }, denominator: {
    kind: 'add', terms: [{ kind: 'symbol', name: 'b' }, { kind: 'power', base: { kind: 'symbol', name: 'a' }, exponent: 2 }] } };
  assert.equal(evaluateExpression(expression, { a: 2, b: 1 }), 2 / 5);
  assert.deepEqual([...expressionSymbols(expression)].sort(), ['a', 'b']);
  assert.throws(() => evaluateExpression(expression, { a: 2 }), /no value for b/);
});

test('a common-source stage: DC gain gm (ro || RD), one pole at 1/((ro || RD) CL)', () => {
  const circuit = commonSource();
  const report = analyzeSmallSignal(circuit, { input: 'VIN', output: 'VOUT' });
  const exact = report.reports.transfer.exact;
  const symbols = new Set([...exact.numeratorCoefficients, ...exact.denominatorCoefficients].flatMap(({ coefficient }) => [...expressionSymbols(coefficient)]));
  const parameters = sketchParameters(symbols, report.symbolProvenance, { outputComponents: new Set(['CL', 'M1', 'RD']) });
  assert.deepEqual(parameters.map((p) => [p.name, p.kind, p.load]), [
    ['CL', 'capacitance', true], ['RD', 'resistance', false], ['gm1', 'transconductance', false], ['ro1', 'resistance', false]]);
  assert.equal(parameters.find((p) => p.name === 'gm1').tex, 'g_{m1}');
  const values = sketchValues(parameters);
  assert.deepEqual(values, { CL: 10, RD: DEFAULT_INTRINSIC_GAIN, gm1: 1, ro1: DEFAULT_INTRINSIC_GAIN });
  const sketch = bodeSketch(numericCoefficients(exact.numeratorCoefficients, values), numericCoefficients(exact.denominatorCoefficients, values));
  const rout = DEFAULT_INTRINSIC_GAIN / 2;
  close(sketch.points[0].db, 20 * Math.log10(rout), 1e-3);
  assert.equal(sketch.poles.length, 1);
  close(-sketch.poles[0].re, 1 / (rout * 10));
  // An inverting stage starts at ±180°, and one pole takes 90° more.
  close(Math.abs(sketch.points[0].phase), 180, 1e-2);
  close(Math.abs(sketch.points.at(-1).phase - sketch.points[0].phase), 90, 0.1);
  // The asymptote is flat at the DC gain, then falls 20 dB a decade.
  const [start, corner, end] = sketch.asymptote;
  close(start.db, 20 * Math.log10(rout));
  close(corner.w, 1 / (rout * 10));
  close((end.db - corner.db) / Math.log10(end.w / corner.w), -20);
  // Unity gain at gm/CL, one unit over the load.
  close(sketch.unityGain.w, 1 / 10, 0.02);
});

test('a multiplier moves only its own symbol', () => {
  const parameters = sketchParameters(['gm1', 'CL', 'Cgs1'], { gm1: { role: 'gm' }, CL: { role: 'capacitor', component: 'CL' }, Cgs1: { role: 'cgs' } }, { outputComponents: new Set() });
  const values = sketchValues(parameters, { multipliers: { gm1: 10 }, parasiticRatio: 0.5 });
  assert.deepEqual(values, { CL: 1, Cgs1: 0.5, gm1: 10 });
});

test('the figure lays the sketch out in its box, with or without numbers', async () => {
  const { bodeFigure, cornerNames } = await import('../src/core/bode-figure.js');
  // One pole at 0.01, DC gain 100 (40 dB).
  const sketch = bodeSketch([100], [1, 100]);
  const corners = cornerNames(sketch.poles, sketch.zeros);
  assert.deepEqual(corners.map((corner) => corner.text), ['ω_{p1}']);
  const figure = bodeFigure(sketch, { width: 400, height: 240, corners });
  const inside = (p) => p.x >= 0 && p.x <= 400 && p.y >= 0 && p.y <= 240;
  for (const item of figure.items) {
    if (item.type === 'path') assert.ok(item.points.every(inside), item.role);
    else if (item.type === 'line') assert.ok(inside({ x: item.x1, y: item.y1 }) && inside({ x: item.x2, y: item.y2 }), item.role);
  }
  assert.ok(figure.items.some((item) => item.type === 'text' && item.text === 'ω_{p1}'));
  assert.ok(figure.items.some((item) => item.type === 'text' && item.text === 'ω_{u}'));
  assert.deepEqual(figure.ranges.db, [-40, 60]);
  // The textbook sketch: no figures, the marked frequencies stay.
  const bare = bodeFigure(sketch, { numbers: false, phase: false, corners });
  assert.equal(bare.items.filter((item) => item.role === 'number').length, 0);
  assert.equal(bare.panes.phase, null);
  assert.ok(bare.items.some((item) => item.text === 'ω_{p1}'));
});

test('the sketch keeps every word off the plot, names crowding each other in two rows', async () => {
  const { bodeFigure } = await import('../src/core/bode-figure.js');
  // Two poles a factor 1.5 apart, and ω_u: three names close together.
  const sketch = bodeSketch([1000], [1, 1 / 0.01 + 1 / 0.015, 1 / (0.01 * 0.015)]);
  const corners = [{ w: 0.01, text: 'ω_{p1}' }, { w: 0.015, text: 'ω_{p2}' }];
  for (const phase of [false, true]) {
    const figure = bodeFigure(sketch, { width: 640, height: 400, numbers: false, phase, corners, fontSize: 36 });
    const panes = [figure.panes.magnitude, figure.panes.phase].filter(Boolean);
    const texts = figure.items.filter((item) => item.type === 'text');
    for (const text of texts) {
      assert.ok(panes.every((pane) => !(text.x > pane.x + 1 && text.x < pane.x + pane.w - 1 && text.y > pane.y + 1 && text.y < pane.y + pane.h - 1)), `${text.text} is on the plot`);
      assert.ok(text.x >= 0 && text.x <= 640 && text.y <= 400, `${text.text} leaves the box`);
    }
    const rows = new Set(texts.filter((text) => /ω_\{p/.test(text.text)).map((text) => text.y));
    assert.equal(rows.size, 2, 'the two close poles sit in two rows');
  }
});
