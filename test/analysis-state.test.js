import test from 'node:test';
import assert from 'node:assert/strict';
import { analysisFormDefaults, analysisFormStorageKey, analysisNetOptionText, formatAnalysisDeviceRegions, pruneAnalysisDeviceRegions, pruneAnalysisNetValues } from '../src/web/analysis-state.js';

const nets = [
  { id: 'N1', name: 'VIN', terminals: [{ comp: 'P1', term: 'p' }], analysis: { role: 'input' } },
  { id: 'N2', name: 'VOUT', terminals: [{ comp: 'P2', term: 'p' }], analysis: { role: 'output' } },
  { id: 'N3', name: 'VBN', terminals: [{ comp: 'P3', term: 'p' }], analysis: { role: 'dc-bias', acGround: true } },
];

test('analysis form preferences are scoped to each named document', () => {
  assert.equal(analysisFormStorageKey('ss-nmos'), 'schematic-spawner:analysis-form:ss-nmos');
  assert.equal(analysisFormStorageKey('another-schematic'), 'schematic-spawner:analysis-form:another-schematic');
  assert.notEqual(analysisFormStorageKey('ss-nmos'), analysisFormStorageKey('another-schematic'));
  assert.match(analysisFormStorageKey('new design'), /new%20design$/);
});

test('analysis form drops net and device references that are absent from the current schematic', () => {
  assert.equal(pruneAnalysisNetValues('OLD, VIN, P1.p, N3, missing', nets), 'VIN, P1.p, N3');
  assert.deepEqual(pruneAnalysisDeviceRegions({ M1: { region: 'current-source' }, P2: { region: 'triode' }, OLD: { region: 'triode' } }, ['M1', 'P2']), {
    P2: { region: 'triode' },
  });
  assert.deepEqual(pruneAnalysisDeviceRegions('M1=current-source, P2=triode, OLD=triode', ['M1', 'P2']), {
    P2: { region: 'triode' },
  });
  assert.equal(formatAnalysisDeviceRegions({ P2: { region: 'triode' }, M1: { region: 'triode' } }), 'M1=triode, P2=triode');
});

test('explicit input/output net roles become analysis defaults', () => {
  const defaults = analysisFormDefaults(nets, { targetNetId: 'N1' });
  assert.deepEqual(defaults, { target: 'N2', input: 'N1', targetMarked: true, inputMarked: true });
});

test('analysis defaults retain a selected target when no output role is marked', () => {
  const unmarked = nets.map((net) => ({ ...net, analysis: { ...net.analysis, role: net.id === 'N1' ? 'input' : null } }));
  const defaults = analysisFormDefaults(unmarked, { targetNetId: 'N3' });
  assert.equal(defaults.target, 'N3');
  assert.equal(defaults.input, 'N1');
  assert.equal(defaults.targetMarked, false);
  assert.equal(defaults.inputMarked, true);
});

test('analysis defaults prefer output ports and the non-inverting input port over list order', () => {
  const ports = [
    { id: 'N1', name: 'MILLER_SERIES', analysis: {} },
    { id: 'N2', name: 'VINN', analysis: {} },
    { id: 'N3', name: 'VINP', analysis: {} },
    { id: 'N4', name: 'VOUT', analysis: {} },
  ];
  const defaults = analysisFormDefaults(ports, { componentInputNetIds: ['N2', 'N3'], componentOutputNetIds: ['N4'] });
  assert.equal(defaults.target, 'N4');
  assert.equal(defaults.input, 'N3');
  assert.equal(analysisFormDefaults(ports.slice(0, 1).concat({ id: 'N9', name: 'Vout', analysis: {} })).target, 'N9');
});

test('analysis node options show net names without label markup', () => {
  assert.equal(analysisNetOptionText({ id: 'N15', name: 'V_{IN}' }), 'VIN — N15');
  assert.equal(analysisNetOptionText({ id: 'N6', name: 'V_{OUT}^{+}' }), 'VOUT+ — N6');
  assert.equal(analysisNetOptionText({ id: 'N3', name: 'N3' }), 'N3');
  assert.equal(analysisNetOptionText({ id: 'N4', name: '' }), '(unnamed) — N4');
});
