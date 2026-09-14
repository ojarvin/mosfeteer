import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  describeSmallSignalNetlist,
  formatSmallSignalNetlist,
} from '../src/core/analysis/netlist.js';

const commonSourcePrimitives = [
  {
    kind: 'conductance', id: 'M1.go', component: 'M1',
    nodes: { a: 'VOUT', b: '0' }, parameter: 'go1', conductance: 'go1',
  },
  {
    kind: 'vccs', id: 'M1.gm', component: 'M1',
    output: { positive: 'VOUT', negative: '0' },
    control: { positive: 'VIN', negative: '0' },
    value: 'gm1', parameter: 'gm1', transconductance: 'gm1',
  },
];

test('formats a common-source VCCS with actual control net names', () => {
  const text = formatSmallSignalNetlist(commonSourcePrimitives);
  assert.match(text, /\* G_M1 current: g_\{m1\}\(V_\{IN\}-0\)/);
  assert.match(text, /G_M1 V_\{OUT\} 0 V_\{IN\} 0 g_\{m1\}/);
  assert.match(text, /GO_M1 V_\{OUT\} 0 g_\{o1\}/);
  assert.doesNotMatch(text, /vgs|v_g-v_s/i);
});

test('formats the strict primitive terminal contract directly', () => {
  const text = formatSmallSignalNetlist([
    { kind: 'conductance', id: 'M1.go', terminals: { a: 'VOUT', b: '0' }, value: 'go1' },
    { kind: 'vccs', id: 'M1.gm', terminals: { a: 'VOUT', b: '0' }, control: { a: 'VIN', b: '0' }, value: 'gm1' },
  ]);
  assert.match(text, /GO_M1\.go V_\{OUT\} 0 g_\{o1\}/);
  assert.match(text, /G_M1\.gm V_\{OUT\} 0 V_\{IN\} 0 g_\{m1\}/);
});

test('shows moving-source body control and the implicit VSS note', () => {
  const text = formatSmallSignalNetlist([{
    kind: 'vccs', id: 'M1.gmb', component: 'M1',
    output: { positive: 'VOUT', negative: 'VS' },
    control: { positive: '@AC_GROUND', negative: 'VS' },
    value: 'gmb1', parameter: 'gmb1', transconductance: 'gmb1',
    terminals: { drain: 'VOUT', source: 'VS', gate: 'VIN', bulk: '@AC_GROUND' },
    bulk: { node: '@AC_GROUND', implicit: true, reference: 'VSS' },
  }]);
  assert.match(text, /G_M1 V_\{OUT\} V_\{S\} 0 V_\{S\} g_\{mb1\}/);
  assert.match(text, /M1 bulk: implicit V_\{SS\} is AC ground; v_\{bs\} = 0-V_\{S\}/);
});

test('keeps CMOS inverter gm sources parallel and drain-to-source oriented', () => {
  const text = formatSmallSignalNetlist([
    {
      kind: 'vccs', id: 'M2.gm', component: 'M2',
      output: { positive: 'VOUT', negative: 'VDD' },
      control: { positive: 'VIN', negative: 'VDD' }, value: 'gm2',
    },
    {
      kind: 'vccs', id: 'M1.gm', component: 'M1',
      output: { positive: 'VOUT', negative: 'VSS' },
      control: { positive: 'VIN', negative: 'VSS' }, value: 'gm1',
    },
  ]);
  assert.match(text, /G_M1 V_\{OUT\} 0 V_\{IN\} 0 g_\{m1\}/);
  assert.match(text, /G_M2 V_\{OUT\} 0 V_\{IN\} 0 g_\{m2\}/);
  assert.doesNotMatch(text, /-g_\{m/);
});

test('preserves explicit bulk as a real node without an implicit-bulk note', () => {
  const text = formatSmallSignalNetlist([{
    kind: 'vccs', id: 'M1.gmb', component: 'M1',
    output: { positive: 'VOUT', negative: 'VS' },
    control: { positive: 'VB', negative: 'VS' }, value: 'gmb1',
    terminals: { drain: 'VOUT', source: 'VS', gate: 'VIN', bulk: 'VB' },
    bulk: { node: 'VB', implicit: false, reference: null },
  }]);
  assert.match(text, /G_M1 V_\{OUT\} V_\{S\} V_\{B\} V_\{S\} g_\{mb1\}/);
  assert.doesNotMatch(text, /implicit/);
});

test('formats RLC elements and zero-valued independent sources', () => {
  const text = formatSmallSignalNetlist([
    { kind: 'inductor', id: 'L1.inductor', component: 'L1', nodes: { a: 'VIN', b: 'N1' }, value: 'L1' },
    { kind: 'current-source', id: 'I1.current-source', component: 'I1', nodes: { positive: 'N1', negative: '0' }, value: 0, acValue: 0 },
    { kind: 'capacitor', id: 'C1.capacitor', component: 'C1', nodes: { a: 'N1', b: '0' }, value: 'C1' },
    { kind: 'resistor', id: 'R1.resistor', component: 'R1', nodes: { a: 'VIN', b: 'N1' }, value: 'R1' },
    { kind: 'voltage-source', id: 'V1.voltage-source', component: 'V1', nodes: { positive: 'VIN', negative: '0' }, value: 0, acValue: 0 },
  ]);
  assert.match(text, /R_R1 V_\{IN\} N1 R_\{1\}/);
  assert.match(text, /C_C1 N1 0 C_\{1\}/);
  assert.match(text, /L_L1 V_\{IN\} N1 L_\{1\}/);
  assert.match(text, /V_V1 V_\{IN\} 0 0/);
  assert.match(text, /I_I1 N1 0 0/);
});

test('formats a triode MOS descriptor as its rds branch', () => {
  const text = formatSmallSignalNetlist([{
    kind: 'resistor', id: 'M1.rds', component: 'M1', model: 'triode',
    nodes: { a: 'VOUT', b: '0' }, value: 'rds1', parameter: 'rds1',
  }]);
  assert.match(text, /RDS_M1 V_\{OUT\} 0 r_\{ds1\}/);
  assert.doesNotMatch(text, /R_M1/);
});

test('adds zeroed-input metadata without changing primitive descriptors', () => {
  const primitives = structuredClone(commonSourcePrimitives);
  const before = structuredClone(primitives);
  const text = formatSmallSignalNetlist(primitives, {
    zeroedInput: true,
    inputName: 'VIN',
  });
  assert.match(text, /^\* Small-signal equivalent.*\n\* V_\{IN\} = 0 \(input source zeroed for output impedance\)/);
  assert.deepEqual(primitives, before);
});

test('sorts primitive entries deterministically regardless of input order', () => {
  const input = [
    { kind: 'vccs', id: 'M2.gm', component: 'M2', output: { positive: 'O', negative: '0' }, control: { positive: 'I', negative: '0' }, value: 'gm2' },
    { kind: 'capacitor', id: 'C1.capacitor', component: 'C1', nodes: { a: 'O', b: '0' }, value: 'C1' },
    { kind: 'resistor', id: 'R1.resistor', component: 'R1', nodes: { a: 'I', b: 'O' }, value: 'R1' },
    { kind: 'vccs', id: 'M1.gm', component: 'M1', output: { positive: 'O', negative: '0' }, control: { positive: 'I', negative: '0' }, value: 'gm1' },
  ];
  const first = describeSmallSignalNetlist(input).entries.map(({ id }) => id);
  const second = describeSmallSignalNetlist([...input].reverse()).entries.map(({ id }) => id);
  assert.deepEqual(first, ['R1.resistor', 'C1.capacitor', 'M1.gm', 'M2.gm']);
  assert.deepEqual(second, first);
});
