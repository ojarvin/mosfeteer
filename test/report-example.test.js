import test from 'node:test';
import assert from 'node:assert/strict';
import { loadDocument } from '../src/core/document.js';
import { evaluate } from '../src/core/commands.js';
import { buildReport } from '../src/core/report.js';
import { analyzeSignalFlow } from '../src/core/analysis/signal-flow.js';
import { analyzeSwitchedCap } from '../src/core/analysis/switched-cap.js';
import { REPORT_EXAMPLE_NAMES, reportExampleDesigns } from '../src/web/examples/report-example.js';

const designs = () => reportExampleDesigns().map(({ name, state }) => ({ name, circuit: loadDocument(state) }));

test('the report example: two clean designs, the modulator linking to the integrator', () => {
  const [modulator, integrator] = designs();
  assert.deepEqual([modulator.name, integrator.name], [REPORT_EXAMPLE_NAMES.modulator, REPORT_EXAMPLE_NAMES.integrator]);
  assert.deepEqual(evaluate(modulator.circuit).issues, []);
  assert.deepEqual(evaluate(integrator.circuit).issues, []);
  assert.equal(modulator.circuit.components.get('H1').link, REPORT_EXAMPLE_NAMES.integrator);
  assert.deepEqual([...integrator.circuit.components.values()].filter((part) => part.link), [], 'no link out of the example');
  // What the notes say holds: the STF is z^-1 at a = 1, the integrator's H(z) as written.
  const flow = analyzeSignalFlow(modulator.circuit, { output: 'V', sources: { U: 'input' } });
  assert.equal(flow.entries[0].equation, '\\frac{V}{U} = \\frac{a z^{-1}}{1 + \\left(-1 + a\\right) z^{-1}}');
  const { sc } = integrator.circuit.analysisValues;
  assert.equal(analyzeSwitchedCap(integrator.circuit, { input: sc.input, output: sc.output, readout: sc.readout }).ok, true);
});

test('the report example\'s report: the integrator a section, every figure drawn at the guide\'s text size', () => {
  const [modulator, integrator] = designs();
  const report = buildReport(modulator.circuit, { name: modulator.name, design: (name) => (name.toLowerCase() === integrator.name ? integrator : null) });
  assert.deepEqual(report.warnings, []);
  assert.equal(report.figures.length, 12);
  assert.deepEqual(report.figures.slice(0, 4).map((figure) => figure.kind), ['circuit', 'figure', 'figure', 'figure'], 'the modulator\'s equations and plots');
  assert.ok(report.figures.every((figure) => Math.abs(figure.textPt - 8) < 0.05));
  assert.match(report.html, /<section id="design-report-example-integrator" class="design-section">\n<h2 id="sec-3"><span class="section-number">3<\/span> SC integrator with correlated level shifting<\/h2>/);
  const toc = report.html.slice(report.html.indexOf('<nav class="note-toc">'), report.html.indexOf('</nav>'));
  assert.deepEqual([...toc.matchAll(/<a href="#[^"]+">(?:<span class="section-number">([\d.]+)<\/span> )?([^<]+)<\/a>/g)].map((m) => [m[1] || '', m[2]].join(' ').trim()),
    ['1 The loop', '2 Analysis', '3 SC integrator with correlated level shifting', '3.1 Clocking', '3.2 Transfer function', '3.3 Noise and sizing', '4 References']);
  assert.equal(report.html.match(/<li id="ref-\d+">/g).length, 2, 'both citations in the one list');
});
