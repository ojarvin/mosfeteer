import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { AC_GROUND, resolveAnalysisContext } from '../src/core/analysis/context.js';
import { convertCircuitToPrimitives } from '../src/core/analysis/devices.js';
import { createRationalOps } from '../src/core/analysis/algebra-ops.js';
import { buildExactAnalysisPipeline, toMnaPrimitives } from '../src/core/analysis/pipeline.js';
import { buildMNA } from '../src/core/analysis/mna.js';
import { processResponses } from '../src/core/analysis/response.js';
import { solveMNA } from '../src/core/analysis/solve.js';
import { applyApproximations } from '../src/core/analysis/approximation.js';
import {
  add,
  integer,
  keyOf,
  multiply,
  power,
  rationalFunction,
  symbol,
} from '../src/core/analysis/rational.js';
import { buildSmallSignalGolden } from './fixtures/small-signal-golden.js';

const s = symbol('s');
const one = integer(1);

function net(circuit, name, ...refs) {
  const physicalNet = circuit._createNet(name);
  physicalNet.terminals = refs.map((ref) => circuit.resolveTerm(ref));
  return physicalNet;
}

function symbolicPipeline(fixtureId, options = {}) {
  const ops = createRationalOps({ maxOperations: 100000 });
  const valueOf = (value) => typeof value === 'string' ? ops.symbol(value) : value;
  const fixture = buildSmallSignalGolden(fixtureId);
  let report;
  try {
    report = buildExactAnalysisPipeline(fixture, {
      input: 'VIN.p',
      output: 'VOUT.p',
      ops,
      s: ops.s(),
      valueOf,
      ...options,
    });
  } catch (error) {
    assert.fail(`${fixtureId}: exact symbolic pipeline threw: ${error.message}`);
  }
  assert.equal(report.ok, true, `${fixtureId}: ${report.stage || 'pipeline'}: ${report.error || 'unknown failure'}`);
  const responses = processResponses({
    Av: report.queries.transfer.value,
    Zin: report.queries.inputImpedance.value,
    Zout: report.queries.outputImpedance.value,
  }, { maxOperations: 100000 });
  return { fixture, ops, report, responses };
}

function assertExpression(actual, expected, message = '') {
  assert.equal(keyOf(actual), keyOf(expected), message);
}

function assertRational(actual, expected, message = '') {
  assert.equal(actual?.kind, 'rational', message || 'expected a rational response');
  assertExpression(actual.numerator, expected.numerator, `${message} numerator`);
  assertExpression(actual.denominator, expected.denominator, `${message} denominator`);
}

function sourceFollower() {
  const circuit = new Circuit();
  circuit.addComponent('input', { refdes: 'VIN', x: -400, y: 0 });
  circuit.addComponent('output', { refdes: 'VOUT', x: 400, y: 0 });
  circuit.addComponent('nmosb', { refdes: 'M1', x: 0, y: 0 });
  circuit.addComponent('resistor', { refdes: 'RS', x: 240, y: 240 });
  circuit.addComponent('ground', { refdes: 'GND', x: 480, y: 400 });
  net(circuit, 'VIN', 'VIN.p', 'M1.g');
  net(circuit, 'VOUT', 'VOUT.p', 'M1.s', 'RS.a');
  net(circuit, 'VSS', 'M1.d', 'M1.b', 'RS.b', 'GND.gnd');
  return circuit;
}

function oneInputTransfer(circuit) {
  const context = resolveAnalysisContext(circuit, { input: 'VIN', output: 'VOUT' });
  assert.equal(context.ok, true, context.error || 'source-follower context failed');
  const converted = convertCircuitToPrimitives(circuit, context);
  assert.equal(converted.ok, true, converted.diagnostics.map(({ message }) => message).join('; '));
  const ops = createRationalOps({ maxOperations: 100000 });
  const valueOf = (value) => typeof value === 'string' ? ops.symbol(value) : value;
  const primitives = toMnaPrimitives(converted.primitives, { s: ops.s(), valueOf }, ops);
  const excitation = {
    kind: 'voltage-source',
    id: 'TEST_INPUT',
    name: 'TEST_INPUT',
    terminals: { a: context.input.node, b: AC_GROUND },
    value: ops.one,
  };
  const system = buildMNA([...primitives, excitation], {
    ops,
    ground: AC_GROUND,
    grounds: [...context.acGroundIds],
    nodes: [context.input.node, context.output.node],
  });
  const solution = solveMNA(system, { ops });
  assert.equal(solution.ok, true, solution.error || 'source-follower solve failed');
  return {
    ops,
    transfer: solution.byVariable[0].get(`V(${context.output.node})`),
    primitives,
  };
}

test('derives canonical Av, Zin, Zout, and DC limits for a resistor divider', () => {
  const { responses } = symbolicPipeline('passive-divider');
  const R1 = symbol('R1');
  const R2 = symbol('R2');
  const denominator = add(R1, R2);
  const expected = {
    Av: rationalFunction(R2, denominator),
    Zin: rationalFunction(denominator),
    Zout: rationalFunction(multiply(R1, R2), denominator),
  };
  assertRational(responses.Av.expression, expected.Av, 'divider Av');
  assertRational(responses.Zin.expression, expected.Zin, 'divider Zin');
  assertRational(responses.Zout.expression, expected.Zout, 'divider Zout');
  assertExpression(responses.Av.dc.value, expected.Av.numerator ? multiply(R2, power(denominator, -1)) : one);
  assertExpression(responses.Zin.dc.value, denominator);
  assertExpression(responses.Zout.dc.value, multiply(R1, R2, power(denominator, -1)));
});

test('canonicalizes an RC low-pass transfer and derives its s=0 limit', () => {
  const { responses } = symbolicPipeline('rlc-first-order');
  const R1 = symbol('R1');
  const C1 = symbol('C1');
  const denominator = add(one, multiply(s, R1, C1));
  assertRational(responses.Av.expression, rationalFunction(one, denominator), 'RC Av(s)');
  assert.equal(responses.Av.dc.kind, 'finite');
  assertExpression(responses.Av.dc.value, one, 'RC Av(0)');
  assert.equal(responses.Zin.dc.kind, 'pole');
  assertRational(responses.Zout.expression, rationalFunction(R1, denominator), 'RC Zout(s)');
});

test('reports an RL high-pass origin zero through the production response reducer', () => {
  const circuit = new Circuit();
  circuit.addComponent('input', { refdes: 'VIN', x: -400, y: 0 });
  circuit.addComponent('output', { refdes: 'VOUT', x: 400, y: 0 });
  circuit.addComponent('resistor', { refdes: 'R1', x: 0, y: 0 });
  circuit.addComponent('inductor', { refdes: 'L1', x: 240, y: 160 });
  circuit.addComponent('ground', { refdes: 'GND', x: 480, y: 320 });
  net(circuit, 'VIN', 'VIN.p', 'R1.a');
  net(circuit, 'VOUT', 'VOUT.p', 'R1.b', 'L1.a');
  net(circuit, 'VSS', 'L1.b', 'GND.gnd');

  const ops = createRationalOps({ maxOperations: 100000 });
  const valueOf = (value) => typeof value === 'string' ? ops.symbol(value) : value;
  const report = buildExactAnalysisPipeline(circuit, {
    input: 'VIN', output: 'VOUT', ops, s: ops.s(), valueOf,
  });
  assert.equal(report.ok, true, report.error);
  const response = processResponses({ Av: report.queries.transfer.value }, { maxOperations: 100000 }).Av;
  assert.equal(response.hasFrequency, true);
  assert.equal(response.dc.kind, 'zero');
  assert.equal(response.zeros.length, 1);
  assert.equal(response.zeros[0].index, 0);
  assertExpression(response.zeros[0].root, integer(0), 'RL zero at the origin');
});

test('keeps finite-ro NMOS common-source polarity and output loading exact', () => {
  const { responses } = symbolicPipeline('nmos-common-source');
  const gm1 = symbol('gm1');
  const ro1 = symbol('ro1');
  const RD = symbol('RD');
  const outputDenominator = add(RD, ro1);
  assertRational(responses.Av.expression, rationalFunction(multiply(integer(-1), gm1, RD, ro1), outputDenominator), 'NMOS common-source Av');
  assertRational(responses.Zout.expression, rationalFunction(multiply(RD, ro1), outputDenominator), 'NMOS common-source Zout');
});

test('combines NMOS and PMOS transconductors with the inverter sign', () => {
  const { responses } = symbolicPipeline('cmos-inverter');
  const gm1 = symbol('gm1');
  const gm2 = symbol('gm2');
  const ro1 = symbol('ro1');
  const ro2 = symbol('ro2');
  const denominator = add(ro1, ro2);
  assertRational(
    responses.Av.expression,
    rationalFunction(multiply(integer(-1), ro1, ro2, add(gm1, gm2)), denominator),
    'CMOS inverter Av',
  );
  assertRational(responses.Zout.expression, rationalFunction(multiply(ro1, ro2), denominator), 'CMOS inverter Zout');
});

test('retains source-follower body effect in the exact symbolic transfer', () => {
  const { transfer, ops, primitives } = oneInputTransfer(sourceFollower());
  const gm1 = symbol('gm1');
  const gmb1 = symbol('gmb1');
  const ro1 = symbol('ro1');
  const RS = symbol('RS');
  const expected = rationalFunction(
    multiply(RS, gm1, ro1),
    add(multiply(RS, add(multiply(ro1, add(gm1, gmb1)), one)), ro1),
  );
  assertRational(transfer, expected, 'source-follower Av');
  const gmb = primitives.find(({ id }) => id === 'M1.gmb');
  assert.equal(gmb.control.a, AC_GROUND);
  assert.equal(gmb.control.b, 'N2');
  assert.equal(gmb.metadata.controlExpression, 'gmb1(v_b-v_s)');
  assert.equal(gmb.terminals.a, AC_GROUND);
});

test('applies gmb=0 after solving without changing the source-follower topology', () => {
  const { transfer } = oneInputTransfer(sourceFollower());
  const result = applyApproximations(transfer, {
    parameters: { M1: { gm: 'gm1', gmb: 'gmb1', ro: 'ro1' } },
    global: { gmb0: true },
  });
  const expected = rationalFunction(
    multiply(symbol('RS'), symbol('gm1'), symbol('ro1')),
    add(multiply(symbol('RS'), add(multiply(symbol('gm1'), symbol('ro1')), one)), symbol('ro1')),
  );
  assertRational(result.selected, expected, 'source-follower gmb=0');
  assert.deepEqual(result.assumptions, ['g_mb = 0 (M1)']);
});

test('gives r_o infinity precedence over high-intrinsic-gain reduction', () => {
  const exact = rationalFunction(add(symbol('ro1'), symbol('gmb1'), symbol('gm1')));
  const result = applyApproximations(exact, {
    parameters: { M1: { gm: 'gm1', gmb: 'gmb1', ro: 'ro1' } },
    global: { gmb0: true, roInfinity: true, highIntrinsicGain: true },
  });
  assertRational(result.selected, rationalFunction(symbol('ro1')));
  assert.deepEqual(result.assumptions, ['g_mb = 0 (M1)', 'r_o -> infinity (M1)']);
  assert.equal(result.assumptions.some((entry) => entry.includes('g_m r_o')), false);
});

test('does not let a disconnected reactive island change the selected port solve', () => {
  const { responses, report } = symbolicPipeline('disconnected-reactive-island');
  const ro1 = symbol('ro1');
  const RD = symbol('RD');
  assert.equal(report.coupled.primitives.some(({ component }) => component === 'CISO'), false);
  assertRational(responses.Zout.expression, rationalFunction(multiply(RD, ro1), add(RD, ro1)), 'isolated-island Zout');
});

test('preserves exact identities in the pivot-row cross-coupled topology', () => {
  const { responses } = symbolicPipeline('pivot-cross-coupled-pair');
  const gm1 = symbol('gm1');
  const gm2 = symbol('gm2');
  const ro1 = symbol('ro1');
  const ro2 = symbol('ro2');
  assertRational(responses.Av.expression, rationalFunction(multiply(integer(-1), gm1, ro1)), 'pivot Av');
  assertRational(responses.Zin.expression, rationalFunction(ro2, add(multiply(integer(-1), gm1, gm2, ro1, ro2), one)), 'pivot Zin');
  assertRational(responses.Zout.expression, rationalFunction(ro1), 'pivot Zout');
});
