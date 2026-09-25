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
  // Each impedance carries the condition it holds under, on a tall bar.
  assert.deepEqual(report.portDefinitions, [
    { quantity: 'Av', tex: 'A_v = \\frac{V_{OUT}}{V_{DD}}' },
    { quantity: 'Zin', tex: 'Z_{in} = \\frac{V_{DD}}{I_{DD}} \\Big\\vert_{I_{OUT} = 0}' },
    { quantity: 'Zout', tex: 'Z_{out} = \\frac{V_{OUT}}{I_{OUT}} \\Big\\vert_{V_{DD} = 0}' },
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

function corpusCircuit(id) {
  const entry = smallSignalGoldenCorpus.find((candidate) => candidate.id === id);
  return { circuit: entry.build(), ports: entry.ports };
}

function dcRows(report) {
  return Object.fromEntries(report.equationEntries.map(({ title, result }) => [title, result.equation]));
}

test('current inputs and shorted current outputs follow from the same two-port solve', () => {
  // R1 from input to output, R2 from output to ground: a bilateral network,
  // so the shorted output also changes the current the input draws.
  const { circuit, ports } = corpusCircuit('passive-divider');
  const report = adaptCombinedReport(analyzeSmallSignalV2(circuit, { ...ports, transferFunctions: ['Zm', 'Gm', 'Ai'] }));
  assert.equal(report.complete, true, report.error || '');
  const rows = dcRows(report);
  assert.equal(rows['DC transimpedance'], 'Z_m(0) = R_{2}');
  // The output current flows into the output node, as Z_out's test current.
  assert.equal(rows['DC transconductance'], 'G_m(0) = -\\frac{1}{R_{1}}');
  assert.equal(rows['DC current gain'], 'A_i(0) = -1');
  assert.equal(rows['DC voltage gain'], undefined, 'an unselected A_v is not shown');
  assert.deepEqual(report.portDefinitions.map(({ quantity }) => quantity), ['Zm', 'Gm', 'Ai', 'Zin', 'Zout']);
  assert.match(rows.Ports, /G_m = \\frac\{I_\{OUT\}\}\{V_\{IN\}\} \\Big\\vert_\{V_\{OUT\} = 0\}/);
});

test('a common-source stage has G_m = g_m, so A_v = -G_m Z_out', () => {
  const { circuit, ports } = corpusCircuit('nmos-common-source');
  const report = adaptCombinedReport(analyzeSmallSignalV2(circuit, { ...ports, transferFunctions: ['Av', 'Gm'] }));
  const rows = dcRows(report);
  assert.equal(rows['DC transconductance'], 'G_m(0) = g_{m1}');
  assert.match(rows['DC voltage gain'], /^A_v\(0\) = -g_\{m1\}/);
});

test('each transfer function reports its own poles, and none leaves only the impedances', () => {
  const { circuit, ports } = corpusCircuit('rlc-first-order');
  const both = adaptCombinedReport(analyzeSmallSignalV2(circuit, { ...ports, transferFunctions: ['Av', 'Zm'] }));
  const rows = dcRows(both);
  assert.equal(rows['Poles (voltage gain)'], 'p_{0} = -\\frac{1}{C_{1} \\, R_{1}}');
  // A current drive leaves the capacitor as the only load: a pole at s = 0.
  assert.equal(rows['Poles (transimpedance)'], 'p_{0} = 0');
  assert.equal(rows['AC transimpedance'], 'Z_m(s) = \\frac{1}{s \\, C_{1}}');

  const none = adaptCombinedReport(analyzeSmallSignalV2(circuit, { ...ports, transferFunctions: [] }));
  assert.equal(none.complete, true);
  assert.deepEqual(none.equationOrder, ['Ports', 'AC input impedance', 'DC input impedance', 'AC output impedance', 'DC output impedance']);
});
