import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import {
  SMALL_SIGNAL_GOLDEN_SCHEMA_VERSION,
  smallSignalGoldenCorpus,
} from './fixtures/small-signal-golden.js';

const REQUIRED_IDS = [
  'passive-divider',
  'rlc-first-order',
  'rlc-second-order',
  'nmos-common-source',
  'pmos-common-source',
  'nmos-common-gate',
  'pmos-common-gate',
  'nmos-common-drain',
  'pmos-common-drain',
  'source-degeneration',
  'diode-connected-load',
  'cmos-inverter',
  'nmos-cascode',
  'pmos-cascode',
  'current-mirror-load',
  'explicit-bulk-moving-source',
  'disconnected-reactive-island',
  'pivot-cross-coupled-pair',
  'singular-floating',
];

const EXPECTED_KEYS = ['inputImpedance', 'outputImpedance', 'transfer'];

function assertIdentitySet(value, label) {
  assert.ok(value && typeof value === 'object', `${label} must be an object`);
  for (const key of EXPECTED_KEYS) {
    assert.equal(typeof value[key], 'string', `${label}.${key} must be a string`);
    assert.ok(value[key].length > 0, `${label}.${key} must not be empty`);
  }
}

function assertSample(sample, fixtureId, index) {
  assert.ok(sample && typeof sample === 'object', `${fixtureId} sample ${index} must be an object`);
  assert.ok(Number.isFinite(sample.s) && sample.s > 0, `${fixtureId} sample ${index} needs positive s`);
  assert.ok(sample.values && Object.keys(sample.values).length > 0, `${fixtureId} sample ${index} needs values`);
  for (const [name, value] of Object.entries(sample.values)) {
    assert.ok(Number.isFinite(value) && value > 0, `${fixtureId} sample ${index} ${name} must be positive`);
  }
  assert.ok(sample.expected && typeof sample.expected === 'object', `${fixtureId} sample ${index} needs expected values`);
}

test('small-signal golden corpus has a complete stable schema', () => {
  assert.equal(SMALL_SIGNAL_GOLDEN_SCHEMA_VERSION, 1);
  assert.ok(Array.isArray(smallSignalGoldenCorpus));
  assert.deepEqual(smallSignalGoldenCorpus.map(({ id }) => id), REQUIRED_IDS);

  const ids = new Set();
  const categories = new Set();
  for (const fixture of smallSignalGoldenCorpus) {
    assert.match(fixture.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.equal(ids.has(fixture.id), false, `duplicate fixture id ${fixture.id}`);
    ids.add(fixture.id);
    assert.ok(fixture.description.length > 0, `${fixture.id} needs a description`);
    assert.match(fixture.category, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    categories.add(fixture.category);
    assert.equal(typeof fixture.build, 'function', `${fixture.id} needs a builder`);
    assert.deepEqual(Object.keys(fixture.ports).sort(), ['input', 'output']);
    assert.match(fixture.ports.input, /^[A-Z][A-Za-z0-9_]+\.[A-Za-z0-9_]+$/);
    assert.match(fixture.ports.output, /^[A-Z][A-Za-z0-9_]+\.[A-Za-z0-9_]+$/);

    const circuit = fixture.build();
    assert.ok(circuit instanceof Circuit, `${fixture.id} builder must return Circuit`);
    const input = circuit.resolveTerm(fixture.ports.input);
    const output = circuit.resolveTerm(fixture.ports.output);
    assert.ok(input && output, `${fixture.id} ports must resolve`);
    assert.notEqual(circuit.netOfTerminal(fixture.ports.input)?.id, circuit.netOfTerminal(fixture.ports.output)?.id, `${fixture.id} ports must be distinct`);

    assertIdentitySet(fixture.expected.exact, `${fixture.id}.expected.exact`);
    assertIdentitySet(fixture.expected.textbook, `${fixture.id}.expected.textbook`);
    assert.ok(fixture.expected.textbook.defaults && typeof fixture.expected.textbook.defaults === 'object', `${fixture.id} textbook defaults must be documented`);
    assert.ok(fixture.expected.textbook.focus.length > 0, `${fixture.id} textbook focus must be documented`);
    assert.ok(Array.isArray(fixture.expected.variants) && fixture.expected.variants.length > 0, `${fixture.id} needs assumption variants`);
    const variantIds = new Set();
    for (const variant of fixture.expected.variants) {
      assert.match(variant.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `${fixture.id} variant id`);
      assert.equal(variantIds.has(variant.id), false, `${fixture.id} has duplicate variant id ${variant.id}`);
      variantIds.add(variant.id);
      assert.ok(variant.options && typeof variant.options === 'object', `${fixture.id} variant options`);
      assert.ok(variant.result && typeof variant.result === 'object', `${fixture.id} variant result`);
    }
    assert.ok(Array.isArray(fixture.expected.samples) && fixture.expected.samples.length >= 2, `${fixture.id} needs at least two samples`);
    fixture.expected.samples.forEach((sample, index) => assertSample(sample, fixture.id, index));
  }

  assert.ok(categories.has('passive'));
  assert.ok(categories.has('bulk-effect'));
  assert.ok(categories.has('solver-pivot'));
  assert.ok(categories.has('diagnostics'));
});
