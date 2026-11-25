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
  assert.match(report.html, /<section id="design-report-example-integrator" class="design-section">\n<h3 id="sec-5-1"><span class="section-number">5\.1<\/span> SC integrator with correlated level shifting<\/h3>\n<p class="section-author">Example Author<\/p>/);
  assert.match(report.html, /<p class="report-authors"><span class="report-author">Claude<\/span><\/p>/);
  const toc = report.html.slice(report.html.indexOf('<nav class="note-toc">'), report.html.indexOf('</nav>'));
  assert.deepEqual([...toc.matchAll(/<a href="#[^"]+">(?:<span class="section-number">([\d.]+)<\/span> )?([^<]+)<\/a>/g)].map((m) => [m[1] || '', m[2]].join(' ').trim()),
    ['1 Introduction', '2 The loop', '2.1 Model', '3 Analysis', '3.1 Stability', '3.2 Resolution', '4 Status', '5 Blocks',
      '5.1 SC integrator with correlated level shifting', '5.1.1 Clocking', '5.1.2 Transfer function', '5.1.3 Noise and sizing', '6 References']);
  assert.equal(report.html.match(/<li id="ref-\d+">/g).length, 3, 'every citation in the one list');
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

test('the report example says it is a sample, cites only placeholders, and its numbers add up', () => {
  const [modulator, integrator] = designs();
  assert.match(modulator.circuit.notes, /^# [^\n]+\n\nAuthor: Claude\n\n> \*\*Sample document\.\*\*/);
  for (const { circuit } of [modulator, integrator]) {
    const sources = [...circuit.notes.matchAll(/\[\^([^\]]+)\]/g)].map((m) => m[1]);
    assert.ok(sources.length > 0);
    for (const source of sources) assert.match(source, /^Placeholder, .*\(A dummy reference\.\)$/, source);
  }
  // The resolution table: SQNR = 6.02 N + 1.76 - 5.17 + 30 log10 OSR, N = 1.
  for (const [, osr, sqnr, bits] of modulator.circuit.notes.matchAll(/^\| (\d+) \| ([\d.]+) dB \| ([\d.]+) \|$/gm)) {
    const exact = 6.02 + 1.76 - 5.17 + 30 * Math.log10(Number(osr));
    assert.equal(Number(sqnr), Math.round(exact * 10) / 10, `OSR ${osr}`);
    assert.equal(Number(bits), Math.round(((exact - 1.76) / 6.02) * 10) / 10, `OSR ${osr}`);
  }
  // kT/C of 250 fF at 85 °C.
  assert.equal(Math.round(Math.sqrt((1.380649e-23 * 358.15) / 250e-15) * 1e6), 141);
  assert.match(integrator.circuit.notes, /\\approx 141\\,\\mu\\text\{V\}/);
});
