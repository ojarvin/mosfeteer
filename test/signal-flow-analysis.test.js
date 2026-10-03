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
