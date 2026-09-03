import { test } from 'node:test';
import assert from 'node:assert/strict';
import { completeSelectedNetIds, selectedSetMoveSource } from '../src/web/selection.js';

const components = new Map([
  ['R1', { type: 'resistor' }],
  ['R2', { type: 'resistor' }],
  ['J1', { type: 'solder' }],
]);

const wire = (id = 'N1') => ({ net: { id }, branch: 0, seg: 1 });

function selection(overrides = {}) {
  return {
    selectedRefs: new Set(['R1', 'R2']),
    components,
    selectedWireKeys: new Set(),
    selectedNetIds: new Set(),
    touchedNetIds: new Set(),
    selectedLabelIds: new Set(),
    ...overrides,
  };
}

test('selected component set owns a move regardless of component hit', () => {
  assert.equal(selectedSetMoveSource(selection({ componentRef: 'R2' })), 'R2');
});

test('wire hit in a selected net confirms the whole component-set move', () => {
  assert.equal(selectedSetMoveSource(selection({ wire: wire(), selectedNetIds: new Set(['N1']) })), 'R1');
});

test('wire hit in a touched net confirms the whole connected move', () => {
  assert.equal(selectedSetMoveSource(selection({ wire: wire(), touchedNetIds: new Set(['N1']) })), 'R1');
});

test('selected annotation hit confirms the whole component-set move', () => {
  assert.equal(selectedSetMoveSource(selection({ label: { id: 'L1' }, selectedLabelIds: new Set(['L1']) })), 'R1');
});

test('unselected wire does not hijack a component-set move', () => {
  assert.equal(selectedSetMoveSource(selection({ wire: wire('N2') })), null);
});

test('automatic solder selection does not hijack a wire-only move', () => {
  assert.equal(selectedSetMoveSource(selection({
    selectedRefs: new Set(['J1']),
    wire: wire('N1'),
    selectedNetIds: new Set(['N1']),
  })), null);
});

test('complete selected-net helper accepts terminal-less nets', () => {
  const nets = new Map([
    ['N1', { terminals: [] }],
    ['N2', { terminals: [{ comp: 'R1' }, { comp: 'R2' }] }],
    ['N3', { terminals: [{ comp: 'R1' }, { comp: 'R3' }] }],
  ]);
  assert.deepEqual(
    completeSelectedNetIds({
      selectedNetIds: new Set(['N1', 'N2', 'N3']),
      nets,
      selectedRefs: ['R1', 'R2'],
    }),
    new Set(['N1', 'N2']),
  );
});
