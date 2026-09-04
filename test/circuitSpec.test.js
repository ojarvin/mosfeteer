import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Circuit } from '../src/core/model.js';
import { CircuitSpecError, candidateScore, normalizeCircuitSpec } from '../src/core/circuitSpec.js';

const fixtureDir = join(process.cwd(), 'fixtures/circuit-spec');
const fixtures = readdirSync(fixtureDir).filter((name) => name.endsWith('.json')).sort();

test('the initial analog fixture corpus normalizes deterministically', () => {
  assert.deepEqual(fixtures.map((name) => name.replace('.json', '')), [
    '5t-ota', 'common-source', 'current-mirror', 'differential-pair', 'rc-filter', 'resistor-divider',
  ]);
  for (const name of fixtures) {
    const input = JSON.parse(readFileSync(join(fixtureDir, name), 'utf8'));
    const once = normalizeCircuitSpec(input);
    const twice = normalizeCircuitSpec(JSON.parse(JSON.stringify(input)));
    assert.deepEqual(once, twice, name);
    assert.equal(once.version, 1);
  }
});

test('malformed terminal ownership is rejected before circuit mutation', () => {
  const circuit = new Circuit();
  circuit.addComponent('resistor', { refdes: 'R1' });
  const before = JSON.stringify(circuit.toJSON());
  assert.throws(() => normalizeCircuitSpec({
    version: 1,
    motif: 'bad',
    components: [{ id: 'R1', type: 'resistor' }],
    nets: [
      { id: 'a', terminals: [{ component: 'R1', terminal: 'a' }] },
      { id: 'b', terminals: [{ component: 'R1', terminal: 'a' }] },
    ],
  }), CircuitSpecError);
  assert.equal(JSON.stringify(circuit.toJSON()), before);
});

test('malformed optional metadata is rejected', () => {
  const base = {
    version: 1,
    motif: 'bad',
    components: [{ id: 'R1', type: 'resistor' }],
    nets: [{ id: 'a', terminals: [{ component: 'R1', terminal: 'a' }] }],
  };
  assert.throws(() => normalizeCircuitSpec({ ...base, nets: [{ ...base.nets[0], name: null }] }), CircuitSpecError);
  assert.throws(() => normalizeCircuitSpec({ ...base, constraints: [] }), CircuitSpecError);
  assert.throws(() => normalizeCircuitSpec({ ...base, constraints: 'hard' }), CircuitSpecError);
  assert.deepEqual(normalizeCircuitSpec({ ...base, constraints: null }), {
    ...normalizeCircuitSpec(base),
    constraints: { hard: [], soft: [] },
  });
});

test('normalization uses code-unit ordering for identifiers', () => {
  const spec = normalizeCircuitSpec({
    version: 1,
    motif: 'ordering',
    components: [{ id: 'a', type: 'resistor' }, { id: 'A', type: 'resistor' }],
    nets: [],
  });
  assert.deepEqual(spec.components.map(({ id }) => id), ['A', 'a']);
});

test('candidate score has one canonical lexicographic shape', () => {
  assert.deepEqual(candidateScore({ hardViolations: 1, turns: 2, length: 40 }), [1, 0, 0, 0, 0, 0, 2, 40]);
});
