import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { runCommand } from '../src/core/commands.js';
import { analyzeSignalFlow, blockTransferFunction, responseCurve, signalFlowGraph } from '../src/core/analysis/signal-flow.js';

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
  assert.equal(analyzeSignalFlow(mixed, { output: 'Y', sources: { U: 'input' } }).code, 'mixed-domains');
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
