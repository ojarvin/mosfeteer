import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { runCommand } from '../src/core/commands.js';
import { swapComponentType } from '../src/core/swap.js';
import { applyTransform } from '../src/core/geometry.js';
import { TRANSFER_FUNCTION_ROLE } from '../src/core/transfer-function.js';
import { analyzeSignalFlow, blockTransferFunction, numericRootsOf, outputChoices, responseCurve, resultSymbols, signalFlowGraph, withCoefficients } from '../src/core/analysis/signal-flow.js';

function diagram(lines, negatives = []) {
  const circuit = new Circuit();
  for (const line of lines) runCommand(circuit, line);
  for (const [refdes, term] of negatives) circuit.setSignalInputNegative(refdes, term, true);
  return circuit;
}

const integrator = 'tf([0 1], [1 -1])'; // z^-1 / (1 - z^-1)

function firstOrderModulator() {
  return diagram([
    'add input U --at -720 0', 'add signal_sum SUM1 --at -400 0', `add tf_z H1 --at 0 0 --value "${integrator}"`,
    'add signal_sum SUM2 --at 400 0', 'add input E --at 400 -280', 'add output V --at 760 0',
    'connect U.p SUM1.w', 'connect SUM1.e H1.in', 'connect H1.out SUM2.w', 'connect E.p SUM2.n', 'connect SUM2.e V.p',
    'connect V.p SUM1.s',
  ], [['SUM1', 's']]);
}

test('a first-order modulator: the STF and the NTF from one solve', () => {
  const report = analyzeSignalFlow(firstOrderModulator(), { output: 'V', sources: { U: 'input', E: 'input' } });
  assert.equal(report.ok, true, report.error);
  assert.equal(report.variable, 'z');
  const byInput = Object.fromEntries(report.entries.map((entry) => [entry.input, entry]));
  assert.equal(byInput.U.equation, '\\frac{V}{U} = z^{-1}');
  assert.equal(byInput.E.equation, '\\frac{V}{E} = 1 - z^{-1}');
  // The NTF's zero sits at DC, z = 1.
  assert.deepEqual(byInput.E.zeros.map((root) => Math.round(root.re * 1e6) / 1e6), [1]);
  // Setting the noise to zero leaves the STF alone.
  const stf = analyzeSignalFlow(firstOrderModulator(), { output: 'V', sources: { U: 'input', E: 'zero' } });
  assert.deepEqual(stf.entries.map((entry) => entry.equation), ['\\frac{V}{U} = z^{-1}']);
});

test('a second-order modulator shapes its noise by (1 - z^-1)^2', () => {
  const circuit = diagram([
    'add input U --at -1200 0', 'add signal_sum SUM1 --at -880 0', `add tf_z H1 --at -560 0 --value "${integrator}"`,
    'add signal_sum SUM2 --at -160 0', `add tf_z H2 --at 160 0 --value "${integrator}"`, 'add signal_sum SUM3 --at 560 0',
    'add input E --at 560 -280', 'add output V --at 880 0', 'add tf_z G --at -160 400 --value 2',
    'connect U.p SUM1.w', 'connect SUM1.e H1.in', 'connect H1.out SUM2.w', 'connect SUM2.e H2.in', 'connect H2.out SUM3.w',
    'connect E.p SUM3.n', 'connect SUM3.e V.p', 'connect V.p SUM1.s', 'connect V.p G.in', 'connect G.out SUM2.s',
  ], [['SUM1', 's'], ['SUM2', 's']]);
  const report = analyzeSignalFlow(circuit, { output: 'V', sources: { U: 'input', E: 'input' } });
  assert.equal(report.ok, true, report.error);
  const byInput = Object.fromEntries(report.entries.map((entry) => [entry.input, entry.equation]));
  assert.equal(byInput.U, '\\frac{V}{U} = z^{-2}');
  assert.equal(byInput.E, '\\frac{V}{E} = 1 - 2 z^{-1} + z^{-2}');
  // Its magnitude rises 40 dB a decade at low frequencies.
  const curve = responseCurve(report.entries.find((entry) => entry.input === 'E').value, 'z');
  const at = (f) => curve.points.reduce((best, point) => (Math.abs(Math.log(point.f / f)) < Math.abs(Math.log(best.f / f)) ? point : best));
  assert.ok(Math.abs(at(1e-3).db - at(1e-4).db - 40) < 0.5);
});

test('symbolic gains in s: a loop around k/s gives k/(s + k)', () => {
  const circuit = diagram([
    'add input U --at -720 0', 'add signal_sum SUM1 --at -400 0', 'add tf_s H1 --at 0 0 --value k',
    'add tf_s H2 --at 400 0 --value "tf([1], [1 0])"', 'add output Y --at 760 0',
    'connect U.p SUM1.w', 'connect SUM1.e H1.in', 'connect H1.out H2.in', 'connect H2.out Y.p', 'connect Y.p SUM1.s',
  ], [['SUM1', 's']]);
  const report = analyzeSignalFlow(circuit, { output: 'Y', sources: { U: 'input' } });
  assert.equal(report.ok, true, report.error);
  assert.equal(report.entries[0].equation, '\\frac{Y}{U} = \\frac{k}{s + k}');
  // Symbolic coefficients have no numeric roots or curve.
  assert.equal(report.entries[0].poles, null);
  assert.equal(responseCurve(report.entries[0].value, 's'), null);
});

test('a multiply by a constant is a gain; two signals multiplied are refused', () => {
  const lines = ['add input U --at -400 0', 'add input G --at 0 -280', 'add signal_multiply MUL1 --at 0 0', 'add output Y --at 400 0',
    'connect U.p MUL1.w', 'connect G.p MUL1.n', 'connect MUL1.e Y.p'];
  const gain = analyzeSignalFlow(diagram(lines), { output: 'Y', sources: { U: 'input', G: { constant: 'g' } } });
  assert.equal(gain.ok, true, gain.error);
  assert.equal(gain.entries[0].equation, '\\frac{Y}{U} = g');
  const nonlinear = analyzeSignalFlow(diagram(lines), { output: 'Y', sources: { U: 'input', G: 'input' } });
  assert.equal(nonlinear.ok, false);
  assert.equal(nonlinear.code, 'nonlinear');
  assert.match(nonlinear.error, /MUL1 multiplies/);
});

test('ill-formed diagrams are refused with the reason, never guessed', () => {
  const mixed = diagram(['add input U --at -400 0', 'add tf_s H1 --at 0 0', 'add tf_z H2 --at 400 0', 'add output Y --at 800 0',
    'connect U.p H1.in', 'connect H1.out H2.in', 'connect H2.out Y.p']);
  const refused = analyzeSignalFlow(mixed, { output: 'Y', sources: { U: 'input' } });
  assert.equal(refused.code, 'mixed-domains');
  assert.match(refused.error, /H\(s\) blocks \(H1, continuous\) and H\(z\) blocks \(H2, sampled\)/);
  const undriven = diagram(['add tf_s H1 --at 0 0', 'add tf_s H2 --at 400 0', 'add output Y --at 800 0', 'connect H1.out H2.in', 'connect H2.out Y.p', 'add input U --at -600 -400', 'add tf_s H3 --at -300 -400', 'connect U.p H3.in']);
  const graph = signalFlowGraph(undriven);
  assert.equal(graph.issues.length, 0, 'an unconnected input is no signal');
  const twoDrivers = diagram(['add input U --at -400 0', 'add input W --at -400 200', 'add tf_s H1 --at 0 0', 'connect U.p H1.in', 'connect W.p H1.in']);
  assert.equal(analyzeSignalFlow(twoDrivers, { output: 'H1.out', sources: { U: 'input' } }).code, 'two-drivers');
  const device = diagram(['add input U --at -400 0', 'add resistor R1 --at 0 0', 'add tf_s H1 --at 400 0', 'connect U.p R1.a', 'connect U.p H1.in']);
  assert.equal(analyzeSignalFlow(device, { output: 'H1', sources: { U: 'input' } }).code, 'not-a-signal-part');
});

test('a block reads its definition exactly: decimals, symbols, and z^-1 over a power of z', () => {
  const circuit = new Circuit();
  const h = blockTransferFunction(circuit.addComponent('tf_s', { value: 'tf([0.5], [1 2.5e-1])' }));
  assert.equal(h.variable, 's');
  const z = blockTransferFunction(circuit.addComponent('tf_z', { value: 'tf([1 -1], [1])' }));
  assert.equal(z.variable, 'z');
});

test('the analyze signal-flow command prints each transfer function, and refuses without an input', () => {
  const circuit = firstOrderModulator();
  const out = runCommand(circuit, 'analyze signal-flow --output V --input U,E');
  assert.match(out.text, /\\frac\{V\}\{U\} = z\^\{-1\}/);
  assert.match(out.text, /\\frac\{V\}\{E\} = 1 - z\^\{-1\}/);
  assert.match(out.text, /zeros: 1/);
  assert.throws(() => runCommand(circuit, 'analyze signal-flow --output V'), /usage/);
  assert.throws(() => runCommand(circuit, 'analyze signal-flow --output nowhere --input U'), /no signal/);
});

test('any wire nothing drives is a source, named as written; results keep their real powers of z', () => {
  const circuit = diagram([
    'add signal_sum SUM1 --at -400 0', 'add tf_z H1 --at 0 0 --value "tf([1], [1 -1])"', 'add signal_sum SUM2 --at 400 0', 'add output OUT --at 760 0',
    'connect SUM1.e H1.in', 'connect H1.out SUM2.w', 'connect SUM2.e OUT.p', 'connect OUT.p SUM1.s', 'stubs SUM1 SUM2',
  ]);
  const sources = signalFlowGraph(circuit).sources.map((source) => source.name);
  assert.deepEqual(sources, ['net1', 'net2', 'net3', 'net4']);
  const report = analyzeSignalFlow(circuit, { output: 'OUT', sources: { net3: 'input', net1: 'zero', net2: 'zero', net4: 'zero' } });
  assert.equal(report.ok, true, report.error);
  // Positive feedback round a non-delaying integrator: 1 - z, not (-1 + z^-1)/z^-1.
  assert.equal(report.entries[0].equation, '\\frac{OUT}{net3} = 1 - z');
});

test('responses share one graph: a coloured trace each, kept as a plot annotation', async () => {
  const { responsePlot, TRACE_COLORS } = await import('../src/core/analysis/signal-flow.js');
  const { normalizePlot } = await import('../src/core/model.js');
  const { svgString } = await import('../src/core/render.js');
  const report = analyzeSignalFlow(firstOrderModulator(), { output: 'V', sources: { U: 'input', E: 'input' } });
  const plot = responsePlot(report.entries.map((entry, i) => ({ label: entry.equation, color: TRACE_COLORS[i], value: entry.value })), 'z');
  assert.equal(plot.kind, 'response');
  assert.equal(plot.axis, 'normalized');
  assert.equal(plot.traces.length, 2);
  assert.ok(Math.abs(plot.range.high - Math.log10(0.5)) < 1e-9, 'a sampled graph ends at fs/2');
  const kept = normalizePlot(JSON.parse(JSON.stringify(plot)));
  assert.equal(kept.traces.length, 2);
  assert.deepEqual(kept.traces.map((trace) => trace.color), TRACE_COLORS.slice(0, 2));
  assert.equal(normalizePlot({ ...plot, traces: [] }), null);
  // On the drawing, each trace draws in its colour.
  const circuit = new Circuit();
  circuit.addAnnotation('box', { x: 0, y: 0, end: { x: 720, y: 440 }, plot });
  const svg = svgString(circuit);
  for (const color of TRACE_COLORS.slice(0, 2)) assert.match(svg, new RegExp(`stroke="${color}"`));
});

test('a gain block scales its signal; compound symbolic coefficients keep their signs', async () => {
  const { resultSymbols, withCoefficients, numericRootsOf, transferTex } = await import('../src/core/analysis/signal-flow.js');
  const circuit = diagram([
    'add input U --at -720 0', 'add signal_sum SUM1 --at -400 0', 'add gain K1 --at -80 0 --value a_1',
    `add tf_z H1 --at 280 0 --value "${integrator}"`, 'add output Y --at 700 0',
    'connect U.p SUM1.w', 'connect SUM1.e K1.in', 'connect K1.out H1.in', 'connect H1.out Y.p', 'connect Y.p SUM1.s',
  ], [['SUM1', 's']]);
  const report = analyzeSignalFlow(circuit, { output: 'Y', sources: { U: 'input' } });
  assert.equal(report.ok, true, report.error);
  // a_1 I / (1 + a_1 I) with I = z^-1 / (1 - z^-1).
  assert.equal(report.entries[0].equation, '\\frac{Y}{U} = \\frac{a_{1} z^{-1}}{1 + \\left(-1 + a_{1}\\right) z^{-1}}');
  const value = report.entries[0].value;
  assert.deepEqual(resultSymbols(value, 'z'), ['a_1']);
  // Given a value, it is numeric again: a pole at 1 - a_1.
  const half = withCoefficients(value, { a_1: 0.5 });
  assert.equal(transferTex(half, 'z'), '\\frac{\\frac{1}{2} z^{-1}}{1 - \\frac{1}{2} z^{-1}}');
  assert.deepEqual(numericRootsOf(half).poles.map((root) => root.re), [0.5]);
  // A gain draws its coefficient inside its triangle, and must be one coefficient.
  const label = [...circuit.labels.values()].find((l) => l.owner === 'K1');
  assert.deepEqual([label.text, label.offset], ['$a_{1}$', { x: 0, y: 0 }]);
  assert.throws(() => runCommand(circuit, 'value K1 [1 2]'), /one coefficient|gain/);
});

test('wires into a signal-flow input draw an arrowhead there; a gain\'s input does not', async () => {
  const { svgString } = await import('../src/core/render.js');
  const heads = (circuit) => (svgString(circuit).match(/<polygon points="[^"]*" fill="[^"]*" stroke="none"\/>/g) || []).length;
  const block = diagram(['add input U --at -400 0', 'add tf_s H1 --at 0 0', 'connect U.p H1.in']);
  assert.equal(heads(block), 1);
  const gain = diagram(['add input U --at -400 0', 'add gain K1 --at 0 0', 'connect U.p K1.in']);
  assert.equal(heads(gain), 0);
  const sum = diagram(['add input U --at -400 0', 'add input V --at 0 -300', 'add signal_sum S1 --at 0 0', 'connect U.p S1.w', 'connect V.p S1.n']);
  assert.equal(heads(sum), 2);
  const quantizer = diagram(['add input U --at -400 0', 'add quantizer QZ1 --at 0 0', 'connect U.p QZ1.in']);
  assert.equal(heads(quantizer), 1);
});

test('a fourth-order modulator with a dozen symbols solves, and agrees with its numbers', async () => {
  const { withCoefficients, transferTex } = await import('../src/core/analysis/signal-flow.js');
  const values = { b_1: 0.5, b_5: 1, c_1: 0.5, c_2: 0.75, c_3: 0.5, c_4: 0.25, g_1: 0.0625, g_2: 0.125, a_1: 2, a_2: 1.5, a_3: 1, a_4: 0.5 };
  const build = (value) => {
    const I = '"tf([0 1], [1 -1])"';
    const lines = [
      'add input IN --at -1600 0', `add gain B1 --at -1360 0 --value ${value('b_1')}`, 'add signal_sum S1 --at -1120 0',
      `add tf_z I1 --at -880 0 --value ${I}`, `add gain C2 --at -560 0 --value ${value('c_2')}`, `add tf_z I2 --at -240 0 --value ${I}`,
      `add gain C3 --at 80 0 --value ${value('c_3')}`, 'add signal_sum S3 --at 360 0', `add tf_z I3 --at 640 0 --value ${I}`,
      `add gain C4 --at 960 0 --value ${value('c_4')}`, `add tf_z I4 --at 1240 0 --value ${I}`, `add gain A4 --at 1560 0 --value ${value('a_4')}`,
      'add signal_sum S4 --at 1840 0', 'add signal_sum SQ --at 2120 0', 'add input q --at 2120 -280', 'add output OUT --at 2440 0',
      'add signal_sum S5 --at 1840 -400', 'add signal_sum S6 --at 1840 -800', 'add signal_sum S7 --at 1840 -1200',
      `add gain A3 --at 1560 -400 --value ${value('a_3')}`, `add gain A2 --at 1560 -800 --value ${value('a_2')}`,
      `add gain A1 --at 1560 -1200 --value ${value('a_1')}`, `add gain B5 --at 1560 -1600 --value ${value('b_5')}`,
      `add gain G1 --at -560 -400 --value ${value('g_1')} --rot 180`, `add gain G2 --at 960 -400 --value ${value('g_2')} --rot 180`,
      `add gain C1 --at -1120 400 --value ${value('c_1')} --rot 270`,
      ...['IN.p B1.in', 'B1.out S1.w', 'S1.e I1.in', 'I1.out C2.in', 'C2.out I2.in', 'I2.out C3.in', 'C3.out S3.w', 'S3.e I3.in',
        'I3.out C4.in', 'C4.out I4.in', 'I4.out A4.in', 'A4.out S4.w', 'S4.e SQ.w', 'q.p SQ.n', 'SQ.e OUT.p',
        'S5.e S4.n', 'S6.e S5.n', 'S7.e S6.n', 'A3.out S5.w', 'A2.out S6.w', 'A1.out S7.w', 'B5.out S7.n',
        'I3.out A3.in', 'I2.out A2.in', 'I1.out A1.in', 'IN.p B5.in',
        'I2.out G1.in', 'G1.out S1.n', 'I4.out G2.in', 'G2.out S3.n', 'OUT.p C1.in', 'C1.out S1.s'].map((pair) => `connect ${pair}`),
    ];
    return diagram(lines, [['S1', 'n'], ['S1', 's'], ['S3', 'n']]);
  };
  const started = Date.now();
  const symbolic = analyzeSignalFlow(build((name) => name), { output: 'OUT', sources: { IN: 'input', q: 'input' } });
  assert.equal(symbolic.ok, true, symbolic.error);
  assert.ok(Date.now() - started < 5000, 'solved promptly');
  const numeric = analyzeSignalFlow(build((name) => values[name]), { output: 'OUT', sources: { IN: 'input', q: 'input' } });
  assert.equal(numeric.ok, true, numeric.error);
  for (const [index, entry] of symbolic.entries.entries()) {
    assert.equal(transferTex(withCoefficients(entry.value, values), 'z'), numeric.entries[index].tex);
  }
});

test('coefficient values and Bode ratios are kept with the document', () => {
  const circuit = new Circuit();
  assert.equal(circuit.toJSON().analysisValues, undefined, 'nothing saved until set');
  circuit.analysisValues.coefficients.a_1 = 0.5;
  circuit.analysisValues.bode = { intrinsicGain: 51, parasiticRatio: null, multipliers: { C_L: 2.2 } };
  const loaded = Circuit.fromJSON(JSON.parse(JSON.stringify(circuit.toJSON())));
  assert.deepEqual(loaded.analysisValues.coefficients, { a_1: 0.5 });
  assert.deepEqual(loaded.analysisValues.bode, { intrinsicGain: 51, parasiticRatio: null, multipliers: { C_L: 2.2 } });
  // Junk is dropped on load.
  const junk = Circuit.fromJSON({ ...circuit.toJSON(), analysisValues: { coefficients: { a_1: 'x', 'b c': 2, k: 3 }, bode: { intrinsicGain: -1 } } });
  assert.deepEqual(junk.analysisValues.coefficients, { k: 3 });
  assert.equal(junk.analysisValues.bode.intrinsicGain, null);
});

test('the response graph fits its dB axis to the curves, in whole 20 dB steps', async () => {
  const { responseFigure } = await import('../src/core/bode-figure.js');
  const plot = { kind: 'response', axis: 'normalized', range: { low: -4, high: Math.log10(0.5) }, traces: [
    { label: 'a', color: '#3b74e0', points: [{ f: 1e-4, db: -317 }, { f: 0.5, db: 13 }] },
  ] };
  const figure = responseFigure(plot);
  assert.deepEqual(figure.ranges.db, [-320, 20]);
});

test('a short gain coefficient sits in its triangle; a longer one beside it, by one rule at any rotation', async () => {
  const { gainFitsInside } = await import('../src/core/transfer-function.js');
  for (const inside of ['k', 'b_1', '-g_1', '-c_1', 'K_p', 'a_12', 'g_{m}', '0.5', '2', '10', '-2']) assert.equal(gainFitsInside(inside), true, inside);
  for (const outside of ['2*g_m', '-2*g_m', 'g_m/C', '1.25e-3', 'abc', '100', '0.25', '-0.5']) assert.equal(gainFitsInside(outside), false, outside);
  const circuit = new Circuit();
  const place = (value, rotation) => {
    const gain = circuit.addComponent('gain', { value, rotation });
    return [...circuit.labels.values()].find((label) => label.owner === gain.refdes).anchorWorld();
  };
  // Inside: on the triangle's centroid, the part's origin.
  assert.deepEqual(place('b_1', 90), { x: 0, y: 0 });
  assert.deepEqual(place('-g_1', 180), { x: 0, y: 0 });
  // Beside: above a horizontal triangle, right of a vertical one.
  assert.deepEqual(place('2*g_m', 0), { x: 0, y: -120 });
  assert.deepEqual(place('2*g_m', 180), { x: 0, y: -120 });
  assert.deepEqual(place('g_m/C', 90), { x: 120, y: 0 });
  assert.deepEqual(place('g_m/C', 270), { x: 120, y: 0 });
  // Rotating a gain keeps that rule.
  const gain = [...circuit.components.values()].at(-1);
  circuit.setTransform(gain.refdes, { rotation: 0 });
  assert.deepEqual([...circuit.labels.values()].find((label) => label.owner === gain.refdes).anchorWorld(), { x: 0, y: -120 });
});

test('resizing a graph keeps its legend together beside it', () => {
  const circuit = new Circuit();
  const box = circuit.addAnnotation('box', { x: 0, y: 0, end: { x: 720, y: 440 } });
  const legend = [40, 160, 280, 400, 520].map((y) => circuit.addLabel({ text: `L${y}`, parent: box.id, x: 880, y }));
  const caption = circuit.addLabel({ text: 'caption', parent: box.id, x: 360, y: -40 });
  box.resizeBox({ x: 0, y: 0, w: 1000, h: 800 });
  // One shift for the whole legend: it follows the right edge, its spacing kept.
  assert.deepEqual(legend.map((label) => label.anchor), [40, 160, 280, 400, 520].map((y) => ({ x: 1160, y })));
  // A caption above the box still follows its centre.
  assert.deepEqual(caption.anchor, { x: 520, y: -40 });
});

test('an s result can plot over f/fs, s in units of 1/Ts, beside z results', async () => {
  const { responseCurve, responsePlot } = await import('../src/core/analysis/signal-flow.js');
  const { rationalFunction, symbol, add, integer } = await import('../src/core/analysis/rational.js');
  // 1/(s + 1): on ω its corner is at 1; on f/fs at 1/(2 pi), -3 dB there.
  const lowpass = rationalFunction(integer(1), add(symbol('s'), integer(1)), { variable: 's' });
  const curve = responseCurve(lowpass, 's', { sAxis: 'normalized' });
  assert.equal(curve.axis, 'normalized');
  assert.ok(Math.abs(curve.points.at(-1).f - 0.5) < 1e-12);
  const near = curve.points.reduce((best, p) => (Math.abs(p.f - 1 / (2 * Math.PI)) < Math.abs(best.f - 1 / (2 * Math.PI)) ? p : best));
  assert.ok(Math.abs(near.db + 3.01) < 0.3);
  assert.equal(responseCurve(lowpass, 's').axis, 'relative');
  // Mixed with a z trace, both go on f/fs.
  const accumulator = rationalFunction(symbol('z'), add(symbol('z'), integer(-1)), { variable: 'z' });
  const plot = responsePlot([{ label: 'a', color: '#3b74e0', value: lowpass, variable: 's' }, { label: 'b', color: '#e0533b', value: accumulator, variable: 'z' }], 's');
  assert.equal(plot.axis, 'normalized');
  assert.equal(plot.traces.length, 2);
  // Kept with the document.
  const circuit = new Circuit();
  circuit.analysisValues.sAxis = 'normalized';
  assert.equal(Circuit.fromJSON(JSON.parse(JSON.stringify(circuit.toJSON()))).analysisValues.sAxis, 'normalized');
});

test('an s block with a delay: a hold DAC notches at f = 1/T, its T a coefficient', () => {
  const circuit = diagram([
    'add input U --at -800 0', 'add tf_s H1 --at 0 0', 'add output Y --at 800 0',
    'connect U.p H1.in', 'connect H1.out Y.p', 'value H1 (1 - exp(-s*T))/s',
  ]);
  const report = analyzeSignalFlow(circuit, { output: 'Y', sources: { U: 'input' } });
  assert.equal(report.ok, true, report.error);
  const [entry] = report.entries;
  assert.equal(entry.equation, '\\frac{Y}{U} = \\frac{1 - e^{-s\\,T}}{s}');
  // Infinitely many zeros: none listed, not a pole at s = 0 that is not there.
  assert.equal(entry.delayed, true);
  assert.equal(entry.poles, null);
  assert.deepEqual(resultSymbols(entry.value, 's'), ['T']);
  const held = withCoefficients(entry.value, { T: 1 });
  assert.equal(numericRootsOf(held).delayed, true);
  // |H(j w)| = T |sinc(w T / 2)|: 0 dB low down, a notch at w = 2 pi / T.
  const curve = responseCurve(held, 's');
  const at = (w) => curve.points.reduce((best, p) => (Math.abs(Math.log(p.f / w)) < Math.abs(Math.log(best.f / w)) ? p : best));
  assert.ok(Math.abs(curve.points[0].db) < 0.01);
  assert.ok(at(2 * Math.PI).db < -40 && at(Math.PI).db > -5);
  // On f/fs, T counts samples: 2/pi at half the sample rate, -90 degrees.
  const sampled = responseCurve(held, 's', { sAxis: 'normalized' }).points.at(-1);
  assert.ok(Math.abs(sampled.db - 20 * Math.log10(2 / Math.PI)) < 1e-6);
  assert.ok(Math.abs(sampled.phase + 90) < 1e-6);
  // A delay slid to zero is e^0 = 1, and still plots.
  const excess = withCoefficients(blockTransferFunction(circuit.addComponent('tf_s', { value: 'exp(-s*T_d)/(s + 1)' })), { T_d: 0 });
  assert.equal(responseCurve(excess, 's', { sAxis: 'normalized' }).points.length > 1, true);
  assert.ok(Math.abs(responseCurve(excess, 's').points[0].db) < 0.1);
});

test('a loop with an excess delay stays exact, the delay one symbol of the solve', () => {
  const circuit = diagram([
    'add input U --at -1200 0', 'add signal_sum S1 --at -600 0', 'add tf_s H1 --at 0 0', 'add output Y --at 800 0',
    'add tf_s H2 --at 0 400 --rot 180',
    'connect U.p S1.w', 'connect S1.e H1.in', 'connect H1.out Y.p', 'connect H1.out H2.in', 'connect H2.out S1.s',
    'value H1 k/s', "value H2 tf([1], [1], 'InputDelay', T_d)",
  ], [['S1', 's']]);
  const report = analyzeSignalFlow(circuit, { output: 'Y', sources: { U: 'input' } });
  assert.equal(report.ok, true, report.error);
  assert.equal(report.entries[0].equation, '\\frac{Y}{U} = \\frac{k}{s + k\\,e^{-s\\,T_{d}}}');
  assert.deepEqual(resultSymbols(report.entries[0].value, 's'), ['k', 'T_d']);
  // Gain peaking near the loop's crossover once k T_d is large.
  const curve = responseCurve(withCoefficients(report.entries[0].value, { k: 1, T_d: 1 }), 's');
  assert.ok(Math.max(...curve.points.map((p) => p.db)) > 3);
});

// ----- sampled loops ---------------------------------------------------------------------

import { samplePath } from '../src/core/analysis/sampling.js';
import { sampledEquation } from '../src/core/analysis/signal-flow.js';

test('sampling a DAC pulse through H(s): exact, the samples read just before each edge', () => {
  const close = (actual, expected) => {
    assert.equal(actual.length, expected.length, `${actual} vs ${expected}`);
    actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 1e-9, `${actual} vs ${expected}`));
  };
  // NRZ into an integrator: a ramp to 1 over a period, read at its end.
  const nrz = samplePath({ den: [0, 0, 1], terms: [{ delay: 0, num: [1] }, { delay: 1, num: [-1] }] }, 1);
  close(nrz.num, [0, 1]);
  close(nrz.den, [1, -1]);
  // Half a period of excess delay: samples 0.5, 1, 1, ...
  const late = samplePath({ den: [0, 0, 1], terms: [{ delay: 0.5, num: [1] }, { delay: 1.5, num: [-1] }] }, 1);
  close(late.num, [0, 0.5, 0.5]);
  close(late.den, [1, -1]);
  // A real pole: (1 - e^-1) z^-1 / (1 - e^-1 z^-1).
  const pole = samplePath({ den: [0, 1, 1], terms: [{ delay: 0, num: [1] }, { delay: 1, num: [-1] }] }, 1);
  close(pole.num, [0, 1 - Math.exp(-1)]);
  close(pole.den, [1, -Math.exp(-1)]);
  // Against the aliasing sum F_d(e^{j theta}) = sum_k F(j(theta + 2 pi k)), for a
  // delayed pulse through a resonance (a continuous pulse response, so no edge to read).
  const den = [0.1, 0.52, 0.3, 1];
  const sampled = samplePath({ den: [0, ...den], terms: [{ delay: 0.3, num: [1] }, { delay: 1.3, num: [-1] }] }, 1);
  const poly = (c, [re, im]) => c.reduceRight(([a, b], v) => [a * re - b * im + v, a * im + b * re], [0, 0]);
  const div = ([a, b], [c, d]) => { const m = c * c + d * d; return [(a * c + b * d) / m, (b * c - a * d) / m]; };
  const mul = ([a, b], [c, d]) => [a * c - b * d, a * d + b * c];
  for (const theta of [0.3, 1.5, 3]) {
    const w = [Math.cos(-theta), Math.sin(-theta)];
    const exact = div(poly(sampled.num, w), poly(sampled.den, w));
    let sum = [0, 0];
    for (let k = -20000; k <= 20000; k++) {
      const omega = theta + 2 * Math.PI * k;
      const term = mul(mul(div([1 - Math.cos(omega), Math.sin(omega)], [0, omega]), [Math.cos(0.3 * omega), -Math.sin(0.3 * omega)]), div([1, 0], poly(den, [0, omega])));
      sum = [sum[0] + term[0], sum[1] + term[1]];
    }
    assert.ok(Math.hypot(exact[0] - sum[0], exact[1] - sum[1]) < 1e-5, `theta ${theta}`);
  }
  // Impulses cannot be sampled: a path from the DAC input with no pulse.
  assert.throws(() => samplePath({ den: [1, 1], terms: [{ delay: 0, num: [1, 1] }] }, 1), /impulses/);
});

function ctModulator(order) {
  // A continuous-time CIFB modulator: integrators 1/s, an NRZ DAC feeding
  // every integrator through -k_i, a sampler, and the quantization error q.
  const lines = ['add input U --at -2000 0', 'add signal_sum S1 --at -1600 0', 'add tf_s H1 --at -1200 0 --value "1/s"'];
  const negatives = [['S1', 's']];
  let last = 'H1.out';
  if (order === 2) {
    lines.push('add signal_sum S3 --at -800 0', 'add tf_s H2 --at -400 0 --value "1/s"', 'add gain K2 --at -400 400 --rot 180 --value k_2', 'connect H1.out S3.w', 'connect S3.e H2.in', 'connect D1.out K2.in', 'connect K2.out S3.s');
    negatives.push(['S3', 's']);
    last = 'H2.out';
  }
  lines.splice(3, 0, 'add tf_s D1 --at 400 800 --rot 180 --value "exp(-s*T_d)*(1 - exp(-s*T))/s"', 'add gain K1 --at -1200 400 --rot 180 --value k_1');
  lines.push('add sampler SMP1 --at 400 0', 'add signal_sum S2 --at 800 0', 'add input q --at 800 -280', 'add output V --at 1200 0',
    'connect U.p S1.w', 'connect S1.e H1.in', `connect ${last} SMP1.in`, 'connect SMP1.out S2.w', 'connect q.p S2.n', 'connect S2.e V.p', 'connect V.p D1.in',
    'connect D1.out K1.in', 'connect K1.out S1.s');
  return diagram(lines, negatives);
}

test('a continuous-time modulator: the sampler makes its NTF the textbook (1 - z^-1)^n', () => {
  const first = analyzeSignalFlow(ctModulator(1), { output: 'V', sources: { U: 'input', q: 'input' }, values: { T: 1, T_d: 0, k_1: 1 } });
  assert.equal(first.ok, true, first.error);
  assert.equal(first.variable, 'z');
  const byInput = Object.fromEntries(first.entries.map((entry) => [entry.input, entry]));
  assert.equal(byInput.q.equation, '\\frac{V}{q} = 1 - z^{-1}');
  // A continuous input: the loop's part times its path to the sampler, at s = j omega.
  assert.equal(byInput.U.equation, '\\frac{V}{U} = \\left(1 - z^{-1}\\right) \\cdot \\frac{1}{s}');
  assert.equal(byInput.U.continuous, true);
  // Its step response: the ramp the integrator makes of a step, read before
  // each t = nT and differenced by the loop -- 0, then 1 from the first sample on.
  const step = stepResponse(withCoefficients(byInput.U.value, { T: 1, T_d: 0, k_1: 1 }));
  assert.equal(step.unit, 'n');
  assert.equal(step.stairs, true);
  assert.ok(Math.abs(step.points[0].y) < 1e-9);
  assert.ok(step.points.slice(1, 20).every((p) => Math.abs(p.y - 1) < 1e-9), JSON.stringify(step.points.slice(0, 5)));
  const second = analyzeSignalFlow(ctModulator(2), { output: 'V', sources: { U: 'input', q: 'input' }, values: { T: 1, T_d: 0, k_1: 1, k_2: 1.5 } });
  assert.equal(second.ok, true, second.error);
  const ntf = second.entries.find((entry) => entry.input === 'q');
  assert.equal(ntf.equation, '\\frac{V}{q} = 1 - 2 z^{-1} + z^{-2}');
  assert.deepEqual(resultSymbols(ntf.value, 'z'), ['k_1', 'k_2', 'T', 'T_d']);
  // The coefficients are live: the same result at other numbers, and its poles move off z = 0.
  const slower = sampledEquation(ntf, { T: 1, T_d: 0, k_1: 0.5, k_2: 1 });
  assert.notEqual(slower.equation, ntf.equation);
  assert.ok(slower.poles.some((p) => Math.hypot(p.re, p.im) > 0.1));
  // Excess loop delay adds a pole; uncompensated, half a period of it takes
  // the loop unstable (the classic result), a tenth leaves it stable.
  const radii = (td) => sampledEquation(ntf, { T: 1, T_d: td, k_1: 1, k_2: 1.5 }).poles.map((p) => Math.hypot(p.re, p.im));
  assert.equal(radii(0.1).length, 3);
  assert.ok(Math.max(...radii(0.1)) < 1);
  assert.ok(Math.max(...radii(0.5)) > 1);
  // The STF plots over f/fs, a tone in at f giving the same tone out.
  const stf = responseCurve(withCoefficients(second.entries.find((entry) => entry.input === 'U').value, { T: 1, T_d: 0, k_1: 1, k_2: 1.5 }), 'z');
  assert.equal(stf.axis, 'normalized');
  assert.ok(Math.abs(stf.points[0].db) < 0.01);
});

test('a sampled loop refuses what it cannot sample: a continuous output, mixed domains at a sum', () => {
  const circuit = ctModulator(1);
  const samplerInput = [...circuit.nets.values()].find((net) => net.terminals.some((t) => t.comp === 'SMP1' && t.term === 'in'));
  const continuous = analyzeSignalFlow(circuit, { output: samplerInput.id, sources: { U: 'input' } });
  assert.equal(continuous.ok, false);
  assert.equal(continuous.code, 'continuous-output');
  // It says the output is the trouble, names it by its driving pin, and offers a sampled one.
  assert.match(continuous.error, new RegExp(`^The output picked, ${samplerInput.id} \\(H1\\.out\\), is continuous\\..*: V, say\\.$`));
  // The likeliest output first: with a sampler, a sampled port's signal; continuous ones last.
  const choices = outputChoices(circuit);
  assert.equal(choices[0].label, 'V');
  assert.equal(choices[0].sampled, true);
  assert.ok(choices.findIndex((c) => !c.sampled) > choices.findLastIndex((c) => c.sampled));
  // A plain port counts as an output too, ahead of unnamed wires.
  const plain = diagram(['add input U --at -800 0', 'add gain K1 --at -400 0', 'add gain K2 --at 0 0', 'add port P1 --at 400 0', 'connect U.p K1.in', 'connect K1.out K2.in', 'connect K2.out P1.p']);
  assert.equal(outputChoices(plain)[0].label, 'P_{1}');
  assert.match(outputChoices(plain)[1].label, /^N\d+ \(K1\.out\)$/);
  // A sum adding the sampled signal to a continuous one, with no DAC between.
  const mixed = diagram([
    'add input U --at -800 0', 'add tf_s H1 --at -400 0 --value "1/s"', 'add sampler SMP1 --at 0 0', 'add signal_sum S1 --at 400 0', 'add output V --at 800 0',
    'add tf_s H2 --at 0 -400 --value "1/s"',
    'connect U.p H1.in', 'connect H1.out SMP1.in', 'connect SMP1.out S1.w', 'connect S1.e V.p', 'connect U.p H2.in', 'connect H2.out S1.n',
  ]);
  const report = analyzeSignalFlow(mixed, { output: 'V', sources: { U: 'input' } });
  assert.equal(report.ok, false);
  assert.equal(report.code, 'mixed-domains');
  // It says which signal is which, and what made it so.
  assert.match(report.error, /S1 joins a continuous and a sampled signal: H2\.out is continuous \(H2, an H\(s\) block, drives it\), but SMP1\.out is sampled \(SMP1, a sampler, drives it\)/);
});

test('the sampler: a switch with its period beside it, swapped in with a period that reads', () => {
  const circuit = new Circuit();
  const sampler = circuit.addComponent('sampler', { refdes: 'SMP1' });
  assert.equal(sampler.value, 'T');
  assert.deepEqual(sampler.def.terminals.map((t) => [t.name, t.x, t.y, t.signalRole]), [['in', -80, 0, 'input'], ['out', 80, 0, 'output']]);
  assert.deepEqual(sampler.def.bbox, { x: -80, y: -80, w: 160, h: 160 });
  // Its period is an owned math label above it, beside it once turned.
  const label = () => [...circuit.labels.values()].find((l) => l.owner === 'SMP1' && l.role === TRANSFER_FUNCTION_ROLE);
  assert.equal(label().text, '$T$');
  assert.deepEqual(label().offset, { x: 0, y: -120 });
  runCommand(circuit, 'rotate SMP1 90');
  const world = applyTransform(sampler.transform, label().offset.x, label().offset.y);
  assert.ok(world.x > sampler.transform.x && world.y === sampler.transform.y);
  runCommand(circuit, 'value SMP1 T_s');
  assert.equal(label().text, '$T_{s}$');
  assert.throws(() => runCommand(circuit, 'value SMP1 [1 2]'));
  // A block swapped for a sampler takes the default period, its definition not reading as one.
  const block = circuit.addComponent('tf_s', { refdes: 'H1', value: 'exp(-s*T)' });
  swapComponentType(circuit, 'H1', 'sampler');
  assert.equal(block.value, 'T');
});

import { linkMakesCycle, parseCoefficientLink, resolveCoefficients } from '../src/core/analysis/coefficient-links.js';

test('linked coefficients follow others, through chains, and are saved with the document', () => {
  const values = { b_1: 0.05, c_1: 9, T: 2 };
  const numbers = resolveCoefficients(values, { c_1: 'b_1', c_2: '2*c_1', T_d: 'T/2' });
  assert.equal(numbers.c_1, 0.05);
  assert.equal(numbers.c_2, 0.1);
  assert.equal(numbers.T_d, 1);
  assert.equal(numbers.b_1, 0.05);
  // A circle, or a link that does not read, falls back to the coefficient's own number.
  assert.equal(resolveCoefficients(values, { c_1: 'b_1', b_1: 'c_1' }).b_1, values.b_1);
  assert.equal(linkMakesCycle('b_1', 'c_1', { c_1: '2*b_1' }), true);
  assert.equal(linkMakesCycle('c_2', 'c_1', { c_1: 'b_1' }), false);
  assert.equal(linkMakesCycle('c_1', 'c_1 + 1', {}), true);
  assert.deepEqual([...parseCoefficientLink('= a_1*b_{2} - 1').reads].sort(), ['a_1', 'b_2']);
  assert.throws(() => parseCoefficientLink('= exp(-s*T)'), /without s/);
  assert.throws(() => parseCoefficientLink('='), /needs an expression/);
  // Saved and loaded with the coefficients.
  const circuit = new Circuit();
  circuit.analysisValues.coefficients.b_1 = 0.05;
  circuit.analysisValues.links.c_1 = 'b_1';
  const loaded = Circuit.fromJSON(JSON.parse(JSON.stringify(circuit.toJSON())));
  assert.deepEqual(loaded.analysisValues.links, { c_1: 'b_1' });
  assert.deepEqual(new Circuit().toJSON().analysisValues, undefined);
});

test('a sampled result follows a linked coefficient', () => {
  const report = analyzeSignalFlow(ctModulator(2), { output: 'V', sources: { q: 'input' }, values: { T: 1, T_d: 0, k_1: 1, k_2: 1.5 } });
  const [ntf] = report.entries;
  const linked = resolveCoefficients({ T: 1, T_d: 0, k_1: 1, k_2: 1 }, { k_2: '1.5*k_1' });
  assert.equal(sampledEquation(ntf, linked).equation, '\\frac{V}{q} = 1 - 2 z^{-1} + z^{-2}');
});

// ----- quantizer and swing ---------------------------------------------------------------

import { prepareSimulation, quantize, sweepAmplitudes } from '../src/core/analysis/simulate.js';
import { parseCoefficientVectors } from '../src/core/analysis/coefficient-links.js';

function quantizedModulator(kind) {
  // A second-order modulator with a single-bit quantizer: continuous (a
  // sampler and an NRZ DAC, gains 1 and 1.5) or discrete (z^-1/(1 - z^-1), 1 and 2).
  const ct = kind === 'ct';
  const integrator = ct ? '"1/s"' : '"tf([0 1], [1 -1])"';
  const block = ct ? 'tf_s' : 'tf_z';
  const lines = ['add input U --at -1600 0', 'add signal_sum S1 --at -1200 0', `add ${block} H1 --at -800 0 --value ${integrator}`, 'add signal_sum S3 --at -400 0', `add ${block} H2 --at 0 0 --value ${integrator}`,
    'add quantizer QZ1 --at 800 0', 'add output V --at 1200 0', 'add gain K1 --at -800 400 --rot 180 --value k_1', 'add gain K2 --at 0 400 --rot 180 --value k_2',
    'connect U.p S1.w', 'connect S1.e H1.in', 'connect H1.out S3.w', 'connect S3.e H2.in', 'connect QZ1.out V.p', 'connect K1.out S1.s', 'connect K2.out S3.s'];
  if (ct) lines.push('add sampler SMP1 --at 400 0', 'add tf_s D1 --at 400 640 --rot 180 --value "exp(-s*T_d)*(1 - exp(-s*T))/s"', 'connect H2.out SMP1.in', 'connect SMP1.out QZ1.in', 'connect V.p D1.in', 'connect D1.out K1.in', 'connect D1.out K2.in');
  else lines.push('connect H2.out QZ1.in', 'connect V.p K1.in', 'connect V.p K2.in');
  return diagram(lines, [['S1', 's'], ['S3', 's']]);
}

test('a delay before the DAC simulates as the DAC with its pulse delayed', () => {
  // The same loop twice: one DAC block holding e^{-sT_d}(1 - e^{-sT})/s,
  // and a delay block e^{-sT_d} followed by an NRZ DAC block.
  const one = quantizedModulator('ct');
  const split = quantizedModulator('ct');
  split.removeComponent('D1');
  for (const line of ['add tf_delay DL1 --at 1200 640 --rot 180', 'add tf_dac D1 --at 400 640 --rot 180',
    'connect V.p DL1.in', 'connect DL1.out D1.in', 'connect D1.out K1.in', 'connect D1.out K2.in']) runCommand(split, line);
  const values = { k_1: 1, k_2: 1.5, T: 1, T_d: 0.3 };
  const run = (circuit) => {
    const sim = prepareSimulation(circuit, { values, input: 'U', output: 'name:V', frequency: 1 / 256, samples: 2048 });
    assert.equal(sim.ok, true, sim.error);
    const named = (name) => sim.signals.findIndex((s) => s.name === name);
    return [-20, -6].map((a) => {
      const r = sim.run(a);
      return [r.tone, r.peaks[named('H_{1}')], r.peaks[named('H_{2}')]];
    });
  };
  const [a, b] = [run(one), run(split)];
  a.flat().forEach((v, i) => assert.ok(Math.abs(v - b.flat()[i]) < 1e-9 * Math.max(1, Math.abs(v)), `${v} vs ${b.flat()[i]}`));
});

test('the quantizer rounds to Schreier\'s levels, full scale N - 1', () => {
  assert.deepEqual([-3, -0.2, 0, 0.4, 7].map((y) => quantize(y, 2)), [-1, -1, 1, 1, 1]);
  assert.deepEqual([-9, -1.2, -0.9, 0.9, 1.1, 9].map((y) => quantize(y, 3)), [-2, -2, 0, 0, 2, 2]);
  assert.deepEqual([-9, -2.1, -0.5, 0.5, 2.1, 9].map((y) => quantize(y, 4)), [-3, -3, -1, 1, 3, 3]);
  const circuit = new Circuit();
  circuit.addComponent('quantizer', { refdes: 'QZ1' });
  assert.equal(circuit.components.get('QZ1').value, '2');
  assert.equal([...circuit.labels.values()].find((l) => l.owner === 'QZ1' && l.role === TRANSFER_FUNCTION_ROLE).text, '$N = 2$');
  runCommand(circuit, 'value QZ1 N=5');
  assert.equal(circuit.components.get('QZ1').value, '5');
  assert.throws(() => runCommand(circuit, 'value QZ1 1'), /at least 2/);
});

test('in the transfer functions a quantizer is a gain of 1 plus its own error source', () => {
  const report = analyzeSignalFlow(quantizedModulator('ct'), { output: 'V', sources: { U: 'input', QZ1: 'input' }, values: { T: 1, T_d: 0, k_1: 1, k_2: 1.5 } });
  assert.equal(report.ok, true, report.error);
  const ntf = report.entries.find((entry) => entry.input === 'QZ1');
  assert.equal(ntf.inputName, 'E_{QZ1}');
  assert.equal(ntf.equation, '\\frac{V}{E_{QZ1}} = 1 - 2 z^{-1} + z^{-2}');
  const dt = analyzeSignalFlow(quantizedModulator('dt'), { output: 'V', sources: { QZ1: 'input' } });
  assert.equal(dt.entries[0].equation, '\\frac{V}{E_{QZ1}} = \\frac{1 - 2 z^{-1} + z^{-2}}{1 + \\left(-2 + k_{2}\\right) z^{-1} + \\left(-k_{2} + 1 + k_{1}\\right) z^{-2}}');
});

test('the swing simulation: the output tracks the input until the loop overloads past full scale', () => {
  for (const [kind, values] of [['ct', { T: 1, T_d: 0, k_1: 1, k_2: 1.5 }], ['dt', { k_1: 1, k_2: 2 }]]) {
    const sim = prepareSimulation(quantizedModulator(kind), { values, input: 'U', output: 'name:V', frequency: 1 / 256, samples: 2048 });
    assert.equal(sim.ok, true, sim.error);
    assert.equal(sim.fullScale, 1);
    // The integrators' outputs, named after their blocks.
    const states = sim.signals.filter((s) => /^H_?\{?[12]\}?$/.test(s.name)).map((s) => sim.signals.indexOf(s));
    assert.equal(states.length, 2, kind);
    const quiet = sim.run(-20);
    const loud = sim.run(-3);
    assert.equal(quiet.overloaded, false);
    // A tone at -20 dBFS comes out at -20 dBFS (the STF is 1 in band).
    assert.ok(Math.abs(20 * Math.log10(quiet.tone) + 20) < 0.1, `${kind} ${quiet.tone}`);
    // The integrators swing further as the input grows, and blow up past full scale.
    for (const i of states) assert.ok(loud.peaks[i] > quiet.peaks[i], kind);
    const over = sim.run(3);
    assert.ok(over.overloaded || Math.max(...states.map((i) => over.peaks[i])) > 100, kind);
  }
  assert.equal(sweepAmplitudes().at(-1), 3);
  assert.ok(sweepAmplitudes().includes(-5.75), 'quarter-dB steps near full scale');
  // A DAC's pulse edges share one state, so a long run stays bounded: no
  // overload read into a stable loop (each edge integrating apart ramps).
  const long = prepareSimulation(quantizedModulator('ct'), { values: { T: 1, T_d: 0.3, k_1: 1, k_2: 1.5 }, input: 'U', output: 'name:V', samples: 16384 });
  assert.equal(long.run(-40).overloaded, false);
  // No clock, no simulation; a quantizer on the continuous side is refused.
  const unclocked = diagram(['add input U --at -400 0', 'add tf_s H1 --at 0 0 --value "1/s"', 'add output V --at 400 0', 'connect U.p H1.in', 'connect H1.out V.p']);
  assert.equal(prepareSimulation(unclocked, { input: 'U' }).code, 'no-clock');
});

test('a swing plot keeps its traces when annotated, an overloaded run as a gap', () => {
  const circuit = new Circuit();
  const box = circuit.addAnnotation('box', { x: 0, y: 0, end: { x: 400, y: 200 }, plot: { kind: 'swing', range: { low: -60, high: 3 }, traces: [{ label: 'H_{1}', color: '#3b74e0', points: [{ a: -60, db: -50 }, { a: 0, db: -3 }, { a: 3, db: null }] }] } });
  const loaded = Circuit.fromJSON(JSON.parse(JSON.stringify(circuit.toJSON())));
  assert.deepEqual(loaded.labels.get(box.id).plot.traces[0].points.at(-1), { a: 3, db: null });
  assert.equal(loaded.labels.get(box.id).plot.kind, 'swing');
});

test('coefficients paste from the delta-sigma toolbox: vectors name their entries', () => {
  const { values, vectors } = parseCoefficientVectors('a = [0.0444 0.2843 0.7894 1.25]\nb=[1, 2]\ng = 0.0039', ['g_1']);
  assert.deepEqual(values, { a_1: 0.0444, a_2: 0.2843, a_3: 0.7894, a_4: 1.25, b_1: 1, b_2: 2, g_1: 0.0039 });
  assert.deepEqual(vectors, { a: 4, b: 2, g: 1 });
  // MATLAB's display: a scale line, column headers.
  assert.deepEqual(parseCoefficientVectors('a =\n\n   1.0e-03 *\n\n    0.4440    2.8430\n\nk = 2', ['k']).values, { a_1: 0.000444, a_2: 0.002843, k: 2 });
  assert.deepEqual(parseCoefficientVectors('c =\n  Columns 1 through 2\n    0.1    0.2\n  Column 3\n    0.3\n').values, { c_1: 0.1, c_2: 0.2, c_3: 0.3 });
});

import { bandEdges, responsePlot as bandedPlot } from '../src/core/analysis/signal-flow.js';
import { responseFigure, swingFigure, swingFullScale, swingLimit, swingOverload, swingRunaway } from '../src/core/bode-figure.js';

test('the band: a line at bw for a baseband signal, two at f0 +- bw/2, saved with the plot', () => {
  assert.deepEqual(bandEdges({ f0: 0, bw: 1 / 128 }), [1 / 128]);
  assert.deepEqual(bandEdges({ f0: 0.25, bw: 0.02 }), [0.24, 0.26]);
  assert.deepEqual(bandEdges({ bw: 0 }), []);
  const integrator = blockTransferFunction(new Circuit().addComponent('tf_z', { value: 'tf([0 1], [1 -1])' }));
  const plot = bandedPlot([{ label: 'H', color: '#3b74e0', value: integrator, variable: 'z' }], 'z', { band: { f0: 0, bw: 0.01 } });
  assert.deepEqual(plot.band, [0.01]);
  assert.equal(responseFigure(plot).items.filter((item) => item.role === 'band').length, 1);
  const circuit = new Circuit();
  const box = circuit.addAnnotation('box', { x: 0, y: 0, end: { x: 400, y: 200 }, plot });
  circuit.analysisValues.band = { f0: 0.25, bw: 0.02 };
  const loaded = Circuit.fromJSON(JSON.parse(JSON.stringify(circuit.toJSON())));
  assert.deepEqual(loaded.labels.get(box.id).plot.band, [0.01]);
  assert.deepEqual(loaded.analysisValues.band, { f0: 0.25, bw: 0.02 });
  // The curves land exactly on the band's edges and centre: a notch there
  // reads its true depth, not the grid's nearest step.
  const resonator = blockTransferFunction(new Circuit().addComponent('tf_z', { value: 'tf([1 0 1], [1])' })); // 1 + z^-2: a zero at f/fs = 1/4
  const notched = bandedPlot([{ label: 'N', color: '#3b74e0', value: resonator, variable: 'z' }], 'z', { band: { f0: 0.25, bw: 0.02 } });
  const at = (f) => notched.traces[0].points.find((p) => Math.abs(p.f - f) < 1e-15);
  assert.ok(at(0.24) && at(0.26) && at(0.25));
  assert.ok(at(0.25).db < -200, `the notch's depth: ${at(0.25).db}`);
  const points = notched.traces[0].points.map((p) => p.f);
  assert.deepEqual(points, [...points].sort((a, b) => a - b));
  // On ω (an s result), the edges at ω = 2 pi f.
  const pole = blockTransferFunction(new Circuit().addComponent('tf_s', { value: 'tf([1], [1 1])' }));
  const onOmega = bandedPlot([{ label: 'P', color: '#3b74e0', value: pole, variable: 's' }], 's', { band: { f0: 0, bw: 0.1 } });
  assert.ok(onOmega.traces[0].points.some((p) => Math.abs(p.f - 0.2 * Math.PI) < 1e-12));
});

test('a response is sampled densely across the band, and across a zoomed range', () => {
  const resonator = blockTransferFunction(new Circuit().addComponent('tf_z', { value: 'tf([1 0 1], [1])' }));
  const trace = [{ label: 'N', color: '#3b74e0', value: resonator, variable: 'z' }];
  const inBand = (plot, low, high) => plot.traces[0].points.filter((p) => p.f >= low && p.f <= high).length;
  const banded = bandedPlot(trace, 'z', { band: { f0: 0.25, bw: 0.002 } });
  assert.ok(inBand(banded, 0.249, 0.251) >= 96, String(inBand(banded, 0.249, 0.251)));
  const zoomed = bandedPlot(trace, 'z', { detail: [0.1, 0.11] });
  assert.ok(inBand(zoomed, 0.1, 0.11) >= 200, String(inBand(zoomed, 0.1, 0.11)));
  const points = zoomed.traces[0].points.map((p) => p.f);
  assert.deepEqual(points, [...points].sort((a, b) => a - b));
});

test('the swing plot marks where the swings run away: a net outgrowing the input, or an overload', () => {
  // Flat, noise-limited peaks jittering a dB or two, then a jump (4 dB past their best slope-1
  // line) a step before the overload.
  const jittery = { color: '#3b74e0', points: [-4, -3.75, -3.5, -3.25, -3, -2.75, -2.5].map((a, i) => ({ a, db: -10 + (i % 2 ? 1.5 : -1) })).concat([{ a: -2.25, db: -3 }, { a: -2, db: null }]) };
  // A tone tracking the input (slope 1) never trips it.
  const tone = { color: '#e0533b', points: [-20, -10, -4, -3, -2.5, -2.25].map((a) => ({ a, db: a })).concat([{ a: -2, db: null }]) };
  // A quantizer's output jumps between levels by nature: left out.
  const stepped = { color: '#2e9e5b', stepped: true, points: [{ a: -10, db: -6 }, { a: -9, db: 0 }, { a: -2, db: null }] };
  assert.equal(swingOverload([jittery, tone, stepped]), -2);
  assert.equal(swingRunaway([jittery, tone, stepped]), -2.25);
  assert.equal(swingRunaway([tone, stepped]), -2, 'no knee: the overload');
  const figure = swingFigure({ range: { low: -60, high: 3 }, traces: [jittery, tone, stepped] });
  assert.equal(figure.items.filter((item) => item.role === 'marker' && item.type === 'line').length, 1);
  assert.ok(figure.items.some((item) => item.type === 'text' && item.text === 'runaway -2.25 dBFS'));
  assert.equal(swingRunaway([{ points: [{ a: -20, db: -3 }, { a: 0, db: 1 }] }]), null);
  // A net rising smoothly through full scale first is the limit, named.
  const rising = { label: 'H_{3}', color: '#c98a12', points: [{ a: -10, db: -6 }, { a: -4, db: -2 }, { a: -3, db: 2 }] };
  assert.deepEqual(swingLimit([jittery, tone, stepped, rising]), { a: -3.5, kind: 'full-scale', label: 'H_{3}' });
  assert.ok(swingFigure({ range: { low: -60, high: 3 }, traces: [jittery, rising] }).items.some((item) => item.text === 'H_{3} full scale -3.5 dBFS'));
  // Nets at full scale from the start (a quantizer's output) never cross.
  assert.equal(swingFullScale([stepped, { points: [{ a: -20, db: 0 }, { a: 0, db: 0.5 }] }]), null);
  // The output's tone follows the input through full scale by design: not a limit.
  const outputTone = { ...rising, tone: true, label: '\\text{tone at } V_{\\text{OUT}}' };
  assert.equal(swingFullScale([outputTone]), null);
  // A TeX name is plot text in the marker, never raw TeX.
  const named = swingFigure({ range: { low: -60, high: 3 }, traces: [{ ...rising, label: '\\text{peak } V_{\\text{X}}' }] });
  assert.ok(named.items.some((item) => item.text === 'peak V_{X} full scale -3.5 dBFS'));
});

import { bandSqnr } from '../src/core/analysis/signal-flow.js';
import { swapCandidates } from '../src/core/swap.js';

test('signal-flow parts swap only among themselves; the DAC and delays are preset blocks', () => {
  for (const type of ['tf_s', 'gain', 'sampler', 'quantizer', 'tf_dac']) {
    assert.ok(swapCandidates(type).every((candidate) => !/^filter_|^block$/.test(candidate)), type);
  }
  assert.ok(swapCandidates('filter_lpf').every((candidate) => /^filter_/.test(candidate)));
  const circuit = new Circuit();
  assert.equal(circuit.addComponent('tf_dac').value, '(1 - exp(-s*T))/s');
  assert.equal(circuit.addComponent('tf_dac_rz').value, '(1 - exp(-s*T/2))/s');
  assert.equal(circuit.addComponent('tf_delay').value, 'exp(-s*T_d)');
  const zdelay = circuit.addComponent('tf_zdelay');
  assert.equal(transferTexOf(zdelay), 'z^{-1}');
  // A DAC preset closes a sampled loop like a DAC drawn as an H(s) block.
  const loop = diagram([
    'add input U --at -1200 0', 'add signal_sum S1 --at -800 0', 'add tf_s H1 --at -400 0 --value "1/s"', 'add sampler SMP1 --at 0 0',
    'add quantizer QZ1 --at 400 0', 'add output V --at 800 0', 'add tf_dac D1 --at 0 400 --rot 180',
    'connect U.p S1.w', 'connect S1.e H1.in', 'connect H1.out SMP1.in', 'connect SMP1.out QZ1.in', 'connect QZ1.out V.p', 'connect V.p D1.in', 'connect D1.out S1.s',
  ], [['S1', 's']]);
  const report = analyzeSignalFlow(loop, { output: 'V', sources: { QZ1: 'input' }, values: { T: 1 } });
  assert.equal(report.ok, true, report.error);
  assert.equal(report.entries[0].equation, '\\frac{V}{E_{QZ1}} = 1 - z^{-1}');
  // An RZ pulse puts half the charge into the integrator: L = z^-1/2 / (1 - z^-1).
  const rz = diagram([
    'add input U --at -1200 0', 'add signal_sum S1 --at -800 0', 'add tf_s H1 --at -400 0 --value "1/s"', 'add sampler SMP1 --at 0 0',
    'add quantizer QZ1 --at 400 0', 'add output V --at 800 0', 'add tf_dac_rz D1 --at 0 400 --rot 180',
    'connect U.p S1.w', 'connect S1.e H1.in', 'connect H1.out SMP1.in', 'connect SMP1.out QZ1.in', 'connect QZ1.out V.p', 'connect V.p D1.in', 'connect D1.out S1.s',
  ], [['S1', 's']]);
  const rzReport = analyzeSignalFlow(rz, { output: 'V', sources: { QZ1: 'input' }, values: { T: 1 } });
  assert.equal(rzReport.ok, true, rzReport.error);
  assert.equal(rzReport.entries[0].equation, '\\frac{V}{E_{QZ1}} = \\frac{1 - z^{-1}}{1 - 0.5 z^{-1}}');
});

function transferTexOf(component) {
  return [...component.circuit.labels.values()].find((l) => l.owner === component.refdes && l.role === TRANSFER_FUNCTION_ROLE).text.replace(/^\$|\$$/g, '');
}

test('the peak SQNR in band: a full-scale sine against white quantization noise through the NTF', () => {
  const circuit = new Circuit();
  const mod1 = blockTransferFunction(circuit.addComponent('tf_z', { value: 'tf([1 -1], [1])' }));
  const mod2 = blockTransferFunction(circuit.addComponent('tf_z', { value: 'tf([1 -2 1], [1])' }));
  // MOD1: 9 OSR^3 / (2 pi^2); MOD2: 15 OSR^5 / (2 pi^4), single-bit (sigma^2 = 1/3).
  const osr = 64;
  assert.ok(Math.abs(bandSqnr(mod1, 2, { bw: 1 / (2 * osr) }) - 10 * Math.log10(9 * osr ** 3 / (2 * Math.PI ** 2))) < 0.05);
  assert.ok(Math.abs(bandSqnr(mod2, 2, { bw: 1 / (2 * osr) }) - 10 * Math.log10(15 * osr ** 5 / (2 * Math.PI ** 4))) < 0.05);
  // Three levels: twice the amplitude, 6 dB.
  assert.ok(Math.abs(bandSqnr(mod2, 3, { bw: 1 / 128 }) - bandSqnr(mod2, 2, { bw: 1 / 128 }) - 20 * Math.log10(2)) < 1e-9);
  // A band-pass band integrates f0 +- bw/2; no band, no SQNR.
  assert.ok(Number.isFinite(bandSqnr(mod1, 2, { f0: 0.25, bw: 0.01 })));
  assert.equal(bandSqnr(mod1, 2, {}), null);
});

test('the signal-flow settings are saved with the document', () => {
  const circuit = new Circuit();
  circuit.analysisValues.flow = { output: 'name:V', sources: { U: 'input', QZ1: 'zero', W: { constant: 'a' } }, swingInput: 'U', swingFrequency: '1/512' };
  const loaded = Circuit.fromJSON(JSON.parse(JSON.stringify(circuit.toJSON())));
  assert.deepEqual(loaded.analysisValues.flow, circuit.analysisValues.flow);
});

// ----- phase, step, root locus, spectrum ------------------------------------------------

import { stepPlot, stepResponse } from '../src/core/analysis/step.js';
import { locusPlot, rootLocus } from '../src/core/analysis/locus.js';
import { dbfsOffset, dbfsSpectrum, inBand, outputSpectrum } from '../src/core/analysis/spectrum.js';
import { locusFigure, stepFigure } from '../src/core/bode-figure.js';

test('step responses: exact for s (overshoot of a second-order section), by recursion for z', () => {
  const circuit = new Circuit();
  const tf = (type, value) => blockTransferFunction(circuit.addComponent(type, { value }));
  const underdamped = stepResponse(tf('tf_s', 'tf([1], [1 0.4 1])'));
  // zeta = 0.2: overshoot exp(-pi zeta / sqrt(1 - zeta^2)).
  const peak = Math.max(...underdamped.points.map((p) => p.y));
  assert.ok(Math.abs(peak - 1 - Math.exp(-Math.PI * 0.2 / Math.sqrt(1 - 0.04))) < 2e-3);
  assert.ok(Math.abs(underdamped.points.at(-1).y - 1) < 2e-3);
  // A delay shifts its term's step response.
  const delayed = stepResponse(tf('tf_s', 'exp(-s*2)/(s+1)'));
  assert.ok(delayed.points.filter((p) => p.t < 1.9).every((p) => Math.abs(p.y) < 1e-9));
  // In z: the samples of the difference equation; an NTF's FIR step 1, -1, 0, ...
  const ntf = stepResponse(tf('tf_z', 'tf([1 -2 1], [1])'));
  assert.deepEqual(ntf.points.slice(0, 4).map((p) => p.y), [1, -1, 0, 0]);
  assert.equal(ntf.unit, 'n');
  const plot = stepPlot([{ label: 'A', color: '#3b74e0', value: tf('tf_z', 'tf([0.5], [1 -0.5])') }]);
  assert.equal(plot.kind, 'step');
  assert.ok(stepFigure(plot).items.some((item) => item.type === 'path'));
  const loaded = Circuit.fromJSON(JSON.parse(JSON.stringify((() => { const c = new Circuit(); c.addAnnotation('box', { x: 0, y: 0, end: { x: 400, y: 200 }, plot }); return c; })().toJSON())));
  assert.equal([...loaded.labels.values()][0].plot.traces[0].stairs, true);
});

test('the root locus finds where a loop becomes stable and unstable again', () => {
  // MOD2 with k_1 = 1: stable for 1 < k_2 < 2.5 (|a_2| < 1, 1 - a_1 + a_2 > 0).
  const report = analyzeSignalFlow(quantizedModulator('dt'), { output: 'V', sources: { QZ1: 'input' } });
  const [ntf] = report.entries;
  const locus = rootLocus((k) => withCoefficients(ntf.value, { k_1: 1, k_2: k }), { from: 0.5, to: 5, current: 2, steps: 400 });
  assert.equal(locus.variable, 'z');
  assert.deepEqual(locus.crossings.map((c) => c.becomes), ['stable', 'unstable']);
  assert.ok(Math.abs(locus.crossings[0].k - 1) < 0.02 && Math.abs(locus.crossings[1].k - 2.5) < 0.02);
  const plot = locusPlot(locus, { parameter: 'k_2' });
  assert.ok(locusFigure(plot).items.some((item) => /^stable for k_2 1(\.0\d)? … 2\.5\d?$/.test(item.text || '')), locusFigure(plot).items.map((i) => i.text).filter(Boolean).join(' | '));
});

test('the simulated spectrum: shaped error on its |NTF|, the SNDR in band', () => {
  const sim = prepareSimulation(quantizedModulator('dt'), { values: { k_1: 1, k_2: 2 }, input: 'U', output: 'name:V', frequency: 1 / 256, samples: 16384 });
  const run = sim.run(-6, { record: true });
  const spectrum = outputSpectrum(run.samples);
  // Around f/fs = 0.25 the floor reads |NTF|^2 = (2 sin(pi/4))^4, 6 dB.
  const near = spectrum.points.filter((p) => Math.abs(p.f - 0.25) < 0.01);
  const floor = 10 * Math.log10(near.reduce((sum, p) => sum + 10 ** (p.db / 10), 0) / near.length);
  assert.ok(Math.abs(floor - 6) < 1.5, `${floor}`);
  // A second-order loop at OSR 64, -6 dBFS: near the linear model's 73 dB, a little under.
  const measured = inBand(spectrum, sim.frequency, [1 / 128]);
  assert.ok(measured.sndr > 65 && measured.sndr < 76, `${measured.sndr}`);
});

test('with a simulated spectrum the response graph is one plot in dBFS: noise levels and tone levels', () => {
  const sim = prepareSimulation(quantizedModulator('dt'), { values: { k_1: 1, k_2: 2 }, input: 'U', output: 'name:V', frequency: 1 / 256, samples: 16384 });
  const run = sim.run(-6, { record: true });
  const raw = outputSpectrum(run.samples);
  const spectrum = dbfsSpectrum(raw, sim.fullScale);
  // The tone's bin reads its amplitude in dBFS.
  const tone = spectrum[Math.round(sim.frequency * raw.n) - 1];
  assert.ok(Math.abs(tone.db + 6) < 0.2, `${tone.db}`);
  // An NTF moved to the noise it predicts lies on the floor near f/fs = 0.25.
  const offset = dbfsOffset(raw, sim.fullScale, { noise: true });
  const near = spectrum.filter((p) => Math.abs(p.f - 0.25) < 0.01);
  const floor = 10 * Math.log10(near.reduce((sum, p) => sum + 10 ** (p.db / 10), 0) / near.length);
  assert.ok(Math.abs(floor - (6 + offset)) < 1.5, `${floor} vs ${6 + offset}`);
  // An STF moves to the tone's level.
  assert.equal(dbfsOffset(raw, sim.fullScale, { noise: false, amplitude: -6 }), -6);
  const ntf = blockTransferFunction(new Circuit().addComponent('tf_z', { value: 'tf([1 -2 1], [1])' }));
  const plot = bandedPlot([{ label: 'N', color: '#3b74e0', value: ntf, variable: 'z', noise: true }], 'z', { background: [{ label: 's', color: '#888888', points: spectrum }], dbfs: { offset: (t) => dbfsOffset(raw, sim.fullScale, { noise: t.noise, amplitude: -6 }) } });
  assert.equal(plot.units, 'dBFS');
  assert.equal(plot.traces[0].background, true);
  // Everything drawn stays inside the plot, the spectrum's lowest bins included.
  const figure = responseFigure(plot);
  for (const item of figure.items.filter((i) => i.type === 'path')) for (const p of item.points) assert.ok(p.x >= figure.pane.x - 1e-6, 'left of the axis');
});

import { loopBreakSignals, loopGain, loopMargins, transferTex } from '../src/core/analysis/signal-flow.js';

test('the loop gain at a broken signal: T with NTF = 1/(1 + T), its crossover and phase margin', () => {
  const dt = loopGain(quantizedModulator('dt'), { breakAt: 'V' });
  assert.equal(dt.ok, true, dt.error);
  assert.equal(transferTex(dt.value, 'z'), '\\frac{k_{2} z^{-1} + \\left(-k_{2} + k_{1}\\right) z^{-2}}{1 - 2 z^{-1} + z^{-2}}');
  // The equivalent continuous-time loop (gains 1, 1.5, an NRZ DAC) samples to the same T.
  const ct = loopGain(quantizedModulator('ct'), { breakAt: 'V', values: { T: 1, T_d: 0, k_1: 1, k_2: 1.5 } });
  assert.equal(ct.ok, true, ct.error);
  assert.equal(transferTex(ct.value.at({ T: 1, T_d: 0, k_1: 1, k_2: 1.5 }), 'z'), '\\frac{2 z^{-1} - z^{-2}}{1 - 2 z^{-1} + z^{-2}}');
  const margins = loopMargins(responseCurve(withCoefficients(dt.value, { k_1: 1, k_2: 2 }), 'z'));
  assert.ok(Math.abs(margins.crossover - 0.283) < 0.005, `${margins.crossover}`);
  assert.ok(Math.abs(margins.phaseMargin - 23.9) < 0.5, `${margins.phaseMargin}`);
  // A source is not in a loop.
  assert.equal(loopGain(quantizedModulator('dt'), { breakAt: 'U' }).code, 'not-in-loop');
  // A loop plot keeps its role and its crossover marker when annotated.
  const circuit = new Circuit();
  const plot = bandedPlot([{ label: 'T', color: '#3b74e0', value: withCoefficients(dt.value, { k_1: 1, k_2: 2 }), variable: 'z' }], 'z');
  const box = circuit.addAnnotation('box', { x: 0, y: 0, end: { x: 400, y: 200 }, plot: { ...plot, role: 'loop', markers: [{ f: 0.283, label: 'PM 24°' }] } });
  const again = Circuit.fromJSON(JSON.parse(JSON.stringify(circuit.toJSON()))).labels.get(box.id).plot;
  assert.equal(again.role, 'loop');
  assert.deepEqual(again.markers, [{ f: 0.283, label: 'PM 24°' }]);
  assert.ok(responseFigure(again).items.some((item) => item.text === 'PM 24°'));
  assert.ok(responseFigure(again).items.some((item) => item.text === '|T| (dB)'));
});

test('a sampled loop breaks only at a sampled signal, a quantizer\'s output offered first', () => {
  const circuit = quantizedModulator('ct');
  const offered = loopBreakSignals(circuit).map((s) => s.display);
  assert.equal(offered[0], 'V');
  assert.ok(!offered.includes('N1') && offered.every((name) => name === 'V' || /^N/.test(name)));
  const continuous = [...signalFlowGraph(circuit).signals.values()].find((s) => s.driver?.comp === 'H1');
  assert.equal(loopGain(circuit, { breakAt: continuous.key, values: { T: 1, T_d: 0, k_1: 1, k_2: 1.5 } }).code, 'continuous-break');
});

test('plot traces take the highlight palette, so a trace and a highlighted net agree', async () => {
  const { TRACE_COLORS, MUTED_TRACE_COLOR } = await import('../src/core/analysis/signal-flow.js');
  const { COLOR_PALETTE } = await import('../src/core/style.js');
  const palette = new Set(Object.values(COLOR_PALETTE));
  for (const color of [...TRACE_COLORS, MUTED_TRACE_COLOR]) assert.ok(palette.has(color), color);
  assert.equal(new Set(TRACE_COLORS).size, TRACE_COLORS.length);
});
