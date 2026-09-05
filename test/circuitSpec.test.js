import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Circuit } from '../src/core/model.js';
import { CircuitSpecError, candidateScore, expandCircuitSpec, generateCircuit, normalizeCircuitSpec, SUPPORTED_TEMPLATES } from '../src/core/circuitSpec.js';

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

test('normalization validates open terminals, ports, and physical net identity', () => {
  const spec = normalizeCircuitSpec({
    version: 1,
    motif: 'topology',
    components: [{ id: 'R2', refdes: 'X2', type: 'resistor' }, { id: 'R1', refdes: 'X1', type: 'resistor' }],
    nets: [
      { id: 'z', name: 'SAME', terminals: [{ component: 'R1', terminal: 'a' }] },
      { id: 'a', name: ' SAME ', terminals: [{ component: 'R2', terminal: 'a' }] },
    ],
    openTerminals: [{ component: 'R1', terminal: 'b' }],
    ports: [{ id: 'in', net: 'a', direction: 'input' }],
  });
  assert.deepEqual(spec.components.map((c) => c.id), ['R1', 'R2']);
  assert.deepEqual(spec.nets.map((n) => n.id), ['a', 'z']);
  assert.equal(spec.nets[0].name, 'SAME');
  assert.deepEqual(spec.openTerminals, [{ component: 'R1', terminal: 'b' }]);
  assert.equal(spec.ports[0].net, 'a');
});

test('normalization rejects invalid ownership and contradictory hard constraints', () => {
  const base = { version: 1, motif: 'topology', components: [{ id: 'R1', type: 'resistor' }], nets: [{ id: 'n', terminals: [{ component: 'R1', terminal: 'a' }] }] };
  assert.throws(() => normalizeCircuitSpec({ ...base, openTerminals: [{ component: 'R1', terminal: 'a' }] }), CircuitSpecError);
  assert.throws(() => normalizeCircuitSpec({ ...base, ports: [{ id: 'p', net: 'missing' }] }), CircuitSpecError);
  assert.throws(() => normalizeCircuitSpec({ ...base, openTerminals: [{ component: 'R1', terminal: 'b' }], constraints: { hard: ['no-open-terminals'] } }), CircuitSpecError);
  assert.throws(() => normalizeCircuitSpec({ ...base, components: [{ id: 'R1', refdes: 'X', type: 'resistor' }, { id: 'R2', refdes: 'X', type: 'resistor' }] }), CircuitSpecError);
});

test('fixture-backed templates expand into explicit topology', () => {
  assert.deepEqual(SUPPORTED_TEMPLATES, ['5t-ota', 'common-source', 'current-mirror', 'differential-pair', 'rc-filter', 'resistor-divider']);
  const expanded = expandCircuitSpec({ version: 1, motif: 'resistor-divider', values: { R1: '10k' } });
  assert.equal(expanded.components.length, 2);
  assert.equal(expanded.components[0].value, '10k');
  assert.equal(expanded.nets.find((n) => n.id === 'vout').terminals.length, 2);
  assert.throws(() => expandCircuitSpec({ version: 1, motif: 'unknown' }), CircuitSpecError);
});

test('generateCircuit is deterministic, explicit, and transactional', () => {
  const live = new Circuit();
  live.addComponent('resistor', { refdes: 'R9', x: 400, y: 400 });
  const before = JSON.stringify(live.toJSON());
  const input = JSON.parse(readFileSync(join(fixtureDir, 'rc-filter.json'), 'utf8'));
  const first = generateCircuit(input);
  const second = generateCircuit(input);
  assert.deepEqual(first.spec, second.spec);
  assert.deepEqual(first.topology, second.topology);
  assert.equal(first.circuit.nets.get('vout').route, null);
  assert.equal(first.circuit.nets.get('vout').branches, null);
  assert.equal(first.circuit.components.get('R1').transform.x, 0);
  assert.deepEqual(first.circuit.nets.get('vout').terminals, [{ comp: 'C1', term: 'a' }, { comp: 'R1', term: 'b' }]);
  assert.deepEqual(generateCircuit(live, input).spec, first.spec);
  assert.equal(JSON.stringify(live.toJSON()), before);
  assert.throws(() => generateCircuit(live, { ...input, nets: [{ id: 'bad', terminals: [{ component: 'R1', terminal: 'wat' }] }] }), CircuitSpecError);
  assert.equal(JSON.stringify(live.toJSON()), before);
});
