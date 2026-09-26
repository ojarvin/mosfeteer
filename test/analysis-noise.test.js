import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSmallSignalV2 } from '../src/core/analysis/engine.js';
import { adaptCombinedReport } from '../src/core/analysis/report-adapter.js';
import { stripProvenanceMarkers, renderExpression } from '../src/core/analysis/present.js';
import { noiseCandidates, noiseRequest } from '../src/core/analysis/noise.js';
import { smallSignalGoldenCorpus } from './fixtures/small-signal-golden.js';

function fixture(id) {
  return smallSignalGoldenCorpus.find((entry) => entry.id === id);
}

function analyze(id, noise = true, options = {}) {
  const entry = fixture(id);
  return analyzeSmallSignalV2(entry.build(), { ...entry.ports, noise, ...options });
}

function terms(report, key) {
  const row = report.noise.rows.find((entry) => entry.key === key);
  return row ? Object.fromEntries(row.terms.map(({ component, expression }) => [component, renderExpression(expression)])) : null;
}

test('noise requests normalize to thermal and flicker over all or named sources', () => {
  assert.equal(noiseRequest(undefined), null);
  assert.equal(noiseRequest({ thermal: false, flicker: false }), null);
  assert.deepEqual(noiseRequest(true), { sources: null, thermal: true, flicker: true });
  assert.deepEqual(noiseRequest({ sources: ['M1', 'M1', 'RD'], flicker: false }), { sources: ['M1', 'RD'], thermal: true, flicker: false });
  assert.deepEqual(noiseCandidates(fixture('nmos-common-source').build()), ['M1', 'RD']);
});

test('a common-source stage refers its channel and load noise to the gate', () => {
  const report = analyze('nmos-common-source');
  assert.ok(report.ok && report.noise.ok);
  assert.deepEqual(terms(report, 'input-thermal'), {
    M1: '\\frac{\\gamma}{g_{m1}}',
    RD: '\\frac{1}{g_{m1}^{2} \\, R_{D}}',
  });
  assert.deepEqual(terms(report, 'input-flicker'), { M1: '\\frac{K_{f,n}}{C_{ox} \\, L_{1} \\, W_{1}}' });
  assert.deepEqual(terms(report, 'output-thermal'), {
    M1: '\\frac{R_{D}^{2} \\, r_{o1}^{2} \\, \\gamma \\, g_{m1}}{\\left(R_{D} + r_{o1}\\right)^{2}}',
    RD: '\\frac{r_{o1}^{2} \\, R_{D}}{\\left(R_{D} + r_{o1}\\right)^{2}}',
  });
  // The flicker weight's own symbols trace back to the device.
  assert.equal(report.symbolProvenance['W_{1}'].component, 'M1');
});

test('degeneration refers its resistor noise as 4kT R_S and cancels common load factors', () => {
  const report = analyze('source-degeneration', { flicker: false });
  assert.deepEqual(terms(report, 'input-thermal'), {
    M1: '\\frac{\\gamma}{g_{m1}}',
    RD: '\\frac{\\left(g_{m1} \\, R_{S} + 1\\right)^{2}}{g_{m1}^{2} \\, R_{D}}',
    RS: 'R_{S}',
  });
  assert.equal(terms(report, 'input-flicker'), null);
});

test('a cascode device is suppressed by the input device intrinsic gain squared', () => {
  const report = analyze('nmos-cascode', { flicker: false });
  assert.equal(terms(report, 'input-thermal').M2, '\\frac{\\gamma}{g_{m1}^{2} \\, r_{o1}^{2} \\, g_{m2}}');
});

test('a resistive divider refers each resistor exactly', () => {
  const report = analyze('passive-divider');
  assert.deepEqual(terms(report, 'input-thermal'), { R1: 'R_{1}', R2: '\\frac{R_{1}^{2}}{R_{2}}' });
  // Resistors have no flicker noise, so no flicker row appears.
  assert.equal(report.noise.rows.some((row) => row.kind === 'flicker'), false);
});

test('only the selected sources get a noise column', () => {
  const report = analyze('nmos-common-source', { sources: ['RD'] });
  assert.deepEqual(report.noise.sources, ['RD']);
  assert.deepEqual(Object.keys(terms(report, 'input-thermal')), ['RD']);
  assert.equal(report.details.system.rhsCount, 3);
});

test('without a noise request the solve keeps its two port columns', () => {
  const report = analyze('nmos-common-source', false);
  assert.equal(report.noise, undefined);
  assert.equal(report.details.system.rhsCount, 2);
});

test('a generator that cannot reach the ports is reported, not solved', () => {
  const circuit = fixture('passive-divider').build();
  circuit.addComponent('resistor', { refdes: 'RX', x: 800, y: 800 });
  circuit.addComponent('ground', { refdes: 'GX', x: 960, y: 880 });
  circuit.addComponent('supply', { refdes: 'SX', x: 640, y: 720 });
  circuit.connect('RX.a', 'SX.p');
  circuit.connect('RX.b', 'GX.gnd');
  const report = analyzeSmallSignalV2(circuit, { ...fixture('passive-divider').ports, noise: true });
  assert.deepEqual(report.noise.silent, ['RX']);
  assert.match(report.log, /Noise: RX does not reach the output\./);
});

test('the report adapter renders one prefixed row per referral and kind', () => {
  const adapted = adaptCombinedReport(analyze('nmos-common-source', { flicker: false }));
  const titles = adapted.equationEntries.map(({ title }) => title);
  assert.deepEqual(titles.slice(-2), ['Input-referred thermal noise', 'Output thermal noise']);
  const row = adapted.equationEntries.find(({ title }) => title === 'Input-referred thermal noise').result;
  assert.equal(row.equation, 'S_{v,in,th} = 4kT\\left(\\frac{\\gamma}{g_{m1}} + \\frac{1}{g_{m1}^{2} \\, R_{D}}\\right)');
  assert.equal(stripProvenanceMarkers(row.equationProvenance.tex), row.equation);
});

test('a single flicker term follows its 1/f prefix with a dot, not parentheses', () => {
  const adapted = adaptCombinedReport(analyze('nmos-common-source', { thermal: false }));
  const row = adapted.equationEntries.find(({ title }) => title === 'Input-referred flicker noise').result;
  assert.equal(row.equation, 'S_{v,in,1/f} = \\frac{1}{f} \\cdot \\frac{K_{f,n}}{C_{ox} \\, L_{1} \\, W_{1}}');
});

test('a triode device contributes the thermal noise of its r_ds', () => {
  const entry = fixture('nmos-common-source');
  const report = analyzeSmallSignalV2(entry.build(), { ...entry.ports, noise: { flicker: false }, deviceRegions: { M1: { region: 'triode' } } });
  assert.ok(report.ok);
  // A triode M1 has no gain, so nothing refers to its gate; the output row stays.
  assert.equal(terms(report, 'input-thermal'), null);
  assert.ok(terms(report, 'output-thermal').M1);
});

test('factors every term shares move in front of the sum, with 1/f in a flicker row', () => {
  const entry = smallSignalGoldenCorpus.find(({ id }) => id === 'current-mirror-load');
  const adapted = adaptCombinedReport(analyzeSmallSignalV2(entry.build(), { ...entry.ports, noise: true }));
  const equation = (title) => adapted.equationEntries.find((candidate) => candidate.title === title).result;
  assert.equal(equation('Input-referred thermal noise').equation,
    'S_{v,in,th} \\approx 4kT \\frac{\\gamma}{g_{m1}}\\left(1 + \\frac{g_{m2}}{g_{m1}} + \\frac{g_{m2}^{2}}{g_{m1} \\, g_{m3}}\\right)');
  assert.match(equation('Output flicker noise').equation, /^S_\{v,out,1\/f\} \\approx \\frac\{g_\{m3\}\^\{2\} \\, r_\{o3\}\^\{2\}\}\{C_\{ox\} \\, f\}\\left\(/);
  for (const title of ['Input-referred thermal noise', 'Output flicker noise']) {
    const row = equation(title);
    assert.equal(stripProvenanceMarkers(row.equationProvenance.tex), row.equation);
  }
  // The exact equation keeps one unfactored term per generator.
  assert.match(equation('Input-referred thermal noise').exactEquation, /^S_\{v,in,th\} = 4kT\\left\(/);
});
