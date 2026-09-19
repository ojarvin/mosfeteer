import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSmallSignalV2 } from '../src/core/analysis/engine.js';
import { adaptCombinedReport } from '../src/core/analysis/report-adapter.js';
import { smallSignalGoldenCorpus } from './fixtures/small-signal-golden.js';

function commonSource() {
  const entry = smallSignalGoldenCorpus.find((candidate) => candidate.id === 'nmos-common-source');
  return { circuit: entry.build(), ports: entry.ports };
}

test('any node can be the input, a supply rail included', () => {
  const { circuit, ports } = commonSource();
  // Nothing about a rail is special: it is a reference until it is the node
  // under test, and then it is driven like any other.
  const report = analyzeSmallSignalV2(circuit, { input: 'VDD', output: ports.output, acGrounds: ['VIN'] });
  assert.equal(report.ok, true, report.error || '');
  assert.equal(report.context.input.name, 'VDD');
  assert.equal(report.context.acGroundIds.has(report.context.input.netId), false, 'the input left the reference set');

  // The supply reaches the output through R_D against r_o, so the gain is that
  // divider -- not zero, which is what grounding the rail would have given.
  const gain = report.equations.find((row) => row.startsWith('A_v(0)'));
  assert.ok(gain && /R_\{D\}/.test(gain) && /r_\{o1\}/.test(gain), gain);
  // And the netlist shows the rail as the live node it now is.
  assert.match(report.smallSignalNetlist, /R_RD V_\{OUT\} V_\{DD\}/);
});

test('the report says which nodes each quantity was taken between', () => {
  const { circuit, ports } = commonSource();
  const report = analyzeSmallSignalV2(circuit, { input: 'VDD', output: ports.output, acGrounds: ['VIN'] });
  assert.deepEqual(report.portDefinitions, [
    { quantity: 'Av', tex: 'A_v = \\frac{V_{OUT}}{V_{DD}}' },
    { quantity: 'Zin', tex: 'Z_{in} = \\frac{V_{DD}}{I_{DD}}' },
    { quantity: 'Zout', tex: 'Z_{out} = \\frac{V_{OUT}}{I_{OUT}}' },
  ]);

  // The GUI shows them as its first row, marked as a definition so nothing
  // tries to trace a device through it.
  const adapted = adaptCombinedReport(report);
  const [first] = adapted.equationEntries;
  assert.equal(first.title, 'Ports');
  assert.equal(first.result.definition, true);
  assert.match(first.result.equation, /A_v = \\frac\{V_\{OUT\}\}\{V_\{DD\}\}/);
});

test('an analysis that would keep no reference says so', () => {
  const { circuit, ports } = commonSource();
  // VSS is this circuit's only reference; taking it as the input leaves none.
  const report = analyzeSmallSignalV2(circuit, { input: 'VSS', output: ports.output });
  assert.equal(report.ok, false);
  assert.match(report.error, /only AC reference|singular/i);
});
