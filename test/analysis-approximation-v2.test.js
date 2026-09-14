import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  add,
  formatExpression,
  integer,
  multiply,
  power,
  rationalFunction,
  symbol,
} from '../src/core/analysis/rational.js';
import { applyApproximations } from '../src/core/analysis/approximation.js';

const s = symbol('s');

function text(result) {
  return `${formatExpression(result.selected.numerator)} / ${formatExpression(result.selected.denominator)}`;
}

test('body-effect substitution is pure and reports only a changed assumption', () => {
  const exact = rationalFunction(add(symbol('g_m1'), multiply(symbol('g_mb1'), symbol('v_bs1'))));
  const result = applyApproximations(exact, {
    parameters: { M1: { gmb: 'g_mb1', gm: 'g_m1' } },
    global: { gmb0: true },
  });
  assert.equal(text(result), 'g_m1 / 1');
  assert.equal(formatExpression(exact.numerator), 'g_mb1*v_bs1 + g_m1');
  assert.deepEqual(result.assumptions, ['g_mb = 0 (M1)']);
  assert.equal(result.changed, true);
});

test('per-device ro infinity wins over high intrinsic gain', () => {
  const exact = rationalFunction(add(integer(1), multiply(symbol('g_m1'), symbol('r_o1'))));
  const result = applyApproximations(exact, {
    parameters: { M1: { go: 'g_o1', gm: 'g_m1', ro: 'r_o1' } },
    devices: { M1: { roInfinity: true, highIntrinsicGain: true, scaling: { gm: 1, ro: 0 } } },
  });
  assert.equal(text(result), 'g_m1*r_o1 + 1 / 1');
  assert.deepEqual(result.assumptions, []);
  assert.equal(result.changed, false);
});

test('global ro infinity substitutes selected go symbols and suppresses high-gain listing', () => {
  const exact = rationalFunction(add(symbol('g_o1'), symbol('g_o2')));
  const result = applyApproximations(exact, {
    parameters: { M1: { go: 'g_o1', gm: 'g_m1' }, M2: { go: 'g_o2', gm: 'g_m2' } },
    global: { roInfinity: true, highIntrinsicGain: true },
  });
  assert.equal(formatExpression(result.selected.numerator), '0');
  assert.deepEqual(result.assumptions, ['r_o -> infinity (M1)', 'r_o -> infinity (M2)']);
});

test('formal scaling reduces a cascode-like dominant product without topology names', () => {
  const exact = rationalFunction(add(
    multiply(symbol('g_m2'), symbol('r_o1'), symbol('r_o2')),
    symbol('r_o1'),
    symbol('r_o2'),
    integer(1),
  ));
  const result = applyApproximations(exact, {
    parameters: { M2: { gm: 'g_m2', ro: 'r_o2' } },
    devices: { M2: { highIntrinsicGain: true, scaling: { gm: 1 } } },
  });
  assert.equal(text(result), 'g_m2*r_o1*r_o2 / 1');
  assert.deepEqual(result.assumptions, ['g_m r_o >> 1 (M2)']);
});

test('high-gain assumption stays exact without explicit scaling proof', () => {
  const exact = rationalFunction(add(integer(1), multiply(symbol('g_m1'), symbol('r_o1'))));
  const result = applyApproximations(exact, {
    parameters: { M1: { gm: 'g_m1', ro: 'r_o1' } },
    global: { highIntrinsicGain: true },
  });
  assert.equal(result.changed, false);
  assert.deepEqual(result.assumptions, []);
});

test('high-gain attribution stays limited to devices that affect the result', () => {
  const exact = rationalFunction(add(integer(1), multiply(symbol('g_m2'), symbol('r_o2'))));
  const result = applyApproximations(exact, {
    parameters: { M1: { gm: 'g_m1', ro: 'r_o1' }, M2: { gm: 'g_m2', ro: 'r_o2' } },
    devices: {
      M1: { highIntrinsicGain: true, scaling: { gm: 1 } },
      M2: { highIntrinsicGain: true, scaling: { gm: 1 } },
    },
  });
  assert.deepEqual(result.assumptions, ['g_m r_o >> 1 (M2)']);
});

test('dominant-pole reduction is opt-in and keeps constant and s terms', () => {
  const denominator = add(power(s, 2), multiply(integer(3), s), integer(2));
  const exact = rationalFunction(add(s, integer(1)), denominator);
  const unchanged = applyApproximations(exact);
  assert.equal(unchanged.changed, false);
  const result = applyApproximations(exact, { dominantPole: true });
  assert.equal(text(result), 's + 1 / 3*s + 2');
  assert.deepEqual(result.assumptions, ['dominant-pole approximation']);
});
