import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { routeCircuit } from '../src/core/routing.js';
import { generateCircuit } from '../src/core/circuitSpec.js';
import { placeCircuit } from '../src/core/placement.js';
import { Circuit } from '../src/core/model.js';

const fixture = (name) => JSON.parse(readFileSync(`fixtures/circuit-spec/${name}.json`, 'utf8'));

function orthogonal(state) {
  return state.nets.flatMap((net) => net.branches || (net.route ? [net.route] : [])).every((path) =>
    path.every((point, index) => index === 0 || point.x === path[index - 1].x || point.y === path[index - 1].y));
}

test('routing a generated topology uses computed placement', () => {
  const result = routeCircuit(generateCircuit(fixture('resistor-divider')));
  assert.equal(result.ok, true, JSON.stringify(result.report));
});

test('Phase 3 materializes complete managed topology with real multi-terminal junctions', () => {
  const result = routeCircuit(fixture('current-mirror'));
  assert.equal(result.ok, true, JSON.stringify(result.report));
  assert.ok(result.state.nets.every((net) => net.terminals.length < 2 || net.branches?.length || net.route?.length));
  assert.equal(orthogonal(result.state), true);
  assert.ok(result.state.components.some((component) => component.type === 'solder'));
  assert.equal(result.metrics.unreachableNets.length, 0);
});

test('routing keeps equal names on distinct physical nets and labels each drawable net', () => {
  const spec = {
    version: 1,
    motif: 'physical-nets',
    components: [
      { id: 'R1', type: 'resistor' }, { id: 'R2', type: 'resistor' },
      { id: 'R3', type: 'resistor' }, { id: 'R4', type: 'resistor' },
    ],
    nets: [
      { id: 'a', name: 'BUS', terminals: [{ component: 'R1', terminal: 'a' }, { component: 'R2', terminal: 'a' }] },
      { id: 'b', name: 'BUS', terminals: [{ component: 'R3', terminal: 'a' }, { component: 'R4', terminal: 'a' }] },
    ],
  };
  const result = routeCircuit(spec);
  assert.equal(result.ok, true, JSON.stringify(result.report));
  assert.equal(result.state.nets.length, 2);
  assert.deepEqual(result.state.labels.filter((label) => label.netId).map((label) => label.netId), ['a', 'b']);
  assert.equal(result.metrics.evaluation.crossNetOverlaps.length, 0);
});

test('routing and score output are deterministic', () => {
  const input = fixture('differential-pair');
  const first = routeCircuit(input);
  const second = routeCircuit(JSON.parse(JSON.stringify(input)));
  assert.equal(first.ok, true);
  assert.deepEqual(first.report, second.report);
  assert.deepEqual(first.metrics.score, second.metrics.score);
  assert.deepEqual(first.state, second.state);
});

test('fixed authored geometry remains distinct and cross-net overlap rejects the candidate', () => {
  const spec = {
    version: 1,
    motif: 'fixed-overlap',
    components: [
      { id: 'R1', type: 'resistor' }, { id: 'R2', type: 'resistor' },
      { id: 'R3', type: 'resistor' }, { id: 'R4', type: 'resistor' },
    ],
    nets: [
      { id: 'a', terminals: [{ component: 'R1', terminal: 'b' }, { component: 'R2', terminal: 'a' }] },
      { id: 'b', terminals: [{ component: 'R3', terminal: 'b' }, { component: 'R4', terminal: 'a' }] },
    ],
  };
  const circuit = Circuit.fromJSON({
    version: 2,
    components: [
      { refdes: 'R1', type: 'resistor', value: '', transform: { x: 0, y: 120, rotation: 0, mirrorX: false, mirrorY: false }, style: {} },
      { refdes: 'R2', type: 'resistor', value: '', transform: { x: 480, y: 120, rotation: 0, mirrorX: false, mirrorY: false }, style: {} },
      { refdes: 'R3', type: 'resistor', value: '', transform: { x: 0, y: 280, rotation: 0, mirrorX: false, mirrorY: false }, style: {} },
      { refdes: 'R4', type: 'resistor', value: '', transform: { x: 480, y: 280, rotation: 0, mirrorX: false, mirrorY: false }, style: {} },
    ],
    nets: [
      { id: 'a', routingMode: 'fixed', terminals: [{ comp: 'R1', term: 'b' }, { comp: 'R2', term: 'a' }], fixedPaths: [{ points: [{ x: 80, y: 120 }, { x: 80, y: 200 }, { x: 400, y: 200 }, { x: 400, y: 120 }], start: 'R1.b', end: 'R2.a' }] },
      { id: 'b', routingMode: 'fixed', terminals: [{ comp: 'R3', term: 'b' }, { comp: 'R4', term: 'a' }], fixedPaths: [{ points: [{ x: 80, y: 280 }, { x: 80, y: 200 }, { x: 400, y: 200 }, { x: 400, y: 280 }], start: 'R3.b', end: 'R4.a' }] },
    ],
    labels: [],
  });
  const before = JSON.stringify(circuit.toJSON());
  const result = routeCircuit({ spec, circuit });
  assert.equal(result.ok, false);
  assert.ok(result.report.errors.some((error) => error.includes('overlap')));
  assert.equal(JSON.stringify(circuit.toJSON()), before);
});

test('invalid placed candidates fail atomically and respect the repair bound', () => {
  const spec = fixture('rc-filter');
  const placement = placeCircuit(spec);
  const bad = structuredClone(placement);
  const before = JSON.stringify(placement);
  bad.placements[1].transform = { ...bad.placements[0].transform };
  const result = routeCircuit({ spec: bad.spec, ...bad }, { maxAttempts: 1 });
  assert.equal(result.ok, false);
  assert.equal(result.report.attempts, 1);
  assert.ok(result.report.errors.length > 0);
  assert.equal(JSON.stringify(placement), before);
  assert.equal(JSON.stringify(spec), JSON.stringify(fixture('rc-filter')));
});
