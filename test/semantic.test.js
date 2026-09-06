import test from 'node:test';
import assert from 'node:assert/strict';
import { checkSemantics } from '../src/core/semantic.js';
import { generateCircuit } from '../src/core/circuitSpec.js';
import { routeCircuit } from '../src/core/routing.js';

const base = (semantics = {}) => ({
  version: 1,
  motif: 'semantic-fixture',
  components: [{ id: 'M1', type: 'nmos' }, { id: 'M2', type: 'nmos' }, { id: 'R1', type: 'resistor' }],
  nets: [
    { id: 'vdd', kind: 'supply', terminals: [{ component: 'M1', terminal: 'd' }] },
    { id: 'gnd', kind: 'ground', terminals: [{ component: 'M1', terminal: 's' }] },
    { id: 'bias', kind: 'bias', terminals: [{ component: 'M1', terminal: 'g' }] },
    { id: 'out', terminals: [{ component: 'M2', terminal: 'd' }, { component: 'R1', terminal: 'a' }] },
  ],
  semantics,
});

const codes = (report) => report.issues.map((item) => item.code);

 test('required rails, ground, bias, and connections are checked by physical net id', () => {
  const valid = checkSemantics({ ...base({
    requiredRails: [{ net: 'vdd', kind: 'supply' }, { net: 'gnd', kind: 'ground' }],
    requiredBiasNets: ['bias'],
    requiredConnections: [{ terminals: ['M2.d', 'R1.a'], net: 'out' }],
  }) });
  assert.equal(valid.ok, true, JSON.stringify(valid));

  const invalid = checkSemantics({ ...base({ requiredRails: ['missing'], requiredBiasNets: ['missing-bias'], requiredConnections: [{ terminals: ['M2.d', 'R1.a'], net: 'bias' }] }) });
  assert.deepEqual(codes(invalid), ['missing-required-bias', 'missing-required-rail', 'required-connection-mismatch']);
  assert.equal(invalid.errors.every((item) => item.severity === 'error'), true);
});

test('malformed semantic terminals are reported instead of filtered', () => {
  const report = checkSemantics({ ...base({
    requiredConnections: [{ terminals: ['M2.d', 'R1.a', null] }],
    driverLoads: [{ driver: 'M2.d', loads: ['R1.a', 'M9.s'] }],
  }) });
  assert.equal(report.ok, false);
  assert.ok(report.issues.some((item) => item.code === 'invalid-semantic-terminal'));
  assert.ok(report.issues.some((item) => item.code === 'unknown-semantic-terminal' && item.refs.includes('M9.s')));
});

test('driver/load declarations require both sides', () => {
  const report = checkSemantics({ ...base({ driverLoads: [{ loads: ['R1.a'] }, { driver: null, loads: ['R1.a'] }, { driver: '', loads: ['R1.a'] }, { driver: 'M9.s', loads: ['R1.a'] }] }) });
  assert.ok(codes(report).includes('ambiguous-driver-load'));
  assert.ok(codes(report).includes('invalid-semantic-terminal'));
  assert.ok(codes(report).includes('unknown-semantic-terminal'));
});

test('ports report missing presence and direction separately', () => {
  const report = checkSemantics({ ...base({ ports: [{ id: 'IN', direction: 'input', net: 'bias' }, { id: 'OUT', direction: 'output', net: 'out' }] }), ports: [{ id: 'IN', type: 'output', net: 'bias' }] });
  assert.deepEqual(codes(report), ['missing-required-port', 'port-direction-mismatch']);
  assert.deepEqual(report.issues.find((item) => item.code === 'port-direction-mismatch').nets, ['bias']);
});

test('differential and matched groups require consistent devices and topology', () => {
  const valid = checkSemantics({ ...base({ matchedGroups: [{ kind: 'differential-pair', members: ['M1', 'M2'], sharedTerminals: ['s'], distinctTerminals: ['g', 'd'] }] }), nets: [
    { id: 'vdd', kind: 'supply', terminals: [{ component: 'M1', terminal: 'd' }] },
    { id: 'gnd', kind: 'ground', terminals: [{ component: 'M1', terminal: 's' }, { component: 'M2', terminal: 's' }] },
    { id: 'inp', terminals: [{ component: 'M1', terminal: 'g' }] },
    { id: 'inn', terminals: [{ component: 'M2', terminal: 'g' }] },
    { id: 'outp', terminals: [{ component: 'M1', terminal: 'd' }] },
    { id: 'outn', terminals: [{ component: 'M2', terminal: 'd' }] },
  ] });
  assert.equal(valid.ok, true, JSON.stringify(valid));

  const invalid = checkSemantics({ ...base({ matchedGroups: [{ kind: 'differential-pair', members: ['M1', 'R1'] }] }) });
  assert.ok(codes(invalid).includes('matched-group-type-mismatch'));
  assert.ok(codes(invalid).includes('differential-shared-net-mismatch'));
});

test('explicit role and driver/load expectations are semantic checks', () => {
  const report = checkSemantics({ ...base({
    roleExpectations: [{ component: 'M1', role: 'driver' }],
    driverLoads: [{ driver: 'M1.d', loads: ['R1.a'], net: 'out' }],
  }), components: [{ id: 'M1', type: 'nmos', role: 'load' }, { id: 'M2', type: 'nmos' }, { id: 'R1', type: 'resistor' }] });
  assert.ok(codes(report).includes('component-role-mismatch'));
  assert.ok(codes(report).includes('driver-load-net-mismatch'));
});

test('malformed prohibited-open terminals are reported', () => {
  const report = checkSemantics({ ...base({ requiredClosedTerminals: ['M9.s', null] }) });
  assert.equal(report.ok, false);
  assert.equal(report.issues.filter((item) => item.code === 'unknown-semantic-terminal').length, 1);
  assert.equal(report.issues.filter((item) => item.code === 'invalid-semantic-terminal').length, 1);
});

test('intentional opens pass while prohibited or unexpected opens fail', () => {
  const spec = { version: 1, motif: 'opens', components: [{ id: 'R1', type: 'resistor' }], nets: [{ id: 'in', terminals: [{ component: 'R1', terminal: 'a' }] }], openTerminals: [{ component: 'R1', terminal: 'b' }] };
  assert.equal(checkSemantics({ ...spec, semantics: { allowedOpenTerminals: ['R1.b'] } }).ok, true);
  const report = checkSemantics({ ...spec, semantics: { prohibitedOpenTerminals: ['R1.b'] } });
  assert.deepEqual(codes(report), ['prohibited-open-terminal']);
  assert.equal(checkSemantics({ ...spec, semantics: { allowedOpenTerminals: [] } }).ok, true, 'unspecified topology is not guessed to be an open violation');
});

test('ambiguous bias names return focused clarification data', () => {
  const report = checkSemantics({ ...base({ requiredBiasNets: [{ name: 'BIAS' }] }), nets: [
    { id: 'a', name: 'BIAS', terminals: [{ component: 'M1', terminal: 'g' }] },
    { id: 'b', name: 'BIAS', terminals: [{ component: 'M2', terminal: 'g' }] },
  ] });
  const issue = report.issues[0];
  assert.equal(issue.code, 'ambiguous-required-bias');
  assert.deepEqual(issue.nets, ['a', 'b']);
  assert.deepEqual(issue.clarification.candidates, ['a', 'b']);
});

test('ambiguous named physical nets return focused clarification data', () => {
  const report = checkSemantics({ version: 1, motif: 'ambiguous', components: [{ id: 'R1', type: 'resistor' }, { id: 'R2', type: 'resistor' }], nets: [
    { id: 'a', name: 'VDD', terminals: [{ component: 'R1', terminal: 'a' }] },
    { id: 'b', name: 'VDD', terminals: [{ component: 'R2', terminal: 'a' }] },
  ], semantics: { requiredRails: [{ name: 'VDD', kind: 'supply' }] } });
  const issue = report.issues[0];
  assert.equal(issue.code, 'ambiguous-rail-net');
  assert.deepEqual(issue.nets, ['a', 'b']);
  assert.deepEqual(issue.clarification.candidates, ['a', 'b']);
});

test('semantic failures do not become geometry failures and generation stays pure/deterministic', () => {
  const input = { ...base({ requiredRails: ['missing'], clarifications: [{ question: 'choose a bias source', candidates: ['M1', 'M2'] }] }), motif: 'rc-filter' };
  const before = JSON.stringify(input);
  const first = routeCircuit(input);
  const second = routeCircuit(JSON.parse(JSON.stringify(input)));
  assert.equal(first.ok, true, JSON.stringify(first.report));
  assert.equal(first.semantic.ok, false);
  assert.deepEqual(first.report.semantic, second.report.semantic);
  assert.equal(JSON.stringify(input), before);
  const generated = generateCircuit(input);
  assert.equal(generated.report.semantic.ok, false);
  assert.equal(generated.circuit.nets.get('out').route, null);
});
