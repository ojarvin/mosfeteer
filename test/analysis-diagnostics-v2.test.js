import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatDiagnosticLog,
  normalizeDiagnostics,
  presentDiagnostics,
} from '../src/core/analysis/diagnostics.js';

test('deduplicates producer diagnostics and orders errors before warnings', () => {
  const result = normalizeDiagnostics({
    context: {
      diagnostics: {
        warnings: [{ code: 'unsupported-component', component: 'U1', message: 'old wording' }],
        errors: [{ code: 'ambiguous-port', role: 'input', candidates: ['N2', 'N1'], message: 'first wording' }],
      },
    },
    primitives: {
      diagnostics: [{ code: 'ambiguous-port', role: 'input', candidates: ['N1', 'N2'], message: 'second wording' }],
    },
  });
  assert.equal(result.diagnostics.length, 2);
  assert.deepEqual(result.diagnostics.map(({ code }) => code), ['ambiguous-port', 'unsupported-component']);
  assert.equal(result.diagnostics[0].severity, 'error');
  assert.match(formatDiagnosticLog(result), /ERROR ambiguous-port context/);
});

test('keeps ambiguous ports actionable and concise', () => {
  const result = presentDiagnostics({
    code: 'ambiguous-port',
    role: 'output',
    name: 'VOUT',
    candidates: ['N1', 'N2'],
    message: 'verbose producer text',
  });
  assert.equal(result.ok, false);
  assert.equal(result.messages[0], 'Output port "VOUT" matches multiple physical nets; choose one.');
  assert.match(result.logText, /verbose producer text/);
});

test('normalizes an unconnected explicit bulk without guessing a connection', () => {
  const result = normalizeDiagnostics({
    devices: {
      diagnostics: [{ code: 'unconnected-bulk', component: 'M1', type: 'nmosb' }],
    },
  });
  assert.equal(result.errors[0].code, 'unconnected-bulk');
  assert.equal(result.errors[0].message, 'M1 has an unconnected bulk terminal.');
  assert.doesNotMatch(result.logText, /source|VSS|VDD/);
});

test('reports supplied floating-node metadata as a singular cause', () => {
  const result = normalizeDiagnostics({
    solve: {
      ok: false,
      code: 'singular',
      error: 'singular system: no pivot for V(N1)',
      metadata: { floatingCoupledNodes: ['N1'] },
    },
  });
  assert.deepEqual(result.diagnostics.map(({ code }) => code), ['floating-coupled-node', 'singular-system']);
  assert.equal(result.diagnostics[0].message, 'Coupled node N1 is floating; add a reference or return path.');
});

test('reports missing reference and contradictory ideal sources only from metadata', () => {
  const result = normalizeDiagnostics({
    mna: {
      ok: false,
      code: 'inconsistent',
      error: 'inconsistent system',
      singularity: {
        missingReference: { reference: '0' },
        contradictoryVoltageSources: [{ sources: ['V1', 'V2'] }],
      },
    },
  });
  assert.deepEqual(result.diagnostics.map(({ code }) => code), [
    'missing-reference',
    'contradictory-voltage-constraints',
    'inconsistent-system',
  ]);
  assert.match(result.diagnostics[1].message, /contradictory/);

  const generic = normalizeDiagnostics({ code: 'singular', error: 'singular because a reference is absent' });
  assert.deepEqual(generic.diagnostics.map(({ code }) => code), ['singular-system']);
});

test('emits one migration message for repeated legacy MOS current-source diagnostics', () => {
  const result = normalizeDiagnostics({
    devices: {
      diagnostics: [
        {
          code: 'legacy-mos-current-source',
          severity: 'error',
          component: 'M1',
          message: 'M1 uses removed override',
          migration: 'Remove it',
        },
      ],
    },
    solve: {
      diagnostics: [{ code: 'legacy_mos_current_source', component: 'M1', message: 'duplicate' }],
    },
  });
  assert.equal(result.diagnostics.filter(({ code }) => code === 'legacy-mos-current-source').length, 1);
  assert.equal(result.errors[0].message, 'M1 uses the removed current-source override; remove it and use the exact MOS model.');
  assert.match(result.logText, /Remove it/);
});
