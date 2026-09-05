import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { placeCircuit, tryPlaceCircuit } from '../src/core/placement.js';
import { GRID, onGrid } from '../src/core/grid.js';
import { rectsOverlap } from '../src/core/geometry.js';

const fixture = (name) => JSON.parse(readFileSync(`fixtures/circuit-spec/${name}.json`, 'utf8'));

function assertPlacementGeometry(result) {
  assert.equal(result.ok, true, JSON.stringify(result.report));
  for (const placement of result.placements) {
    assert.ok(onGrid(placement.transform.x) && onGrid(placement.transform.y));
    assert.ok(placement.terminals.every((point) => onGrid(point.x) && onGrid(point.y)));
  }
  for (let i = 0; i < result.placements.length; i++) for (let j = i + 1; j < result.placements.length; j++) {
    assert.equal(rectsOverlap(result.placements[i].bbox, result.placements[j].bbox), false);
  }
}

test('places every supported analog fixture on the grid without bbox overlap', () => {
  for (const name of ['5t-ota', 'common-source', 'current-mirror', 'differential-pair', 'rc-filter', 'resistor-divider']) {
    assertPlacementGeometry(placeCircuit(fixture(name)));
  }
});

test('ports face outward and supply/ground nets receive top/bottom rails', () => {
  const valid = placeCircuit({
    version: 1,
    motif: 'ports',
    components: [{ id: 'R1', type: 'resistor' }, { id: 'R2', type: 'resistor' }],
    nets: [
      { id: 'vin', name: 'VIN', terminals: [{ component: 'R1', terminal: 'a' }] },
      { id: 'vdd', name: 'VDD', terminals: [{ component: 'R1', terminal: 'b' }] },
      { id: 'gnd', name: 'GND', terminals: [{ component: 'R2', terminal: 'b' }] },
    ],
    ports: [{ id: 'IN', type: 'input', net: 'vin' }, { id: 'OUT', type: 'output', net: 'vdd' }],
  });
  assert.equal(valid.ok, true);
  assert.ok(valid.ports.find((port) => port.id === 'IN').transform.x < valid.placements[0].bbox.x);
  assert.ok(valid.ports.find((port) => port.id === 'OUT').transform.x > valid.placements.at(-1).bbox.x);
  assert.deepEqual(valid.rails.map(({ side }) => side), ['top', 'bottom']);
  assert.ok(valid.rails.every((rail) => onGrid(rail.y)));
});

test('matched pairs are mirrored around a grid-aligned center', () => {
  const result = placeCircuit(fixture('differential-pair'));
  const left = result.placements.find((item) => item.id === 'M1');
  const right = result.placements.find((item) => item.id === 'M2');
  assert.equal(left.transform.mirrorX, false);
  assert.equal(right.transform.mirrorX, true);
  assert.equal(left.transform.y, right.transform.y);
  assert.equal((left.transform.x + right.transform.x) / 2 % GRID, 0);
  assert.equal(left.bbox.w, right.bbox.w);
});

test('stack row constraints set the stack base while preserving coincidence', () => {
  const result = placeCircuit({
    version: 1,
    motif: 'stack-rows',
    components: [{ id: 'M1', type: 'nmos' }, { id: 'M2', type: 'nmos' }],
    nets: [{ id: 'shared', terminals: [{ component: 'M1', terminal: 's' }, { component: 'M2', terminal: 'd' }] }],
    constraints: { columns: [{ members: ['M1', 'M2'] }], rows: [{ members: ['M2'], y: 480 }] },
  });
  assert.equal(result.ok, true, JSON.stringify(result.report));
  assert.equal(result.placements.find((item) => item.id === 'M2').transform.y, 480);
  const m1 = result.placements.find((item) => item.id === 'M1');
  const m2 = result.placements.find((item) => item.id === 'M2');
  const source = m1.terminals.find((point) => point.name === 's');
  const drain = m2.terminals.find((point) => point.name === 'd');
  assert.deepEqual({ x: source.x, y: source.y }, { x: drain.x, y: drain.y });
});

test('conflicting stack row constraints are rejected', () => {
  const result = placeCircuit({
    version: 1,
    motif: 'stack-conflict',
    components: [{ id: 'M1', type: 'nmos' }, { id: 'M2', type: 'nmos' }],
    nets: [{ id: 'shared', terminals: [{ component: 'M1', terminal: 's' }, { component: 'M2', terminal: 'd' }] }],
    constraints: { columns: [{ members: ['M1', 'M2'] }], rows: [{ members: ['M1'], y: 320 }, { members: ['M2'], y: 520 }] },
  });
  assert.equal(result.ok, false);
  assert.match(result.report.errors[0], /conflicting row constraints/);
});

test('column constraints place a transistor stack with coincident terminals', () => {
  const result = placeCircuit({
    version: 1,
    motif: 'stack',
    components: [{ id: 'M1', type: 'nmos' }, { id: 'M2', type: 'nmos' }],
    nets: [
      { id: 'shared', terminals: [{ component: 'M1', terminal: 's' }, { component: 'M2', terminal: 'd' }] },
      { id: 'g1', terminals: [{ component: 'M1', terminal: 'g' }] },
      { id: 'g2', terminals: [{ component: 'M2', terminal: 'g' }] },
    ],
    constraints: { columns: [{ members: ['M1', 'M2'] }] },
  });
  const m1 = result.placements.find((item) => item.id === 'M1');
  const m2 = result.placements.find((item) => item.id === 'M2');
  const source = m1.terminals.find((point) => point.name === 's');
  const drain = m2.terminals.find((point) => point.name === 'd');
  assert.deepEqual({ x: source.x, y: source.y }, { x: drain.x, y: drain.y });
});

test('constraint metadata is retained and deterministic placement repeats exactly', () => {
  const input = fixture('5t-ota');
  input.constraints = {
    hard: ['preserve-feedback'],
    soft: ['prefer-symmetry'],
    corridors: [{ id: 'feedback', kind: 'feedback', x: 0, y: 0, w: 40, h: 40 }],
  };
  const first = placeCircuit(input);
  const second = placeCircuit(JSON.parse(JSON.stringify(input)));
  assert.deepEqual(first, second);
  assert.deepEqual(first.report.deferredConstraints, ['preserve-feedback', 'prefer-symmetry']);
  assert.equal(first.corridors[0].id, 'feedback');
});

test('singleton columns reserve an implicit placement block', () => {
  const result = placeCircuit({
    version: 1,
    motif: 'singleton-column',
    components: [{ id: 'R1', type: 'resistor' }, { id: 'R2', type: 'resistor' }],
    nets: [{ id: 'n', terminals: [{ component: 'R1', terminal: 'a' }] }],
    constraints: { columns: [{ members: ['R1'] }] },
  });
  assert.equal(result.ok, true, JSON.stringify(result.report));
  assert.notEqual(result.placements.find((item) => item.id === 'R1').transform.x, result.placements.find((item) => item.id === 'R2').transform.x);
});

test('named and explicit group membership conflicts are rejected', () => {
  const result = placeCircuit({
    version: 1,
    motif: 'named-group-conflict',
    components: [{ id: 'R1', type: 'resistor', group: 'pair' }, { id: 'R2', type: 'resistor', group: 'pair' }, { id: 'R3', type: 'resistor' }],
    nets: [{ id: 'n', terminals: [{ component: 'R1', terminal: 'a' }] }],
    constraints: { groups: [{ members: ['R1', 'R3'] }] },
  });
  assert.equal(result.ok, false);
  assert.match(result.report.errors[0], /conflicting named and explicit group/);
});

test('group and column membership conflicts are rejected', () => {
  const result = placeCircuit({
    version: 1,
    motif: 'group-column-conflict',
    components: [{ id: 'R1', type: 'resistor' }, { id: 'R2', type: 'resistor' }, { id: 'R3', type: 'resistor' }],
    nets: [{ id: 'n', terminals: [{ component: 'R1', terminal: 'a' }] }],
    constraints: { groups: [{ members: ['R1', 'R2'] }], columns: [{ members: ['R2', 'R3'] }] },
  });
  assert.equal(result.ok, false);
  assert.match(result.report.errors[0], /overlapping group constraints for R2/);
});

test('overlapping group constraints are rejected', () => {
  const result = placeCircuit({
    version: 1,
    motif: 'bad-groups',
    components: [{ id: 'R1', type: 'resistor' }, { id: 'R2', type: 'resistor' }, { id: 'R3', type: 'resistor' }],
    nets: [{ id: 'n', terminals: [{ component: 'R1', terminal: 'a' }] }],
    constraints: { groups: [{ members: ['R1', 'R2'] }, { members: ['R2', 'R3'] }] },
  });
  assert.equal(result.ok, false);
  assert.match(result.report.errors[0], /overlapping group constraints for R2/);
});

test('unknown constraint members are rejected', () => {
  const result = placeCircuit({
    version: 1,
    motif: 'bad-members',
    components: [{ id: 'R1', type: 'resistor' }],
    nets: [{ id: 'n', terminals: [{ component: 'R1', terminal: 'a' }] }],
    constraints: { columns: [{ members: ['R1', 'TYPO'] }] },
  });
  assert.equal(result.ok, false);
  assert.match(result.report.errors[0], /unknown component TYPO/);
});

test('invalid row and column ordinals are rejected', () => {
  for (const constraints of [{ rows: [{ members: ['R1'], row: 1.5 }] }, { columns: [{ members: ['R1'], column: 1.5 }] }]) {
    const result = placeCircuit({
      version: 1,
      motif: 'bad-ordinal',
      components: [{ id: 'R1', type: 'resistor' }],
      nets: [{ id: 'n', terminals: [{ component: 'R1', terminal: 'a' }] }],
      constraints,
    });
    assert.equal(result.ok, false);
    assert.match(result.report.errors[0], /ordinal must be an integer/);
  }
});

test('conflicting row constraints for one component are rejected', () => {
  const result = placeCircuit({
    version: 1,
    motif: 'bad-rows',
    components: [{ id: 'R1', type: 'resistor' }],
    nets: [{ id: 'n', terminals: [{ component: 'R1', terminal: 'a' }] }],
    constraints: { rows: [{ members: ['R1'], y: 0 }, { members: ['R1'], y: 80 }] },
  });
  assert.equal(result.ok, false);
  assert.match(result.report.errors[0], /conflicting row constraints for R1/);
});

test('reserved critical corridors reject without changing the input', () => {
  const input = {
    version: 1,
    motif: 'blocked',
    components: [{ id: 'R1', type: 'resistor' }],
    nets: [{ id: 'n', terminals: [{ component: 'R1', terminal: 'a' }] }],
    constraints: { corridors: [{ kind: 'critical', x: 240, y: -40, w: 160, h: 80 }] },
  };
  const before = JSON.stringify(input);
  const result = tryPlaceCircuit(input);
  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(input), before);
  assert.match(result.report.errors[0], /reserved critical corridor/);
});
