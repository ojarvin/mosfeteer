import assert from 'node:assert/strict';
import test from 'node:test';
import { Circuit } from '../src/core/model.js';
import { createAnalysisCache, exactAnalysisKey } from '../src/core/analysis/cache.js';

function request(overrides = {}) {
  return {
    revision: 1,
    inputPort: 'N_IN',
    outputPort: 'N_OUT',
    acGrounds: ['VSS'],
    ...overrides,
  };
}

test('cache hits exact artifacts and misses changed keys', () => {
  const cache = createAnalysisCache({ maxEntries: 2 });
  const circuit = new Circuit();
  const artifact = { ok: true, id: 1 };
  cache.set(circuit, request(), artifact);
  assert.strictEqual(cache.get(circuit, request()), artifact);
  assert.equal(cache.get(circuit, request({ outputPort: 'N_OTHER' })), undefined);
  assert.deepEqual(cache.stats(circuit), {
    hits: 1,
    misses: 1,
    sets: 1,
    evictions: 0,
    failures: 0,
    entries: 1,
  });
});

test('revision invalidates an otherwise identical exact artifact', () => {
  const cache = createAnalysisCache();
  const circuit = new Circuit();
  cache.set(circuit, request({ revision: 'committed-1' }), { ok: true, revision: 1 });
  assert.equal(cache.get(circuit, request({ revision: 'committed-2' })), undefined);
});

test('caller-supplied deterministic fallback can stand in for a missing Circuit revision', () => {
  const cache = createAnalysisCache();
  const circuit = new Circuit();
  const artifact = { ok: true };
  cache.set(circuit, request({ revision: undefined, fallbackRevision: 'fingerprint-1' }), artifact);
  assert.strictEqual(cache.get(circuit, request({ revision: undefined, fallbackRevision: 'fingerprint-1' })), artifact);
  assert.equal(cache.get(circuit, request({ revision: undefined, fallbackRevision: 'fingerprint-2' })), undefined);
});

test('ports and AC references are physical and order-independent where appropriate', () => {
  const cache = createAnalysisCache();
  const circuit = new Circuit();
  const artifact = { ok: true };
  cache.set(circuit, request({ acGrounds: ['VSS', 'VDD'] }), artifact);
  assert.strictEqual(cache.get(circuit, request({ acGrounds: new Set(['VDD', 'VSS']) })), artifact);
  assert.equal(cache.get(circuit, request({ inputPort: 'N_OTHER', acGrounds: ['VDD', 'VSS'] })), undefined);
  assert.equal(cache.get(circuit, request({ outputPort: 'N_OTHER', acGrounds: ['VDD', 'VSS'] })), undefined);
});

test('presentation assumptions do not enter the exact key', () => {
  const circuit = new Circuit();
  const base = request({ assumptions: { gmb0: true, gmroLarge: true, roInfinity: false } });
  const variant = request({ assumptions: { gmb0: false, gmroLarge: false, roInfinity: true }, dominantPole: true });
  assert.deepEqual(exactAnalysisKey(circuit, base), exactAnalysisKey(circuit, variant));
});

test('exact device-region overrides affect the key but presentation fields do not', () => {
  const cache = createAnalysisCache();
  const circuit = new Circuit();
  const artifact = { ok: true };
  cache.set(circuit, request({ deviceRegionOverrides: { M1: 'saturation' } }), artifact);
  assert.strictEqual(cache.get(circuit, request({ deviceRegionOverrides: { M1: 'saturation' }, gmroLarge: true })), artifact);
  assert.equal(cache.get(circuit, request({ deviceRegionOverrides: { M1: 'triode' } })), undefined);
});

test('all exact value, frequency, variable, and device parameter inputs invalidate the cache', () => {
  const cache = createAnalysisCache();
  const circuit = new Circuit();
  const base = request({
    values: { R1: 'R' },
    s: 's',
    variable: 's',
    devices: { M1: { gm: 'gm1', go: 'go1' } },
    maxOperations: 1000,
  });
  const artifact = { ok: true };
  cache.set(circuit, base, artifact);
  assert.strictEqual(cache.get(circuit, request({ ...base, values: { R1: '2R' } })), undefined);
  assert.strictEqual(cache.get(circuit, request({ ...base, s: '2s' })), undefined);
  assert.strictEqual(cache.get(circuit, request({ ...base, variable: 'z' })), undefined);
  assert.strictEqual(cache.get(circuit, request({ ...base, devices: { M1: { gm: 'gm2', go: 'go1' } } })), undefined);
  assert.strictEqual(cache.get(circuit, request({ ...base, maxOperations: 2000 })), undefined);
});

test('custom resolver and algebra functions require a stable fingerprint', () => {
  const circuit = new Circuit();
  const resolver = () => 'R1';
  const ops = { add: () => 0, variable: 's' };
  assert.throws(() => exactAnalysisKey(circuit, request({ valueOf: resolver })), /explicit fingerprint/);
  assert.throws(() => exactAnalysisKey(circuit, request({ valueOf: resolver, ops })), /explicit fingerprint/);

  const cache = createAnalysisCache();
  const base = request({ valueOf: resolver, ops, exactFingerprint: 'resolver-v1' });
  const artifact = { ok: true };
  cache.set(circuit, base, artifact);
  assert.strictEqual(cache.get(circuit, { ...base, valueOf: () => 'different implementation' }), artifact);
  assert.equal(cache.get(circuit, { ...base, exactFingerprint: 'resolver-v2' }), undefined);
});

test('per-circuit LRU evicts the least recently used entry', () => {
  const cache = createAnalysisCache({ maxEntries: 2 });
  const circuit = new Circuit();
  const a = request({ outputPort: 'A' });
  const b = request({ outputPort: 'B' });
  const c = request({ outputPort: 'C' });
  cache.set(circuit, a, { ok: true, id: 'a' });
  cache.set(circuit, b, { ok: true, id: 'b' });
  assert.equal(cache.get(circuit, a).id, 'a');
  cache.set(circuit, c, { ok: true, id: 'c' });
  assert.equal(cache.get(circuit, b), undefined);
  assert.equal(cache.get(circuit, a).id, 'a');
  assert.equal(cache.get(circuit, c).id, 'c');
  assert.equal(cache.stats(circuit).evictions, 1);
});

test('failed or budget-exceeded computations are never cached', () => {
  const cache = createAnalysisCache();
  const circuit = new Circuit();
  const key = request();
  let calls = 0;
  const compute = () => {
    calls++;
    return { ok: false, code: 'operation-budget', error: 'budget exceeded' };
  };
  assert.equal(cache.getOrCompute(circuit, key, compute).ok, false);
  assert.equal(cache.getOrCompute(circuit, key, compute).ok, false);
  assert.equal(calls, 2);
  assert.equal(cache.get(circuit, key), undefined);
  assert.equal(cache.stats(circuit).failures, 2);
  cache.set(circuit, key, new Error('operation budget exceeded'));
  assert.equal(cache.get(circuit, key), undefined);
});

test('nested failures, budget markers, and cycles are never cached', () => {
  const cache = createAnalysisCache();
  const circuit = new Circuit();
  const key = request();
  for (const artifact of [
    { ok: true, details: { budgetExceeded: true } },
    { ok: true, details: { failure: 'singular-system' } },
    { ok: true, details: { status: 'operation-budget' } },
  ]) {
    cache.set(circuit, key, artifact);
    assert.equal(cache.get(circuit, key), undefined);
  }
  const cyclic = { ok: true };
  cyclic.details = cyclic;
  cache.set(circuit, key, cyclic);
  assert.equal(cache.get(circuit, key), undefined);
  assert.equal(cache.stats(circuit).failures, 4);
});

test('shared artifact subobjects are valid while Map failures are rejected', () => {
  const cache = createAnalysisCache();
  const circuit = new Circuit();
  const shared = { label: 'same' };
  const artifact = { ok: true, first: shared, second: shared };
  cache.set(circuit, request(), artifact);
  assert.strictEqual(cache.get(circuit, request()), artifact);

  const failed = { ok: true, details: new Map([['status', 'failure']]) };
  cache.set(circuit, request({ outputPort: 'OTHER' }), failed);
  assert.equal(cache.get(circuit, request({ outputPort: 'OTHER' })), undefined);
});

test('a cached artifact that becomes invalid is discarded on read', () => {
  const cache = createAnalysisCache();
  const circuit = new Circuit();
  const artifact = { ok: true, details: {} };
  cache.set(circuit, request(), artifact);
  artifact.details.budgetExceeded = true;
  assert.equal(cache.get(circuit, request()), undefined);
  assert.equal(cache.stats(circuit).entries, 0);
});

test('thrown budget failures are not cached', () => {
  const cache = createAnalysisCache();
  const circuit = new Circuit();
  const key = request();
  let calls = 0;
  assert.throws(() => cache.getOrCompute(circuit, key, () => {
    calls++;
    throw new Error('analysis time budget exceeded');
  }), /time budget exceeded/);
  assert.throws(() => cache.getOrCompute(circuit, key, () => {
    calls++;
    throw new Error('analysis time budget exceeded');
  }), /time budget exceeded/);
  assert.equal(calls, 2);
  assert.equal(cache.stats(circuit).entries, 0);
});

test('separate circuit objects never share exact artifacts', () => {
  const cache = createAnalysisCache();
  const first = new Circuit();
  const second = new Circuit();
  const artifact = { ok: true };
  assert.notStrictEqual(exactAnalysisKey(first, request()).circuit, exactAnalysisKey(second, request()).circuit);
  cache.set(first, request(), artifact);
  assert.equal(cache.get(second, request()), undefined);
  cache.clear(first);
  assert.equal(cache.get(first, request()), undefined);
});
