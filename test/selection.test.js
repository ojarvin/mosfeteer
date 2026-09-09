import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseWireHitCandidate, completeSelectedNetIds, copySelectionParts, copyableLabelPayload, selectedSetMoveSource } from '../src/web/selection.js';

const components = new Map([
  ['R1', { type: 'resistor' }],
  ['R2', { type: 'resistor' }],
  ['J1', { type: 'solder' }],
]);

const wire = (id = 'N1') => ({ net: { id }, branch: 0, seg: 1 });

test('copying a net label does not expand its physical net', () => {
  const label = {
    id: 'SIG_LABEL', kind: 'label', text: 'SIG', align: 'center', owner: null,
    netId: 'N1', anchor: { x: 200, y: 0 }, anchorWorld: () => ({ x: 200, y: 0 }),
    style: { color: '#111' },
  };
  const parts = copySelectionParts({ labels: [label] });
  assert.deepEqual([...parts.refs], []);
  assert.deepEqual([...parts.netIds], []);
  assert.deepEqual(parts.labels, [label]);

  const payload = copyableLabelPayload(label);
  assert.deepEqual(payload, {
    id: 'SIG_LABEL', kind: 'label', parent: null, text: 'SIG', align: 'center',
    x: 200, y: 0, end: null, points: null, style: { color: '#111' },
  });
  assert.equal('netId' in payload, false);
  assert.equal(copyableLabelPayload({ owner: 'R1' }), null);
});

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

const candidate = (id, distance, extra = {}) => ({
  net: { id },
  branch: 0,
  seg: 1,
  ...extra,
  distance,
});

const pick = (candidates, selectedNets = [], diagnosticNets = []) =>
  chooseWireHitCandidate({
    candidates,
    selectedNets: new Set(selectedNets),
    diagnosticNets: new Set(diagnosticNets),
  });

test('nearer wire beats a selected-net preference', () => {
  const near = candidate('N1', 1);
  const far = candidate('N2', 2);
  assert.equal(pick([near, far], ['N2']), near);
});

test('selected net wins an effectively equal-distance overlap', () => {
  const first = candidate('N1', 1);
  const selected = candidate('N2', 1 + 1e-12);
  assert.equal(pick([first, selected], ['N2']), selected);
});

test('one diagnostic net wins an effectively equal-distance overlap', () => {
  const first = candidate('N1', 1);
  const diagnostic = candidate('N2', 1);
  assert.equal(pick([first, diagnostic], [], ['N2']), diagnostic);
});

test('selected net outranks diagnostic preference', () => {
  const selected = candidate('N1', 1);
  const diagnostic = candidate('N2', 1);
  assert.equal(pick([selected, diagnostic], ['N1'], ['N2']), selected);
});

test('stale preferences are ignored', () => {
  const first = candidate('N1', 1);
  const second = candidate('N2', 1);
  assert.equal(pick([first, second], ['missing'], ['also-missing']), first);
});

test('equal-distance fallback preserves candidate iteration order', () => {
  const first = candidate('N1', 1);
  const second = candidate('N2', 1);
  assert.equal(pick([first, second]), first);
});

test('diagnostic preference deduplicates tied segments from one net', () => {
  const first = candidate('N1', 1);
  const diagnosticA = candidate('N2', 1, { seg: 2 });
  const diagnosticB = candidate('N2', 1, { seg: 3 });
  assert.equal(pick([first, diagnosticA, diagnosticB], [], ['N2']), diagnosticA);
});
