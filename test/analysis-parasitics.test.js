import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { analyzeSmallSignalV2 } from '../src/core/analysis/engine.js';
import { smallSignalSchematic } from '../src/core/analysis/model-schematic.js';

function net(circuit, name, ...refs) {
  const result = circuit._createNet(name);
  result.terminals = refs.map((ref) => circuit.resolveTerm(ref));
  return result;
}

/** One common-source stage, no drawn capacitors at all. */
function stage() {
  const circuit = new Circuit();
  circuit.addComponent('input', { refdes: 'VIN', x: -240, y: 0 });
  circuit.addComponent('output', { refdes: 'VOUT', x: 240, y: 0 });
  circuit.addComponent('nmos', { refdes: 'M1', x: 0, y: 0 });
  circuit.addComponent('resistor', { refdes: 'RD', x: 0, y: -160 });
  circuit.addComponent('ground', { refdes: 'GND', x: 160, y: 160 });
  circuit.addComponent('supply', { refdes: 'VDD', x: 160, y: -240 });
  net(circuit, 'VIN', 'VIN.p', 'M1.g');
  net(circuit, 'VOUT', 'M1.d', 'RD.a', 'VOUT.p');
  net(circuit, 'VSS', 'M1.s', 'GND.gnd');
  net(circuit, 'VDD', 'RD.b', 'VDD.p');
  return circuit;
}

function primitiveIds(report) {
  return (report.details.pipeline.conversion?.primitives || report.details.pipeline.selected).map((entry) => String(entry.id));
}

function analyze(circuit, options = {}) {
  const report = analyzeSmallSignalV2(circuit, { input: 'VIN', output: 'VOUT', ...options });
  assert.equal(report.ok, true, report.error || '');
  return report;
}

test('device capacitances are opt-in and off by default', () => {
  const plain = analyze(stage());
  assert.equal(primitiveIds(plain).some((id) => /\.(?:cgs|cgd)$/.test(id)), false);
  // With nothing reactive the stage has no poles at all.
  assert.equal(plain.poles.length, 0);

  const withCaps = analyze(stage(), { parasitics: true });
  const ids = primitiveIds(withCaps);
  assert.ok(ids.includes('M1.cgs'));
  assert.ok(ids.includes('M1.cgd'));
  assert.ok(withCaps.poles.length >= 1, 'the gate capacitances give the stage a pole');
  // C_gd bridges gate and drain, so the Miller transform finds it by itself.
  assert.ok(withCaps.assumptions.some((entry) => entry.startsWith('Miller approximation')));
});

test('a device capacitance spans the terminals it belongs to', () => {
  const circuit = stage();
  const report = analyze(circuit, { parasitics: true });
  const primitives = report.details.pipeline.conversion.primitives;
  const gate = circuit.netOfTerminal('M1.g').id;
  const drain = circuit.netOfTerminal('M1.d').id;
  const cgs = primitives.find((entry) => entry.id === 'M1.cgs');
  const cgd = primitives.find((entry) => entry.id === 'M1.cgd');
  assert.equal(cgs.terminals.a, gate);
  assert.equal(cgs.terminals.b, '@AC_GROUND', 'the source is the AC reference here');
  assert.equal(cgd.terminals.a, gate);
  assert.equal(cgd.terminals.b, drain);
  assert.equal(cgs.value, 'Cgs1');
  assert.equal(cgd.value, 'Cgd1');
  // The symbols resolve back to their device, so a term in an equation can
  // still point at M1.
  assert.equal(report.symbolProvenance.Cgd1.component, 'M1');
});

test('a device attribute overrides the request in both directions', () => {
  const opted = stage();
  opted.setComponentAnalysis('M1', { parasitics: 'include' });
  assert.ok(primitiveIds(analyze(opted)).includes('M1.cgs'), 'included without the global option');

  const excluded = stage();
  excluded.setComponentAnalysis('M1', { parasitics: 'omit' });
  assert.equal(primitiveIds(analyze(excluded, { parasitics: true })).includes('M1.cgs'), false);

  // The attribute survives a round trip and is refused where it means nothing.
  const reloaded = Circuit.fromJSON(JSON.parse(JSON.stringify(opted.toJSON())));
  assert.equal(reloaded.getComponent('M1').analysis.parasitics, 'include');
  assert.throws(() => opted.setComponentAnalysis('RD', { parasitics: 'include' }), /only to MOS/);
});

test('the drawn model shows the capacitances it solved with', () => {
  const circuit = stage();
  const report = analyze(circuit, { parasitics: true });
  const model = smallSignalSchematic(report, { circuit });
  assert.equal(model.ok, true, model.error || '');
  const labels = [...model.circuit.labels.values()].map((label) => label.text);
  assert.ok(labels.includes('C_{gs1}'), labels.join(' '));
});
