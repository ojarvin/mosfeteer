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
  assert.match(report.html, /<section id="design-report-example-integrator" class="design-section">\n<h3 id="sec-3-1"><span class="section-number">3\.1<\/span> SC integrator with correlated level shifting<\/h3>/);
  const toc = report.html.slice(report.html.indexOf('<nav class="note-toc">'), report.html.indexOf('</nav>'));
  assert.deepEqual([...toc.matchAll(/<a href="#[^"]+">(?:<span class="section-number">([\d.]+)<\/span> )?([^<]+)<\/a>/g)].map((m) => [m[1] || '', m[2]].join(' ').trim()),
    ['1 The loop', '2 Analysis', '3 Blocks', '3.1 SC integrator with correlated level shifting', '3.1.1 Clocking', '3.1.2 Transfer function', '3.1.3 Noise and sizing', '4 References']);
  assert.equal(report.html.match(/<li id="ref-\d+">/g).length, 2, 'both citations in the one list');
});

test('a report draws each plot again, its box three fifths of the guide whatever its legend, its text at the guide\'s size, the design untouched', () => {
  const [modulator, integrator] = designs();
  const before = JSON.stringify(modulator.circuit.toJSON());
  const report = buildReport(modulator.circuit, { name: modulator.name, design: (name) => (name === integrator.name ? integrator : null) });
  assert.equal(JSON.stringify(modulator.circuit.toJSON()), before);
  // Each figure's plot box on the page: its paper's width, in points.
  const boxes = [...report.html.matchAll(/<figure id="fig-(\d+)">(<svg[\s\S]*?<\/svg>)/g)].map(([, number, svg]) => {
    const ptPerUnit = Number(svg.match(/ width="([\d.]+)pt"/)[1]) / Number(svg.match(/viewBox="([^"]+)"/)[1].split(/\s+/)[2]);
    return [Number(number), Number(svg.match(/class="plot-paper"[^>]* width="([\d.]+)"/)?.[1]) * ptPerUnit];
  });
  const plotFigures = report.figures.filter((figure) => ['F2', 'F3'].includes(figure.name) && !figure.design).map((figure) => figure.number);
  assert.deepEqual(plotFigures, [3, 4]);
  for (const number of plotFigures) {
    const width = boxes.find(([n]) => n === number)[1];
    assert.ok(Math.abs(width - 0.6 * 453.54) < 1, `Fig. ${number}'s box is ${width} pt wide`);
    assert.ok(Math.abs(report.figures.find((figure) => figure.number === number).textPt - 8) < 0.05);
  }
});
