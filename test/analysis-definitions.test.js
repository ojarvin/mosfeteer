import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSmallSignalV2 } from '../src/core/analysis/engine.js';
import { EQUATION_GROUPS, adaptCombinedReport } from '../src/core/analysis/report-adapter.js';
import { chooseDefinitions, dimensionOf, nameDefinitions } from '../src/core/analysis/definitions.js';
import { stripProvenanceMarkers } from '../src/core/analysis/present.js';
import { add, integer, multiply, power, symbol } from '../src/core/analysis/rational.js';
import { smallSignalGoldenCorpus } from './fixtures/small-signal-golden.js';

const [gm, ro, RS, RD, C, s] = ['gm1', 'ro1', 'RS', 'RD', 'C1', 's'].map(symbol);

function degeneration(options = {}) {
  const entry = smallSignalGoldenCorpus.find(({ id }) => id === 'source-degeneration');
  return adaptCombinedReport(analyzeSmallSignalV2(entry.build(), { ...entry.ports, noise: true }), options);
}

test('dimensions follow the parameter names and reject mixed sums', () => {
  assert.deepEqual(dimensionOf(add(multiply(gm, ro, RS), RD, ro)), [1, 0]);
  assert.deepEqual(dimensionOf(multiply(C, RD)), [0, 1]);
  assert.deepEqual(dimensionOf(multiply(s, C, RD)), [0, 0]);
  assert.equal(dimensionOf(add(gm, RD)), null);
  assert.equal(dimensionOf(symbol('W_{1}')), null);
});

test('one quantity spelled factored and expanded is chosen once, in its shortest form', () => {
  const expanded = add(multiply(gm, ro, RS), RD, ro);
  const factored = add(multiply(add(multiply(gm, RS), integer(1)), add(RD, ro)), multiply(integer(-1), gm, RD, RS));
  const rows = [[multiply(gm, power(expanded, -1))], [multiply(RD, power(factored, -2))]];
  const chosen = chooseDefinitions(rows);
  assert.equal(chosen.length, 1);
  assert.equal(chosen[0].keys.length, 2);
  const [named] = nameDefinitions(chosen);
  assert.equal(named.name, 'Z_{1}');
  assert.equal(named.value, expanded);
});

test('a small sum or one appearing once in a short row stays inline', () => {
  assert.deepEqual(chooseDefinitions([[multiply(gm, power(add(RD, ro), -1))], [add(multiply(gm, RS), integer(1))]]), []);
});

test('names skip spellings a displayed symbol already has', () => {
  const chosen = chooseDefinitions([[power(add(multiply(gm, ro, RS), RD, ro), -1)], [power(add(multiply(gm, ro, RS), RD, ro), -2)]]);
  assert.equal(nameDefinitions(chosen, { takenSymbols: ['Z1'] })[0].name, 'Z_{2}');
});

test('without the option the report keeps every expression whole', () => {
  const report = degeneration();
  assert.equal(report.equationEntries.some(({ group }) => group === 'definitions'), false);
});

test('a sum shared by both output noise rows is named once and defined under Where', () => {
  const report = degeneration({ nameSubexpressions: true });
  const entry = (title) => report.equationEntries.find((candidate) => candidate.title === title);
  assert.match(entry('Output thermal noise').result.equation, /Z_\{1\}\^\{2\}/);
  assert.match(entry('Output flicker noise').result.equation, /Z_\{1\}\^\{2\}/);
  // The exact equation stays whole.
  assert.doesNotMatch(entry('Output thermal noise').result.exactEquation, /Z_\{1\}/);
  const where = entry('Where');
  assert.equal(where.group, 'definitions');
  assert.deepEqual(where.result.lines, ['Z_{1} = g_{m1} \\, r_{o1} \\, R_{S} + R_{D} + r_{o1}']);
  assert.equal(stripProvenanceMarkers(where.result.lineProvenance[0].tex), where.result.lines[0]);
  for (const { result } of report.equationEntries) {
    if (result.equationProvenance) assert.equal(stripProvenanceMarkers(result.equationProvenance.tex), result.equation);
  }
});

test('every entry belongs to a known group, in group order', () => {
  const report = degeneration({ nameSubexpressions: true });
  const order = EQUATION_GROUPS.map(([id]) => id);
  const groups = report.equationEntries.map(({ group }) => group);
  assert.ok(groups.every((group) => order.includes(group)));
  assert.deepEqual(groups, [...groups].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
});
