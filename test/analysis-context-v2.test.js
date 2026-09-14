import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import {
  AC_GROUND,
  collectAcGrounds,
  resolveAnalysisContext,
  resolveMosBulk,
} from '../src/core/analysis/context.js';

function net(circuit, name, ...refs) {
  const result = circuit._createNet(name);
  result.terminals = refs.map((ref) => circuit.resolveTerm(ref));
  return result;
}

function referenceCircuit() {
  const circuit = new Circuit();
  circuit.addComponent('input', { refdes: 'IN', x: 0, y: 0 });
  circuit.addComponent('output', { refdes: 'OUT', x: 400, y: 0 });
  circuit.addComponent('ground', { refdes: 'GND1', x: 0, y: 200 });
  circuit.addComponent('supply', { refdes: 'VDD1', x: 400, y: -200 });
  net(circuit, 'VIN', 'IN.p');
  net(circuit, 'VOUT', 'OUT.p');
  net(circuit, 'VSS', 'GND1.gnd');
  net(circuit, 'VDD', 'VDD1.p');
  return circuit;
}

test('all global DC reference rails resolve to one AC ground', () => {
  const circuit = referenceCircuit();
  const result = resolveAnalysisContext(circuit, { input: 'VIN', output: 'VOUT' });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.acGround, AC_GROUND);
  assert.deepEqual([...result.acGroundIds].sort(), ['N3', 'N4']);
  assert.equal(result.nodeAliases.get('N3'), AC_GROUND);
  assert.equal(result.nodeAliases.get('N4'), AC_GROUND);
  assert.equal(result.referenceNodes.get('VDD'), AC_GROUND);
  assert.equal(result.referenceNodes.get('VSS'), AC_GROUND);
  assert.notEqual(result.input.node, AC_GROUND);
  assert.notEqual(result.output.node, AC_GROUND);
});

test('three-terminal MOS devices use polarity-specific implicit bulk references', () => {
  const circuit = referenceCircuit();
  circuit.addComponent('nmos', { refdes: 'MN', x: 80, y: 0 });
  circuit.addComponent('pmos', { refdes: 'MP', x: 320, y: 0 });
  const result = resolveAnalysisContext(circuit, { input: 'VIN', output: 'VOUT' });
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(result.bulks.get('MN'), {
    ok: true,
    component: 'MN',
    kind: 'implicit',
    reference: 'VSS',
    netId: null,
    node: AC_GROUND,
  });
  assert.deepEqual(result.bulks.get('MP'), {
    ok: true,
    component: 'MP',
    kind: 'implicit',
    reference: 'VDD',
    netId: null,
    node: AC_GROUND,
  });
});

test('moving-source implicit bulk remains a reference, never a source tie', () => {
  const circuit = referenceCircuit();
  const mos = circuit.addComponent('nmos', { refdes: 'M1', x: 80, y: 0 });
  const source = net(circuit, 'SOURCE', 'M1.s');
  const bulk = resolveMosBulk(circuit, mos, new Set());
  assert.equal(bulk.kind, 'implicit');
  assert.equal(bulk.reference, 'VSS');
  assert.equal(bulk.node, AC_GROUND);
  assert.equal(bulk.netId, null);
  assert.notEqual(source.id, bulk.netId);
});

test('four-terminal MOS devices preserve their explicit bulk net', () => {
  const circuit = referenceCircuit();
  const mos = circuit.addComponent('nmosb', { refdes: 'M1', x: 80, y: 0 });
  const body = net(circuit, 'BODY', 'M1.b');
  const result = resolveMosBulk(circuit, mos, new Set());
  assert.equal(result.ok, true);
  assert.equal(result.kind, 'explicit');
  assert.equal(result.netId, body.id);
  assert.equal(result.node, body.id);
  const grounded = resolveMosBulk(circuit, mos, new Set([body.id]));
  assert.equal(grounded.node, AC_GROUND);
  assert.equal(grounded.reference, null);
});

test('context exposes resolved terminal nodes for primitive construction', () => {
  const circuit = referenceCircuit();
  const mos = circuit.addComponent('nmos', { refdes: 'M1', x: 80, y: 0 });
  const drain = net(circuit, 'DRAIN', 'M1.d');
  const source = net(circuit, 'SOURCE', 'M1.s');
  const gate = net(circuit, 'GATE', 'M1.g');
  const result = resolveAnalysisContext(circuit, { input: 'VIN', output: 'VOUT' });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.terminalNodes.get('M1.d'), drain.id);
  assert.equal(result.terminalNodes.get('M1.s'), source.id);
  assert.equal(result.terminalNodes.get('M1.g'), gate.id);
  assert.equal(result.bulks.get('M1').node, AC_GROUND);
  assert.ok(mos);
});

test('invalid and ambiguous analysis ports return diagnostics without guessing', () => {
  const circuit = referenceCircuit();
  const secondInput = circuit.addComponent('input', { refdes: 'IN2', x: 0, y: 80 });
  net(circuit, 'VIN2', 'IN2.p');
  const ambiguous = resolveAnalysisContext(circuit, { output: 'VOUT' });
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.diagnostics.errors[0].code, 'ambiguous-port');
  const invalid = resolveAnalysisContext(circuit, { input: 'NOPE', output: 'VOUT' });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.diagnostics.errors[0].code, 'unknown-net');
  assert.ok(secondInput);
});

test('explicit AC-ground selections join the reference group without assumptions', () => {
  const circuit = referenceCircuit();
  const bias = net(circuit, 'BIAS');
  const result = collectAcGrounds(circuit, [bias.id]);
  assert.equal(result.diagnostics.length, 0);
  assert.ok(result.ids.has(bias.id));
});

test('structured device regions survive context normalization', () => {
  const circuit = referenceCircuit();
  const override = { region: 'triode', source: 'form', gmroLarge: true };
  const result = resolveAnalysisContext(circuit, {
    input: 'VIN', output: 'VOUT', deviceRegions: new Map([['M1', override]]),
  });
  assert.deepEqual(result.deviceRegions.get('M1'), override);
});
