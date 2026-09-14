import { test } from 'node:test';
import assert from 'node:assert/strict';
import { add, formatExpression, integer, multiply, power, rationalFunction, symbol } from '../src/core/analysis/rational.js';
import { applyApproximations } from '../src/core/analysis/approximation.js';
import { buildScalingMetadata, monomialOrder, toApproximationOptions } from '../src/core/analysis/scaling.js';

function mosPrimitives(records) {
  return records.flatMap(({ id, gm, go }) => [
    { kind: 'vccs', device: 'mos', component: id, parameter: gm },
    { kind: 'conductance', device: 'mos', component: id, parameter: go },
  ]);
}

test('proves a cascode dominant product using independent gm/go order', () => {
  const metadata = buildScalingMetadata(mosPrimitives([
    { id: 'M1', gm: 'gm1', go: 'go1' },
    { id: 'M2', gm: 'gm2', go: 'go2' },
  ]), { highIntrinsicGain: true });
  const product = multiply(symbol('gm2'), power(symbol('go1'), -1), power(symbol('go2'), -1));
  assert.deepEqual(metadata.variables.map(({ device }) => device), ['M1', 'M2']);
  assert.deepEqual(monomialOrder(product, metadata).order, [1, 1]);
  const sum = monomialOrder(Object.freeze({ kind: 'add', terms: Object.freeze([product, symbol('R1')]) }), metadata);
  assert.equal(sum.maximal.length, 1);
  assert.deepEqual(sum.terms[sum.maximal[0]].order, [1, 1]);
});

test('does not drop common-source load terms or infer passive load dominance', () => {
  const metadata = buildScalingMetadata(mosPrimitives([{ id: 'M1', gm: 'gm1', go: 'go1' }]), {
    devices: { M1: { highIntrinsicGain: true } },
  });
  const load = add(integer(1), multiply(symbol('gm1'), symbol('RD')));
  const ordered = monomialOrder(load, metadata);
  assert.equal(ordered.maximal.length, 2);
  assert.equal(ordered.order, null);
  assert.equal(ordered.terms.length, 2);
  const mixed = add(symbol('go1'), multiply(symbol('gm1'), symbol('RD')));
  const mixedOrder = monomialOrder(mixed, metadata);
  assert.equal(mixedOrder.maximal.length, 1);
  assert.deepEqual(mixedOrder.terms[mixedOrder.maximal[0]].order, [0]);
  assert.equal(monomialOrder(add(symbol('RD'), symbol('gm1')), metadata).maximal.length, 2);
});

test('excludes ro-infinity devices from intrinsic-gain scaling', () => {
  const metadata = buildScalingMetadata(mosPrimitives([
    { id: 'M1', gm: 'gm1', go: 'go1' },
    { id: 'M2', gm: 'gm2', go: 'go2' },
  ]), {
    highIntrinsicGain: true,
    devices: { M1: { roInfinity: true } },
  });
  assert.deepEqual(metadata.variables.map(({ device }) => device), ['M2']);
  assert.equal(metadata.parameterOrders.has('gm1'), false);
  assert.deepEqual(metadata.scaling, { M2: { gm: 0, go: -1 } });
  assert.deepEqual(toApproximationOptions(metadata).devices.M2, {
    highIntrinsicGain: true,
    gm: 'gm2',
    go: 'go2',
    scaling: { gm: 0, go: -1 },
  });
});

test('orders multiple selected devices deterministically and retains incomparable sums', () => {
  const primitives = mosPrimitives([
    { id: 'M10', gm: 'gm10', go: 'go10' },
    { id: 'M2', gm: 'gm2', go: 'go2' },
  ]);
  const options = { selectedDevices: ['M2', 'M10'] };
  const first = buildScalingMetadata(primitives, options);
  const second = buildScalingMetadata([...primitives].reverse(), options);
  assert.deepEqual(first.variables, second.variables);
  assert.deepEqual(first.variables.map(({ device }) => device), ['M10', 'M2']);
  assert.deepEqual(monomialOrder(add(symbol('gm10'), symbol('gm2')), first).maximal, [0, 1]);
  assert.deepEqual(monomialOrder(multiply(symbol('go10'), symbol('go2')), first).order, [-1, -1]);
});

test('does not select unrequested finite-go devices by default', () => {
  const metadata = buildScalingMetadata(mosPrimitives([{ id: 'M1', gm: 'gm1', go: 'go1' }]));
  assert.deepEqual(metadata.variables, []);
  assert.deepEqual(metadata.scaling, {});
});

test('exposes a compatibility projection accepted by approximation.js', () => {
  const metadata = buildScalingMetadata(mosPrimitives([{ id: 'M1', gm: 'gm1', go: 'go1' }]), {
    highIntrinsicGain: true,
  });
  const exact = rationalFunction(add(integer(1), multiply(symbol('gm1'), power(symbol('go1'), -1))));
  const reduced = applyApproximations(exact, toApproximationOptions(metadata));
  assert.equal(formatExpression(reduced.selected.numerator), 'gm1');
  assert.equal(formatExpression(reduced.selected.denominator), 'go1');
  assert.deepEqual(reduced.assumptions, ['g_m r_o >> 1 (M1)']);
});
