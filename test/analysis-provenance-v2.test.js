import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { texToMathML } from '../src/core/render.js';
import { analyzeSmallSignalV2 } from '../src/core/analysis/engine.js';
import { adaptCombinedReport } from '../src/core/analysis/report-adapter.js';
import { componentsOfSymbols, symbolProvenance } from '../src/core/analysis/provenance.js';
import {
  joinProvenanceRenders,
  renderEquation,
  renderEquationWithProvenance,
  renderExpression,
  renderExpressionWithProvenance,
  stripProvenanceMarkers,
} from '../src/core/analysis/present.js';
import { add, integer, multiply, power, rationalFunction, symbol } from '../src/core/analysis/rational.js';
import { buildSmallSignalGolden, smallSignalGoldenCorpus } from './fixtures/small-signal-golden.js';

const s = symbol('s');
const gm1 = symbol('gm1');
const gm2 = symbol('gm2');
const ro1 = symbol('ro1');
const rd = symbol('RD');

const EXPRESSIONS = [
  gm1,
  integer(1),
  multiply(integer(-1), gm1),
  multiply(s, add(gm1, gm2)),
  power(add(gm1, rd), 2),
  add(multiply(gm1, gm2), rd),
  add(multiply(integer(-1), gm1), multiply(integer(-1), gm2)),
  multiply(gm1, gm1),
  rationalFunction(multiply(integer(-1), gm1, rd), add(integer(1), multiply(s, rd)), 's'),
  rationalFunction(add(integer(1), multiply(gm1, ro1)), multiply(s, add(rd, ro1)), 's'),
];

/** Remove every `<mrow data-node>` wrapper, keeping its contents. */
function unwrapProvenanceRows(mathml) {
  const tags = [...mathml.matchAll(/<\/?mrow\b[^>]*>/g)];
  const open = [];
  const cuts = [];
  for (const tag of tags) {
    if (tag[0].startsWith('</')) {
      const start = open.pop();
      if (start) cuts.push([start.index, start.index + start[0].length], [tag.index, tag.index + tag[0].length]);
    } else if (/\bdata-node=/.test(tag[0])) open.push(tag);
    else open.push(null);
  }
  let out = mathml;
  for (const [from, to] of cuts.sort((a, b) => b[0] - a[0])) out = out.slice(0, from) + out.slice(to);
  return out;
}

test('symbolProvenance inverts the devices.js naming chokepoint', () => {
  const table = symbolProvenance([
    { kind: 'resistor', id: 'M1.ro', value: 'ro1', metadata: { component: 'M1' } },
    { kind: 'vccs', id: 'M1.gm', value: 'gm1', metadata: { component: 'M1' } },
    { kind: 'resistor', id: 'RD.resistor', value: 'RD', metadata: { component: 'RD' } },
  ]);
  assert.deepEqual(table.ro1, { component: 'M1', role: 'ro', kind: 'resistor', primitives: ['M1.ro'] });
  assert.equal(table.gm1.component, 'M1');
  assert.equal(table.RD.role, 'resistor');
  assert.deepEqual(componentsOfSymbols(['gm1', 'ro1', 'RD', 's'], table), ['M1', 'RD']);
});

test('symbolProvenance skips primitives that mint no symbol of their own', () => {
  const table = symbolProvenance([
    // A Miller shunt carries an expression, not a parameter name: the symbols
    // inside it belong to the feedback components that produced them.
    { kind: 'admittance', id: 'M1.miller-gate', value: { kind: 'multiply' }, metadata: { component: 'M1' } },
    { kind: 'voltage-source', id: 'V1.voltage-source', value: 0, metadata: { component: 'V1' } },
    { kind: 'resistor', id: 'orphan', value: 'Rx' },
  ]);
  assert.deepEqual(Object.keys(table), []);
});

test('a provenance render is an ordinary render plus markers', () => {
  for (const expression of EXPRESSIONS) {
    const plain = renderExpression(expression);
    const { tex } = renderExpressionWithProvenance(expression);
    assert.notEqual(tex, plain, `${plain} should carry markers`);
    assert.equal(stripProvenanceMarkers(tex), plain, `stripped provenance render of ${plain}`);
  }
});

test('every marker id in the rendered TeX has a node entry, and vice versa', () => {
  const { tex, nodes } = renderExpressionWithProvenance(
    rationalFunction(multiply(integer(-1), gm1, rd), add(integer(1), multiply(s, rd)), 's'),
  );
  const used = [...tex.matchAll(/\\pv\{(\d+)\}/g)].map((match) => Number(match[1])).sort((a, b) => a - b);
  assert.deepEqual(nodes.map((node) => node.id), used);
  assert.ok(used.length > 3, 'a rational expression has several sub-expressions');
  const root = nodes.find((node) => node.symbols.length === 3);
  assert.deepEqual(root.symbols.sort(), ['RD', 'gm1', 's']);
  for (const node of nodes) assert.ok(node.symbols.every((name) => typeof name === 'string'));
});

test('an equation render keeps its label outside the markers', () => {
  const plain = renderEquation('A_v', multiply(gm1, rd));
  const { tex, nodes } = renderEquationWithProvenance('A_v', multiply(gm1, rd));
  assert.equal(stripProvenanceMarkers(tex), plain);
  assert.ok(tex.startsWith('A_v = \\pv{'));
  assert.ok(nodes.length >= 3);
});

test('markers become data-node attributes and change nothing else in the MathML', () => {
  for (const expression of EXPRESSIONS) {
    const plain = texToMathML(renderExpression(expression));
    const marked = texToMathML(renderExpressionWithProvenance(expression).tex);
    assert.match(marked, /<mrow data-node="\d+">/);
    assert.equal(unwrapProvenanceRows(marked), plain, `MathML for ${renderExpression(expression)}`);
  }
});

test('markers survive the whole golden corpus unchanged', () => {
  let checked = 0;
  for (const fixture of smallSignalGoldenCorpus) {
    const report = analyzeSmallSignalV2(buildSmallSignalGolden(fixture.id), { input: 'VIN.p', output: 'VOUT.p' });
    if (!report.ok) continue;
    for (const part of [report.input, report.output, report.transfer]) {
      const expression = part?.expression;
      if (expression === undefined || expression === null) continue;
      const options = { equivalences: part.equivalences, equivalence: part.equivalence };
      const plain = renderExpression(expression, options);
      const { tex, nodes } = renderExpressionWithProvenance(expression, options);
      assert.equal(stripProvenanceMarkers(tex), plain, `${fixture.id}: ${plain}`);
      assert.equal(unwrapProvenanceRows(texToMathML(tex)), texToMathML(plain), `${fixture.id} MathML`);
      assert.ok(nodes.length > 0, `${fixture.id} produced no nodes`);
      checked += 1;
    }
  }
  assert.ok(checked > 30, `expected the corpus to exercise many expressions, got ${checked}`);
});

test('the v2 report carries a symbol provenance table for its own equations', () => {
  const report = analyzeSmallSignalV2(buildSmallSignalGolden('nmos-common-source'), { input: 'VIN.p', output: 'VOUT.p' });
  assert.equal(report.ok, true);
  const table = report.symbolProvenance;
  assert.equal(table.gm1.component, 'M1');
  assert.equal(table.ro1.component, 'M1');
  assert.equal(table.RD.component, 'RD');
  // Every symbol the displayed transfer function contains resolves to a device.
  const { nodes } = renderExpressionWithProvenance(report.transfer.expression, {
    equivalences: report.transfer.equivalences,
  });
  const symbols = [...new Set(nodes.flatMap((node) => node.symbols))];
  const unresolved = symbols.filter((name) => name !== 's' && !table[name]);
  assert.deepEqual(unresolved, [], `unresolved symbols: ${unresolved.join(', ')}`);
});

test('every displayed GUI row carries a provenance render of itself', () => {
  // The GUI never reads engine.js's own strings: `main.js` always goes through
  // `adaptCombinedReport`, which re-renders each row. A row whose provenance
  // render disagreed with its displayed string would highlight the wrong terms.
  let rows = 0;
  for (const fixture of smallSignalGoldenCorpus) {
    const report = adaptCombinedReport(
      analyzeSmallSignalV2(buildSmallSignalGolden(fixture.id), { input: 'VIN.p', output: 'VOUT.p' }),
    );
    for (const { title, result } of report.equationEntries || []) {
    if (result.definition) continue;
      // A definition row states which nodes the quantities were taken between.
      // It names no device parameter, so it has nothing to highlight.
      if (result.definition) continue;
      const provenance = result.equationProvenance;
      assert.ok(provenance, `${fixture.id} / ${title} has no provenance render`);
      assert.equal(stripProvenanceMarkers(provenance.tex), result.equation, `${fixture.id} / ${title}`);
      assert.ok(provenance.nodes.length > 0, `${fixture.id} / ${title} produced no nodes`);
      assertEverySymbolResolves(provenance, report.symbolProvenance, `${fixture.id} / ${title}`);
      rows += 1;
    }
  }
  assert.ok(rows > 30, `expected many displayed rows, got ${rows}`);
});

test('joinProvenanceRenders renumbers so joined parts cannot collide', () => {
  const a = renderExpressionWithProvenance(multiply(gm1, rd));
  const b = renderExpressionWithProvenance(add(ro1, rd));
  const joined = joinProvenanceRenders([a, b], ',\\quad ');
  assert.equal(stripProvenanceMarkers(joined.tex), `${renderExpression(multiply(gm1, rd))},\\quad ${renderExpression(add(ro1, rd))}`);
  const ids = joined.nodes.map((node) => node.id);
  assert.equal(new Set(ids).size, ids.length, 'joined node ids must stay unique');
  assert.equal(ids.length, a.nodes.length + b.nodes.length);
  // Every id the joined TeX references still resolves in the joined table.
  const used = new Set([...joined.tex.matchAll(/\\pv\{(\d+)\}/g)].map((match) => Number(match[1])));
  for (const id of used) assert.ok(joined.nodes.some((node) => node.id === id), `id ${id} is unresolved`);
  assert.equal(used.size, ids.length);
});

test('pole and zero rows carry provenance for every root they show', () => {
  let rows = 0;
  for (const id of ['rlc-first-order', 'rlc-second-order']) {
    const report = adaptCombinedReport(
      analyzeSmallSignalV2(buildSmallSignalGolden(id), { input: 'VIN.p', output: 'VOUT.p' }),
    );
    for (const { title, result } of report.equationEntries || []) {
      if (title !== 'Poles' && title !== 'Zeros') continue;
      const provenance = result.equationProvenance;
      assert.ok(provenance, `${id} / ${title} has no provenance render`);
      assert.equal(stripProvenanceMarkers(provenance.tex), result.equation, `${id} / ${title}`);
      const ids = provenance.nodes.map((node) => node.id);
      assert.equal(new Set(ids).size, ids.length, `${id} / ${title} reused a node id`);
      // Each root resolves to the passives it was solved from.
      const resolved = provenance.nodes
        .flatMap((node) => componentsOfSymbols(node.symbols, report.symbolProvenance));
      assert.ok(resolved.includes('R1') && resolved.includes('C1'), `${id} / ${title} resolved no devices`);
      rows += 1;
    }
  }
  assert.ok(rows >= 2, `expected pole rows from the RLC fixtures, got ${rows}`);
});

/**
 * Every symbol a row displays must resolve to a circuit object. A symbol that
 * does not simply fails to highlight, so this gap is invisible until someone
 * points at the term — which is how a Miller-absorbed feedback capacitor went
 * unresolved. `s` is the complex frequency and names nothing on the canvas.
 */
function assertEverySymbolResolves(provenance, table, label) {
  const symbols = [...new Set(provenance.nodes.flatMap((node) => node.symbols))];
  const unresolved = symbols.filter((name) => name !== 's' && !table[name]);
  assert.deepEqual(unresolved, [], `${label}: unresolved symbols ${unresolved.join(', ')}`);
}

function renameNetAt(circuit, terminal, name) {
  circuit.renameNet(circuit.netOfTerminal(terminal), name);
}

/** A common-source stage with a gate-drain feedback capacitor, so the Miller
 *  approximation applies and CGD's own primitive leaves the solved model. */
function commonSourceWithFeedbackCapacitor() {
  const circuit = new Circuit();
  circuit.addComponent('input', { refdes: 'VIN', x: -240, y: 0 });
  circuit.addComponent('output', { refdes: 'VOUT', x: 240, y: -80 });
  circuit.addComponent('nmos', { refdes: 'M1', x: 0, y: 0 });
  circuit.addComponent('resistor', { refdes: 'RD', x: 0, y: -160 });
  circuit.addComponent('capacitor', { refdes: 'CGD', x: -80, y: -80 });
  circuit.addComponent('ground', { refdes: 'GND', x: 160, y: 160 });
  circuit.addComponent('supply', { refdes: 'VDD', x: 160, y: -240 });
  circuit.connect('VIN.p', 'M1.g', 'CGD.a');
  circuit.connect('M1.d', 'RD.a', 'VOUT.p', 'CGD.b');
  circuit.connect('M1.s', 'GND.gnd');
  circuit.connect('RD.b', 'VDD.p');
  renameNetAt(circuit, 'VIN.p', 'VIN');
  renameNetAt(circuit, 'VOUT.p', 'VOUT');
  return circuit;
}

test('a Miller-absorbed feedback capacitor still resolves to its component', () => {
  const raw = analyzeSmallSignalV2(commonSourceWithFeedbackCapacitor(), { input: 'VIN.p', output: 'VOUT.p' });
  assert.equal(raw.ok, true);
  assert.ok(
    (raw.assumptions || []).some((line) => /Miller/i.test(line)),
    'this fixture exists to exercise the Miller substitution',
  );
  // CGD's own primitive is gone from the solved model, but its symbol is still
  // inside the Miller shunt admittances and therefore inside the equations.
  assert.ok(
    !raw.details.pipeline.exactPrimitives.some((primitive) => primitive.value === 'CGD'),
    'the Miller transform should have removed the capacitor primitive',
  );
  assert.equal(raw.symbolProvenance.CGD?.component, 'CGD');
  assert.equal(raw.symbolProvenance.CGD?.kind, 'capacitor');

  const report = adaptCombinedReport(raw);
  let sawCapacitor = false;
  for (const { title, result } of report.equationEntries || []) {
    if (result.definition) continue;
    const provenance = result.equationProvenance;
    assert.ok(provenance, `${title} has no provenance render`);
    assertEverySymbolResolves(provenance, report.symbolProvenance, title);
    const highlights = provenance.nodes
      .flatMap((node) => componentsOfSymbols(node.symbols, report.symbolProvenance));
    if (highlights.includes('CGD')) sawCapacitor = true;
  }
  assert.ok(sawCapacitor, 'no displayed row highlights the feedback capacitor');
});
