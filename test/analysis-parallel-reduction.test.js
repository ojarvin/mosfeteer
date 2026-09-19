import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSmallSignalV2 } from '../src/core/analysis/engine.js';
import { adaptCombinedReport } from '../src/core/analysis/report-adapter.js';
import { smallSignalGoldenCorpus } from './fixtures/small-signal-golden.js';

function rows(id) {
  const entry = smallSignalGoldenCorpus.find((candidate) => candidate.id === id);
  assert.ok(entry, `missing fixture ${id}`);
  const report = adaptCombinedReport(analyzeSmallSignalV2(entry.build(), {
    input: entry.ports.input, output: entry.ports.output,
  }));
  assert.equal(report.ok, true, report.error || '');
  return { report, text: report.equations.join('\n') };
}

test('a parallel combination drops the branches g_m r_o >> 1 swamps', () => {
  // 1/g_m2 || r_o1 || r_o2 is 1/g_m2 under the selected assumption: the same
  // domination test that drops a subleading term from a sum, applied to the
  // branches of a parallel, where the smallest impedance wins.
  const { report, text } = rows('diode-connected-load');
  assert.match(text, /Z_\{out\}\(0\) = \\frac\{1\}\{g_\{m2\}\}/);
  assert.doesNotMatch(text, /r_\{o1\}|r_\{o2\}/);
  assert.ok(report.assumptions.some((entry) => entry.startsWith('g_m r_o >> 1')));
});

test('a load that collapses to 1/g_m is multiplied into the gain', () => {
  // g_{m1} (1/g_{m2}) says less than the ratio it multiplies out to, so the
  // proven product is not kept for it.
  const { text } = rows('diode-connected-load');
  assert.match(text, /A_v\(0\) = -\\frac\{g_\{m1\}\}\{g_\{m2\}\}/);
});

test('an external resistance is never swamped by that assumption', () => {
  // g_m r_o >> 1 says nothing about g_m R_S, so a follower keeps its R_S
  // branch while its r_o branch goes.
  const { report, text } = rows('nmos-common-drain');
  assert.match(text, /Z_\{out\}\(0\) = \\frac\{R_\{S\}\}\{g_\{m1\} \\, R_\{S\} \+ 1\}/);
  assert.doesNotMatch(text, /r_\{o1\}/);
  assert.ok(report.assumptions.some((entry) => entry.startsWith('g_m r_o >> 1')));
});

test('a product whose factor carries a sum stays factored', () => {
  // g_{m1} (r_{o1} || R_D) is the textbook reading and must not be expanded
  // into one ratio by the rule above.
  const { text } = rows('nmos-common-gate');
  assert.match(text, /A_v\(0\) = g_\{m1\} \\, \\left\(r_\{o1\} \\parallel R_\{D\}\\right\)/);
});
